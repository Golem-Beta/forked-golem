/**
 * 🏥 ProviderHealth — Provider 健康狀態追蹤（冷卻時間、失敗計數、RPD 持久化）
 * 依賴：fs, path（Node built-in）
 *
 * 顯示格式化與 DeepSeek 餘額查詢由 health-reporter.js 負責，
 * 透過 this.reporter 代理，外部介面保持不變。
 */
const fs   = require('fs');
const path = require('path');
const HealthReporter = require('./health-reporter');

/**
 * ProviderHealth — 追蹤每個 provider 的即時健康狀態
 */
class ProviderHealth {
    constructor() {
        this.providers = new Map();  // provider name → health state
        this._diskPath = path.join(process.cwd(), 'memory', 'rpd-state.json');
        this._savePending = false;
        this.reporter = new HealthReporter();
    }

    register(name, config) {
        // 取第一個模型的 RPD limit 作為預設
        const rpdLimits = config.rpdLimits || {};
        const firstLimit = Object.values(rpdLimits)[0] || 1000;

        // 初始化每個 model 的獨立 used 計數
        const modelUsed = {};
        for (const m of Object.keys(rpdLimits)) modelUsed[m] = 0;

        this.providers.set(name, {
            hasKey: true,
            rpd: { used: 0, limit: firstLimit },
            rpm: { used: 0, limit: config.defaultRpm || 30 },
            reliability: 1.0,
            coolUntil: 0,
            lastSuccess: 0,
            lastCallTime: 0,       // 上次實際發出請求的時間（用於 interval penalty）
            minIntervalMs: config.minIntervalMs || 0,  // 0 = 無限制
            rpdLimits: rpdLimits,  // per-model limits
            modelUsed,             // per-model 獨立 used 計數
            avgLatency: 1000,      // EMA 延遲（ms），初始假設 1 秒
            callCount: 0,          // 成功呼叫次數（用於 dashboard ranking）
        });
    }

    /**
     * 取得指定 provider + model 的健康狀態
     * @param {string} provider
     * @param {string} [model] - 若提供，用 model-specific RPD limit
     */
    get(provider, model) {
        const h = this.providers.get(provider);
        if (!h) return null;

        // 如果指定了 model，使用該 model 的 RPD limit
        if (model && h.rpdLimits[model] !== undefined) {
            return { ...h, rpd: { ...h.rpd, limit: h.rpdLimits[model] } };
        }
        return h;
    }

    /**
     * 判斷某 provider 是否可用
     */
    isAvailable(provider, model) {
        const h = this.providers.get(provider);
        if (!h || !h.hasKey) return false;
        if (h.coolUntil > Date.now()) return false;
        if (model && h.rpdLimits[model] !== undefined) {
            const limit = h.rpdLimits[model];
            const used = h.modelUsed[model] || 0;
            if (limit !== Infinity && used >= limit * 0.95) return false;
        }
        return true;
    }

    /**
     * 品質評分：優先讀 registry benchmark 分，否則 fallback 現有 score()
     * registry 空白時行為 = 現況，不降級
     */
    qualityScore(provider, model) {
        try {
            const info = require('./provider-registry').getModelInfo(provider, model);
            if (info && typeof info.benchmarkScore === 'number' && info.benchmarkMax) {
                const benchFactor = info.benchmarkScore / info.benchmarkMax;
                return benchFactor * this.score(provider, model);
            }
        } catch (_) {}
        return this.score(provider, model);
    }

    /**
     * 計算健康分數：RPD 餘量 × 可靠度 × 延遲係數
     * 延遲懲罰：avgLatency / 5000 最多扣 40% 分
     */
    score(provider, model) {
        const h = this.providers.get(provider);
        if (!h) return 0;
        const latencyPenalty = Math.min(1, (h.avgLatency || 1000) / 5000) * 0.4;
        const latencyFactor  = 1 - latencyPenalty;
        // interval penalty：距上次呼叫未達 minIntervalMs，score 大幅降低
        // 讓 selector 優先選其他 provider；萬一其他全掛仍可被選中（不歸零）
        const intervalFactor = (() => {
            if (!h.minIntervalMs || !h.lastCallTime) return 1;
            const elapsed = Date.now() - h.lastCallTime;
            if (elapsed >= h.minIntervalMs) return 1;
            return 0.05 + 0.95 * (elapsed / h.minIntervalMs);  // 線性恢復，最低保留 5%
        })();
        if (model && h.rpdLimits[model] !== undefined) {
            const limit = h.rpdLimits[model];
            if (limit === Infinity) return h.reliability * latencyFactor * intervalFactor;
            const used = h.modelUsed[model] || 0;
            return (1 - used / limit) * h.reliability * latencyFactor * intervalFactor;
        }
        if (h.rpd.limit === Infinity) return h.reliability * latencyFactor * intervalFactor;
        return (1 - h.rpd.used / h.rpd.limit) * h.reliability * latencyFactor * intervalFactor;
    }

    // --- 狀態更新 ---

    /**
     * 記錄本次請求發出時間（在實際呼叫前觸發，用於 interval penalty 計算）
     */
    recordCall(provider) {
        const h = this.providers.get(provider);
        if (h) h.lastCallTime = Date.now();
    }

    onSuccess(provider, model, latencyMs) {
        const h = this.providers.get(provider);
        if (!h) return;
        h.rpd.used++;
        if (model && h.modelUsed && h.modelUsed[model] !== undefined) {
            h.modelUsed[model]++;
        }
        h.lastSuccess = Date.now();
        h.callCount = (h.callCount || 0) + 1;
        // reliability 緩慢恢復（指數移動平均）
        h.reliability = Math.min(1.0, h.reliability * 0.9 + 0.1);
        // 延遲 EMA（alpha=0.2，新資料佔 20%）
        if (typeof latencyMs === 'number' && latencyMs > 0) {
            h.avgLatency = h.avgLatency * 0.8 + latencyMs * 0.2;
        }
        this._debounceSave();
    }

    on429(provider, retryAfterMs) {
        const h = this.providers.get(provider);
        if (!h) return;
        if (retryAfterMs > 3600000) {
            // 長冷卻（可能是 RPD 耗盡），標記到午夜重置
            h.rpd.used = h.rpd.limit;
        }
        h.coolUntil = Date.now() + (retryAfterMs || 90000);
        console.log(`🧊 [Health] ${provider} 429 冷卻 ${Math.round((retryAfterMs || 90000) / 1000)}s`);
    }

    on503(provider) {
        const h = this.providers.get(provider);
        if (!h) return;
        h.coolUntil = Date.now() + 30000;  // 30 秒冷卻
        h.reliability *= 0.8;
        console.log(`⚠️ [Health] ${provider} 503 過載，reliability → ${h.reliability.toFixed(2)}`);
    }

    onError(provider) {
        const h = this.providers.get(provider);
        if (!h) return;
        h.coolUntil = Date.now() + 60000;  // 60 秒冷卻
        h.reliability *= 0.5;
        console.log(`❌ [Health] ${provider} 網路錯誤，reliability → ${h.reliability.toFixed(2)}`);
        if (h.reliability < 0.3) {
            console.warn(`⚠️ [Health] ${provider} reliability 過低 (${h.reliability.toFixed(2)})，幾乎不會被選中，請檢查 API key 或網路`);
        }
    }

    onFatal(provider) {
        const h = this.providers.get(provider);
        if (!h) return;
        h.coolUntil = Date.now() + 86400000;  // 24 小時冷卻
        h.reliability = 0;
        console.log(`💀 [Health] ${provider} 致命錯誤（auth/balance），冷卻 24h`);
    }

    /**
     * RPD 重置（太平洋時間午夜呼叫）
     */
    resetAllRpd() {
        for (const [name, h] of this.providers) {
            h.rpd.used = 0;
            if (h.modelUsed) {
                for (const m of Object.keys(h.modelUsed)) h.modelUsed[m] = 0;
            }
            h.reliability = Math.min(1.0, h.reliability * 0.8 + 0.2);  // 緩慢恢復
        }
        console.log('🔄 [Health] RPD 已重置（太平洋時間午夜）');
        this.saveToDisk();
    }

    // --- 委派至 HealthReporter（顯示格式化、DeepSeek 餘額查詢）---

    async fetchDeepSeekBalance(apiKey) { return this.reporter.fetchDeepSeekBalance(apiKey); }
    getDeepSeekBalance()               { return this.reporter.getDeepSeekBalance(); }
    getSummary(adapters)               { return this.reporter.getSummary(this.providers, adapters); }

    /**
     * 防抖寫磁碟（1 秒內多次 onSuccess 只寫一次）
     */
    _debounceSave() {
        if (this._savePending) return;
        this._savePending = true;
        setTimeout(() => {
            this._savePending = false;
            this.saveToDisk();
        }, 1000);
    }

    /**
     * 將各 provider 的 rpd.used 寫入磁碟
     */
    saveToDisk() {
        try {
            const state = {};
            for (const [name, h] of this.providers) {
                state[name] = { used: h.rpd.used, modelUsed: h.modelUsed || {}, date: new Date().toDateString() };
            }
            fs.mkdirSync(path.dirname(this._diskPath), { recursive: true });
            fs.writeFileSync(this._diskPath, JSON.stringify(state, null, 2));
        } catch (e) {
            console.warn('⚠️ [Health] RPD 狀態寫入失敗:', e.message);
        }
    }

    /**
     * 從磁碟讀回 rpd.used（只恢復當天的數據）
     */
    loadFromDisk() {
        try {
            if (!fs.existsSync(this._diskPath)) return;
            const state = JSON.parse(fs.readFileSync(this._diskPath, 'utf-8'));
            const today = new Date().toDateString();
            let restored = 0;
            for (const [name, saved] of Object.entries(state)) {
                if (saved.date !== today) continue;  // 非當天，跳過（已過午夜重置）
                const h = this.providers.get(name);
                if (!h) continue;
                h.rpd.used = saved.used || 0;
                if (saved.modelUsed && h.modelUsed) {
                    for (const [m, v] of Object.entries(saved.modelUsed)) {
                        if (h.modelUsed[m] !== undefined) h.modelUsed[m] = v || 0;
                    }
                }
                restored++;
            }
            if (restored > 0) console.log(`♻️ [Health] RPD 狀態已恢復（${restored} provider(s)）`);
        } catch (e) {
            console.warn('⚠️ [Health] RPD 狀態讀取失敗:', e.message);
        }
    }
}

module.exports = ProviderHealth;
