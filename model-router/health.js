/**
 * ProviderHealth — 追蹤每個 provider 的即時健康狀態
 */
class ProviderHealth {
    constructor() {
        this.providers = new Map();  // provider name → health state
    }

    register(name, config) {
        // 取第一個模型的 RPD limit 作為預設
        const rpdLimits = config.rpdLimits || {};
        const firstLimit = Object.values(rpdLimits)[0] || 1000;

        this.providers.set(name, {
            hasKey: true,
            rpd: { used: 0, limit: firstLimit },
            rpm: { used: 0, limit: config.defaultRpm || 30 },
            reliability: 1.0,
            coolUntil: 0,
            lastSuccess: 0,
            rpdLimits: rpdLimits,  // 保留完整的 per-model limits
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
        const h = this.get(provider, model);
        if (!h || !h.hasKey) return false;
        if (h.coolUntil > Date.now()) return false;
        if (h.rpd.limit !== Infinity && h.rpd.used >= h.rpd.limit * 0.95) return false;
        return true;
    }

    /**
     * 計算健康分數：RPD 餘量 × 可靠度
     */
    score(provider, model) {
        const h = this.get(provider, model);
        if (!h) return 0;
        if (h.rpd.limit === Infinity) return h.reliability;  // DeepSeek 等無 RPD 限制
        return (1 - h.rpd.used / h.rpd.limit) * h.reliability;
    }

    // --- 狀態更新 ---

    onSuccess(provider) {
        const h = this.providers.get(provider);
        if (!h) return;
        h.rpd.used++;
        h.lastSuccess = Date.now();
        // reliability 緩慢恢復（指數移動平均）
        h.reliability = Math.min(1.0, h.reliability * 0.9 + 0.1);
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
            h.reliability = Math.min(1.0, h.reliability * 0.8 + 0.2);  // 緩慢恢復
        }
        console.log('🔄 [Health] RPD 已重置（太平洋時間午夜）');
    }

    /**
     * 啟動摘要
     */
    getSummary(adapters) {
        const lines = [];
        for (const [name, h] of this.providers) {
            if (!h.hasKey) continue;
            const rpdStr = h.rpd.limit === Infinity ? '∞' : String(h.rpd.limit);
            // 顯示 key 數量（如果 adapter 有 keys 屬性）
            let keyInfo = '';
            if (adapters) {
                const adapter = adapters.get(name);
                if (adapter && adapter.keys) {
                    keyInfo = `, ${adapter.keys.length} key(s)`;
                }
            }
            lines.push(`  ${name}: RPD limit ${rpdStr}${keyInfo}`);
        }
        return lines.join('\n');
    }
}

module.exports = ProviderHealth;
