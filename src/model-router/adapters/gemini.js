/**
 * GeminiAdapter — Google Gemini API 的 ProviderAdapter
 * 使用 @google/genai SDK（@google/generative-ai 已於 2025-11-30 EOL）
 * 內部整合 KeyChain 邏輯（多 key 輪轉 + 429 冷卻）
 */
const { GoogleGenAI } = require('@google/genai');
const ProviderAdapter = require('./base');

class GeminiAdapter extends ProviderAdapter {
    constructor(config) {
        super('gemini', config);

        // 從 .env 讀取 key（逗號分隔多把）
        const rawKeys = process.env[config.envKey] || '';
        this.keys = rawKeys.split(',').map(k => k.trim()).filter(k => k && k.length > 10);
        this.currentIndex = 0;
        this._cooldownUntil = new Map();  // key → timestamp

        // 節流
        this._lastCallTime = 0;
        this._minInterval = 2500;  // ms
        this._throttleQueue = Promise.resolve();

        if (this.keys.length > 0) {
            console.log(`🗝️ [Gemini] ${this.keys.length} key(s) loaded`);
        }
    }

    isAvailable() {
        return this.keys.length > 0 && this._getAvailableKey() !== null;
    }

    /**
     * 統一呼叫入口
     */
    async complete(params) {
        const {
            model = 'gemini-2.5-flash-lite',
            messages = [],
            maxTokens = 4096,
            temperature = 0.7,
            requireJson = false,
            systemInstruction,
            tools,
            inlineData,
            chatHistory,
        } = params;

        const maxRetries = Math.min(this.keys.length + 2, 5);
        let lastError = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const apiKey = await this._getKeyThrottled();
            if (!apiKey) throw new Error('[Gemini] 沒有可用的 API Key');

            try {
                const client = new GoogleGenAI({ apiKey });
                const isGemini3 = model.startsWith('gemini-3');

                const config = {
                    maxOutputTokens: maxTokens,
                    temperature,
                };
                if (systemInstruction) config.systemInstruction = systemInstruction;
                if (requireJson) config.responseMimeType = 'application/json';
                // Gemini 3 引入 thinking mode，thinkingBudget: 0 關閉推理節省延遲
                if (isGemini3) config.thinkingConfig = { thinkingBudget: 0 };
                if (tools) config.tools = tools;

                let response;

                if (chatHistory) {
                    // 對話模式：使用 chat API
                    const chat = client.chats.create({ model, history: chatHistory, config });
                    const lastMsg = messages[messages.length - 1];
                    const userMessage = lastMsg ? lastMsg.content : '';
                    response = await chat.sendMessage({ message: userMessage });
                } else if (inlineData) {
                    // 多模態模式：contents 包含 text + inlineData parts
                    const lastMsg = messages[messages.length - 1];
                    const contents = [{
                        role: 'user',
                        parts: [
                            { text: lastMsg ? lastMsg.content : '' },
                            { inlineData },
                        ],
                    }];
                    response = await client.models.generateContent({ model, contents, config });
                } else {
                    // 簡單模式：messages 合併為 prompt
                    const prompt = messages.map(m => m.content).join('\n');
                    response = await client.models.generateContent({ model, contents: prompt, config });
                }

                // 檢查 MAX_TOKENS
                const candidate = response.candidates?.[0];
                const finishReason = candidate?.finishReason;
                if (finishReason === 'MAX_TOKENS') {
                    throw Object.assign(
                        new Error(`[Gemini] MAX_TOKENS: response truncated by ${model}`),
                        { providerError: 'error' }
                    );
                }

                // 讀取文字回應（新 SDK 有 .text getter）
                const text = (response.text || '').trim();

                // 空字串視為失敗，讓 router failover
                if (!text) {
                    throw Object.assign(
                        new Error(`[Gemini] empty response from ${model}`),
                        { providerError: 'error' }
                    );
                }

                // 讀取 grounding metadata
                const gm = candidate?.groundingMetadata;
                const grounding = gm ? {
                    webSearchQueries: gm.webSearchQueries || [],
                    sources: (gm.groundingChunks || []).map(c => ({
                        title: c.web?.title || '',
                        url: c.web?.uri || '',
                    })),
                } : null;

                // rawParts 供 brain.js 保留 thought signature
                const rawParts = candidate?.content?.parts || [{ text }];

                return {
                    text,
                    usage: {
                        inputTokens: response.usageMetadata?.promptTokenCount || 0,
                        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
                    },
                    grounding,
                    rawParts,
                };

            } catch (e) {
                lastError = e;
                const msg = e.message || '';
                const is429 = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Too Many Requests') || msg.includes('quota');
                const is503 = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded');

                if (is429 && apiKey) {
                    const isQuota = msg.includes('quota') || msg.includes('per day') || msg.includes('RPD') || msg.includes('RESOURCE_EXHAUSTED');
                    if (isQuota) {
                        this._markCooldownUntilReset(apiKey);
                    } else {
                        this._markCooldown(apiKey, 90000);
                    }
                    // 換 key 重試
                    if (attempt < this.keys.length - 1) {
                        await new Promise(r => setTimeout(r, 3000));
                        continue;
                    }
                }

                if (is503 && attempt < maxRetries - 1) {
                    const backoff = (attempt + 1) * 15000;
                    console.warn(`⏳ [Gemini] 503 過載，${backoff / 1000}s 後重試 (${attempt + 1}/${maxRetries})`);
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }

                // 回傳錯誤類型讓 router 決定是否 failover
                const errorType = is429 ? '429' : is503 ? '503' : 'error';
                throw Object.assign(e, { providerError: errorType });
            }
        }

        throw lastError || new Error('[Gemini] all retries exhausted');
    }

    // --- KeyChain 邏輯（從 index.js 移植） ---

    _getAvailableKey() {
        if (this.keys.length === 0) return null;
        const startIdx = this.currentIndex;
        for (let i = 0; i < this.keys.length; i++) {
            const idx = (startIdx + i) % this.keys.length;
            const key = this.keys[idx];
            if (!this._isCooling(key)) {
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

    async _getKeyThrottled() {
        return new Promise((resolve) => {
            this._throttleQueue = this._throttleQueue.then(async () => {
                const now = Date.now();
                const elapsed = now - this._lastCallTime;
                if (elapsed < this._minInterval) {
                    await new Promise(r => setTimeout(r, this._minInterval - elapsed));
                }
                this._lastCallTime = Date.now();
                resolve(this._getAvailableKey());
            });
        });
    }

    _isCooling(key) {
        const until = this._cooldownUntil.get(key);
        if (!until) return false;
        if (Date.now() >= until) { this._cooldownUntil.delete(key); return false; }
        return true;
    }

    _markCooldown(key, durationMs = 90000) {
        this._cooldownUntil.set(key, Date.now() + durationMs);
        const idx = this.keys.indexOf(key);
        console.log(`🧊 [Gemini] Key #${idx} 冷卻 ${Math.round(durationMs / 1000)}s`);
    }

    _markCooldownUntilReset(key) {
        const now = new Date();
        const laStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const laNow = new Date(laStr);
        const tomorrow = new Date(laNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 10, 0);
        const msUntilReset = tomorrow.getTime() - laNow.getTime();
        const idx = this.keys.indexOf(key);
        console.log(`🧊 [Gemini] Key #${idx} RPD 耗盡，冷卻到太平洋午夜（${Math.round(msUntilReset / 3600000 * 10) / 10}h）`);
        this._cooldownUntil.set(key, Date.now() + msUntilReset);
    }

    /**
     * 回傳 KeyChain 相容的狀態摘要
     */
    getStatus() {
        const cooling = [];
        for (const [k, t] of this._cooldownUntil) {
            const idx = this.keys.indexOf(k);
            const remain = Math.max(0, Math.round((t - Date.now()) / 1000));
            if (remain > 0) cooling.push(`#${idx}(${remain}s)`);
        }
        return cooling.length > 0 ? `冷卻中: ${cooling.join(', ')}` : '全部可用';
    }
}

module.exports = GeminiAdapter;
