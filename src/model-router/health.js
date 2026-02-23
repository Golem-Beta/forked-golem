/**
 * ProviderHealth — 追蹤每個 provider 的即時健康狀態
 */
class ProviderHealth {
    constructor() {
        this.providers = new Map();  // provider name → health state
        this._deepseekBalance = null; // { total, granted, topped_up }
        this._deepseekBalanceTs = 0;  // 上次查詢時間
        this._diskPath = path.join(process.cwd(), 'memory', 'rpd-state.json');
        this._savePending = false;
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
        this.saveToDisk();
    }

    /**
     * 查詢 DeepSeek 帳戶餘額
     * @param {string} apiKey
     */
    async fetchDeepSeekBalance(apiKey) {
        if (!apiKey) return null;
        try {
            const resp = await fetch('https://api.deepseek.com/user/balance', {
                headers: { 'Authorization': 'Bearer ' + apiKey }
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            if (data.balance_infos && data.balance_infos.length > 0) {
                const info = data.balance_infos[0];
                this._deepseekBalance = {
                    total: parseFloat(info.total_balance),
                    granted: parseFloat(info.granted_balance),
                    topped_up: parseFloat(info.topped_up_balance),
                };
                this._deepseekBalanceTs = Date.now();
                return this._deepseekBalance;
            }
        } catch (e) {
            // 查詢失敗不影響正常運作
        }
        return null;
    }

    /**
     * 取得快取的 DeepSeek 餘額（不發 API 請求）
     */
    getDeepSeekBalance() {
        return this._deepseekBalance;
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
                state[name] = { used: h.rpd.used, date: new Date().toDateString() };
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
                restored++;
            }
            if (restored > 0) console.log(`♻️ [Health] RPD 狀態已恢復（${restored} provider(s)）`);
        } catch (e) {
            console.warn('⚠️ [Health] RPD 狀態讀取失敗:', e.message);
        }
    }
}

module.exports = ProviderHealth;
