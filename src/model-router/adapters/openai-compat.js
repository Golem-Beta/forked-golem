/**
 * @module model-router/adapters/openai-compat
 * @role OpenAI-compatible API adapter（key pool 管理、輪換、重試策略）
 * @when-to-modify 調整 429 冷卻策略、key 輪換邏輯、或新增 provider-specific 行為時
 *
 * 適用於 Groq, DeepSeek, Mistral, OpenRouter
 * 支援多 key 輪轉（multiKey: true 時逗號分隔）
 * 原始 HTTPS 請求由 openai-http.js 的 doRequest() 負責
 */
const ProviderAdapter = require('./base');
const { doRequest }   = require('./openai-http');

class OpenAICompatAdapter extends ProviderAdapter {
    constructor(name, config) {
        super(name, config);
        this.baseUrl = config.baseUrl;

        // 多 key 支援
        const rawKeys = (process.env[config.envKey] || '').trim();
        if (config.multiKey) {
            this.keys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 10);
        } else {
            this.keys = rawKeys.length > 10 ? [rawKeys] : [];
        }
        this.currentIndex = 0;
        this._cooldownUntil = new Map();  // key → timestamp

        if (this.keys.length > 0) {
            console.log(`🔑 [${name}] ${this.keys.length} key(s) loaded`);
        }
        this._loadCooldownFromDisk();
    }

    isAvailable() {
        return this.keys.length > 0 && this._getAvailableKey() !== null;
    }

    _getAvailableKey() {
        if (this.keys.length === 0) return null;
        const startIdx = this.currentIndex;
        for (let i = 0; i < this.keys.length; i++) {
            const idx = (startIdx + i) % this.keys.length;
            const key = this.keys[idx];
            const until = this._cooldownUntil.get(key);
            if (!until || Date.now() >= until) {
                if (until) this._cooldownUntil.delete(key);
                this.currentIndex = (idx + 1) % this.keys.length;
                return key;
            }
        }
        // 全部冷卻：回傳最快解除的那把
        let earliest = null, earliestTime = Infinity;
        for (const [k, t] of this._cooldownUntil) {
            if (t < earliestTime) { earliest = k; earliestTime = t; }
        }
        if (earliest) this._cooldownUntil.delete(earliest);
        return earliest || this.keys[0];
    }

    _markCooldown(key, durationMs = 90000) {
        this._cooldownUntil.set(key, Date.now() + durationMs);
        const idx = this.keys.indexOf(key);
        console.log(`🧊 [${this.name}] Key #${idx} 冷卻 ${Math.round(durationMs / 1000)}s`);
        this._saveCooldownToDisk();
    }

    async complete(params) {
        const {
            model,
            messages = [],
            maxTokens = 4096,
            temperature = 0.7,
            requireJson = false,
            systemInstruction,
        } = params;

        const maxRetries = Math.min(this.keys.length + 1, 4);
        let lastError = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const apiKey = this._getAvailableKey();
            if (!apiKey) throw new Error(`[${this.name}] 沒有可用的 API Key`);

            try {
                const result = await this._doRequest(apiKey, {
                    model, messages, maxTokens, temperature, requireJson, systemInstruction,
                });
                return result;
            } catch (e) {
                lastError = e;
                const errType = e.providerError || 'error';

                if (errType === '429') {
                    let cooldownMs;
                    const providerName = this.name;
                    if (providerName === 'mistral' || e.isRpmLimit) {
                        // Mistral 永遠是 RPM，固定 65 秒
                        cooldownMs = 65000;
                    } else if (providerName === 'openrouter') {
                        // OpenRouter header 完全空，upstream 限制，固定 120 秒
                        cooldownMs = 120000;
                    } else if (e.retryAfterMs && e.retryAfterMs > 3600000) {
                        // retry-after > 1 小時 → RPD 耗盡，冷卻到太平洋午夜
                        cooldownMs = this._msUntilPacificMidnight();
                    } else if (e.retryAfterMs) {
                        // 有 retry-after 且合理 → RPM，加 20% buffer
                        cooldownMs = Math.ceil(e.retryAfterMs * 1.2);
                    } else {
                        // 沒有任何 header → 90 秒 fallback
                        cooldownMs = 90000;
                    }
                    this._markCooldown(apiKey, cooldownMs);
                    // 多 key 時換 key 重試
                    if (this.keys.length > 1 && attempt < this.keys.length - 1) {
                        continue;
                    }
                }

                // 非 429 或最後一次嘗試，拋出讓 router 決定 failover
                throw e;
            }
        }

        throw lastError || new Error(`[${this.name}] all retries exhausted`);
    }

    _doRequest(apiKey, params) {
        return doRequest(this.name, this.baseUrl, apiKey, params);
    }

    _msUntilPacificMidnight() {
        const now = new Date();
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
        const tomorrow = new Date(laNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow.getTime() - laNow.getTime();
    }

    /**
     * 狀態摘要
     */
    getStatus() {
        const cooling = [];
        for (const [k, t] of this._cooldownUntil) {
            const idx = this.keys.indexOf(k);
            const remain = Math.max(0, Math.round((t - Date.now()) / 1000));
            if (remain > 0) cooling.push(`#${idx}(${remain}s)`);
        }
        return cooling.length > 0 ? `冷卻中: ${cooling.join(', ')}` : `${this.keys.length} key(s) 全部可用`;
    }
}

module.exports = OpenAICompatAdapter;
