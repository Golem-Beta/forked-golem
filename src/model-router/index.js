/**
 * ModelRouter — 多供應商 LLM API 智慧路由
 * 
 * 使用方式：
 *   const router = new ModelRouter();
 *   const result = await router.complete({ intent: 'chat', messages: [...] });
 * 
 * 設計原則：
 *   - 使用者只需在 .env 填 API key
 *   - Router 根據 intent + 健康狀態主動選最佳 provider（不是 fallback chain）
 *   - 選中的 provider 呼叫失敗時才退到下一個候選
 */
const PROVIDER_CONFIGS = require('./configs');
const INTENT_PREFERENCES = require('./intents');
const ProviderHealth = require('./health');
const GeminiAdapter = require('./adapters/gemini');
const OpenAICompatAdapter = require('./adapters/openai-compat');

class ModelRouter {
    constructor() {
        this.adapters = new Map();   // provider name → adapter
        this.health = new ProviderHealth();
        this._rpdResetTimer = null;

        this._initAdapters();
        this.health.loadFromDisk();  // 恢復重啟前的 RPD 計數
        this._scheduleRpdReset();

        if (this.adapters.size === 0) {
            throw new Error('[ModelRouter] 沒有任何可用的 LLM API Key。請在 .env 中至少填入一個。');
        }

        console.log(`🚀 [ModelRouter] ${this.adapters.size} provider(s) ready:`);
        console.log(this.health.getSummary(this.adapters));

        // DeepSeek 隱私提醒 + 餘額查詢
        if (this.adapters.has('deepseek')) {
            console.log('⚠️ [ModelRouter] DeepSeek: 伺服器在中國，prompt 可能用於模型訓練');
            const dsKey = (process.env.DEEPSEEK_API_KEY || '').trim();
            this.health.fetchDeepSeekBalance(dsKey).then(bal => {
                if (bal) {
                    const D = '\x24';  // dollar sign
                    console.log(`\u{1F4B0} [DeepSeek] 餘額: ${D}${bal.total.toFixed(2)} (充值: ${D}${bal.topped_up.toFixed(2)}, 贈送: ${D}${bal.granted.toFixed(2)})`);
                }
            });
            // 每 5 分鐘刷新餘額
            this._deepseekBalanceInterval = setInterval(() => {
                this.health.fetchDeepSeekBalance(dsKey).catch(() => {});
            }, 300000);
        }
    }

    _initAdapters() {
        for (const [name, config] of Object.entries(PROVIDER_CONFIGS)) {
            const envValue = (process.env[config.envKey] || '').trim();
            if (!envValue) continue;

            let adapter;
            if (name === 'gemini') {
                adapter = new GeminiAdapter(config);
                if (adapter.keys.length === 0) continue;
            } else {
                adapter = new OpenAICompatAdapter(name, config);
                if (!adapter.isAvailable()) continue;
            }

            this.adapters.set(name, adapter);
            this.health.register(name, config);
        }
    }

    /**
     * 排程 RPD 重置（太平洋時間午夜）
     */
    _scheduleRpdReset() {
        const now = new Date();
        const laStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const laNow = new Date(laStr);
        const tomorrow = new Date(laNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 30, 0);  // 午夜 + 30 秒安全邊距
        const msUntilReset = tomorrow.getTime() - laNow.getTime();

        this._rpdResetTimer = setTimeout(() => {
            this.health.resetAllRpd();
            this._scheduleRpdReset();  // 排程下一次
        }, msUntilReset);

        // 不阻止 process 退出
        if (this._rpdResetTimer.unref) this._rpdResetTimer.unref();
    }

    /**
     * 主要呼叫入口
     * 
     * @param {object} opts
     * @param {string} opts.intent - 任務意圖：decision/chat/analysis/reflection/utility/vision
     * @param {Array}  opts.messages - [{ role: 'user', content: '...' }]
     * @param {number} [opts.maxTokens]
     * @param {number} [opts.temperature]
     * @param {boolean} [opts.requireJson]
     * @param {string} [opts.systemInstruction]
     * @param {Array}  [opts.tools] - Gemini tools（如 googleSearch）
     * @param {object} [opts.inlineData] - 多模態資料
     * @param {Array}  [opts.chatHistory] - Gemini 對話歷史（contents 格式）
     */
    async complete(opts) {
        const { intent = 'chat' } = opts;
        const startTime = Date.now();

        const candidates = this._selectCandidates(intent);
        if (candidates.length === 0) {
            throw new Error(`[ModelRouter] intent "${intent}" 無可用 provider`);
        }

        let lastError = null;

        for (const candidate of candidates) {
            const { provider, model } = candidate;
            const adapter = this.adapters.get(provider);
            if (!adapter) continue;

            try {
                const result = await adapter.complete({ ...opts, model });
                const latency = Date.now() - startTime;

                console.log(`✅ [ModelRouter] ${provider}/${model} (${latency}ms, intent=${intent})`);

                // 更新健康狀態
                this.health.onSuccess(provider, model);

                return {
                    text: result.text,
                    usage: result.usage,
                    meta: {
                        provider,
                        model,
                        latency,
                        intent,
                    },
                };

            } catch (e) {
                lastError = e;
                const errType = e.providerError || 'error';

                // 更新健康狀態
                if (errType === 'fatal') {
                    this.health.onFatal(provider);
                } else if (errType === '429') {
                    this.health.on429(provider, e.retryAfterMs || 90000);
                } else if (errType === '503') {
                    this.health.on503(provider);
                } else {
                    this.health.onError(provider);
                }

                console.warn(`⚠️ [ModelRouter] ${provider}/${model} failed (${errType}): ${e.message}`);

                // 還有下一個候選，繼續嘗試
                if (candidates.indexOf(candidate) < candidates.length - 1) {
                    console.log(`🔄 [ModelRouter] failover to next candidate...`);
                    continue;
                }
            }
        }

        throw lastError || new Error(`[ModelRouter] intent "${intent}" all providers failed`);
    }

    /**
     * 從偏好矩陣中選出可用的候選，按健康分數排序
     */
    _selectCandidates(intent) {
        const preferences = INTENT_PREFERENCES[intent];
        if (!preferences) {
            console.warn(`[ModelRouter] Unknown intent "${intent}", falling back to "chat"`);
            return this._selectCandidates('chat');
        }

        // 過濾出可用的候選
        const available = preferences.filter(c => {
            if (!this.adapters.has(c.provider)) return false;
            return this.health.isAvailable(c.provider, c.model);
        });

        if (available.length > 0) {
            // 按健康分數排序
            available.sort((a, b) => {
                return this.health.score(b.provider, b.model) - this.health.score(a.provider, a.model);
            });
            return available;
        }

        // 放寬條件：允許冷卻即將結束的 provider
        const relaxed = preferences.filter(c => {
            if (!this.adapters.has(c.provider)) return false;
            const h = this.health.get(c.provider, c.model);
            return h && h.hasKey;
        });

        return relaxed;
    }

    // --- 相容性介面 ---

    /**
     * 提供 KeyChain 相容介面，讓未遷移的程式碼能繼續用
     * @deprecated 遷移完成後移除
     */
    get keyChain() {
        const gemini = this.adapters.get('gemini');
        if (gemini) {
            return {
                keys: gemini.keys,
                currentIndex: gemini.currentIndex,
                getKey: () => gemini._getKeyThrottled(),
                getKeySync: () => gemini._getAvailableKey(),
                markCooldown: (key, dur) => gemini._markCooldown(key, dur),
                markCooldownUntilReset: (key) => gemini._markCooldownUntilReset(key),
                getStatus: () => gemini.getStatus(),
            };
        }
        // 沒有 Gemini adapter 時的 fallback
        return {
            keys: [],
            currentIndex: 0,
            getKey: async () => null,
            getKeySync: () => null,
            markCooldown: () => {},
            markCooldownUntilReset: () => {},
            getStatus: () => 'no gemini keys',
        };
    }

    /**
     * 取得狀態摘要（Dashboard 用）
     */
    getStatus() {
        return this.health.getSummary(this.adapters);
    }

    /**
     * 清理資源
     */
    destroy() {
        if (this._rpdResetTimer) {
            clearTimeout(this._rpdResetTimer);
            this._rpdResetTimer = null;
        }
    }
}

module.exports = ModelRouter;
