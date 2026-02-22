/**
 * OpenAICompatAdapter — OpenAI-compatible API 的通用 adapter
 * 適用於 Groq, DeepSeek, Mistral, OpenRouter
 * 支援多 key 輪轉（multiKey: true 時逗號分隔）
 */
const https = require('https');
const ProviderAdapter = require('./base');

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
                    this._markCooldown(apiKey, e.retryAfterMs || 90000);
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
        const { model, messages, maxTokens, temperature, requireJson, systemInstruction } = params;

        const apiMessages = [];
        if (systemInstruction) {
            apiMessages.push({ role: 'system', content: systemInstruction });
        }
        for (const m of messages) {
            apiMessages.push({ role: m.role || 'user', content: m.content });
        }

        const body = {
            model,
            messages: apiMessages,
            max_tokens: maxTokens,
            temperature,
        };

        if (requireJson) {
            body.response_format = { type: 'json_object' };
        }

        const url = new URL(this.baseUrl + '/chat/completions');
        const postData = JSON.stringify(body);

        return new Promise((resolve, reject) => {
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);

                        if (res.statusCode === 429) {
                            const retryAfter = res.headers['retry-after'];
                            const err = new Error(`[${this.name}] 429 Too Many Requests`);
                            err.providerError = '429';
                            err.retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : 90000;
                            reject(err);
                            return;
                        }

                        if (res.statusCode === 503) {
                            const err = new Error(`[${this.name}] 503 Service Unavailable`);
                            err.providerError = '503';
                            reject(err);
                            return;
                        }

                        // 401 (auth) / 402 (balance) = 長期不可用，標記特殊錯誤類型
                        if (res.statusCode === 401 || res.statusCode === 402) {
                            const errMsg = json.error?.message || JSON.stringify(json);
                            const err = new Error(`[${this.name}] HTTP ${res.statusCode}: ${errMsg}`);
                            err.providerError = 'fatal';  // router 給長冷卻
                            reject(err);
                            return;
                        }

                        if (res.statusCode >= 400) {
                            const errMsg = json.error?.message || JSON.stringify(json);
                            const err = new Error(`[${this.name}] HTTP ${res.statusCode}: ${errMsg}`);
                            err.providerError = 'error';
                            reject(err);
                            return;
                        }

                        const choice = json.choices?.[0];
                        const text = choice?.message?.content || '';
                        const usage = json.usage || {};

                        resolve({
                            text: text.trim(),
                            usage: {
                                inputTokens: usage.prompt_tokens || 0,
                                outputTokens: usage.completion_tokens || 0,
                            },
                        });
                    } catch (e) {
                        reject(new Error(`[${this.name}] response parse error: ${e.message}`));
                    }
                });
            });

            req.on('error', (e) => {
                const err = new Error(`[${this.name}] network error: ${e.message}`);
                err.providerError = 'error';
                reject(err);
            });

            req.setTimeout(60000, () => {
                req.destroy();
                const err = new Error(`[${this.name}] request timeout (60s)`);
                err.providerError = 'error';
                reject(err);
            });

            req.write(postData);
            req.end();
        });
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
