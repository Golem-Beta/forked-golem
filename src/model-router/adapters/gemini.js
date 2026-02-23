/**
 * GeminiAdapter — Google Gemini API 的 ProviderAdapter
 * 內部整合 KeyChain 邏輯（多 key 輪轉 + 429 冷卻）
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
                const genAI = new GoogleGenerativeAI(apiKey);
                const generationConfig = { maxOutputTokens: maxTokens, temperature };
                if (requireJson) {
                    generationConfig.responseMimeType = 'application/json';
                }
                const modelConfig = {
                    model,
                    generationConfig,
                };
                if (systemInstruction) modelConfig.systemInstruction = systemInstruction;
                if (tools) modelConfig.tools = tools;

                const geminiModel = genAI.getGenerativeModel(modelConfig);

                let result;

                if (chatHistory) {
                    // 對話模式：使用 startChat + sendMessage
                    const chat = geminiModel.startChat({ history: chatHistory });
                    const lastMsg = messages[messages.length - 1];
                    const content = lastMsg ? lastMsg.content : '';
                    result = await chat.sendMessage(content);
                } else if (inlineData) {
                    // 多模態模式：直接 generateContent
                    const parts = [];
                    if (messages.length > 0) {
                        parts.push(messages[messages.length - 1].content);
                    }
                    parts.push({ inlineData });
                    result = await geminiModel.generateContent(parts);
                } else {
                    // 簡單模式：messages 轉 Gemini contents
                    const prompt = messages.map(m => m.content).join('\n');
                    result = await geminiModel.generateContent(prompt);
                }

                const text = result.response.text().trim();
                const usage = result.response.usageMetadata || {};

                // 空字串視為失敗，讓 router failover
                if (!text) {
                    throw Object.assign(
                        new Error(`[Gemini] empty response from ${model}`),
                        { providerError: 'error' }
                    );
                }

                return {
                    text,
                    usage: {
                        inputTokens: usage.promptTokenCount || 0,
                        outputTokens: usage.candidatesTokenCount || 0,
                    },
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
