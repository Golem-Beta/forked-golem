/**
 * @module model-router/health-reporter
 * @role Provider 啟動摘要生成與 DeepSeek 餘額查詢
 * @when-to-modify 調整顯示格式、或 DeepSeek Balance API 回應結構變更時
 *
 * 與 health.js 的職責分界：
 *   health.js    — 狀態追蹤（providers Map 讀寫、RPD 計數、冷卻、持久化）
 *   health-reporter.js — 輸出（摘要文字格式化、DeepSeek 外部 API 查詢）
 */

'use strict';

class HealthReporter {
    constructor() {
        this._deepseekBalance    = null;
        this._deepseekBalanceTs  = 0;
    }

    /**
     * 查詢 DeepSeek 帳戶餘額（外部 API 呼叫）
     * @param {string} apiKey
     */
    async fetchDeepSeekBalance(apiKey) {
        if (!apiKey) return null;
        try {
            const resp = await fetch('https://api.deepseek.com/user/balance', {
                headers: { 'Authorization': 'Bearer ' + apiKey },
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            if (data.balance_infos && data.balance_infos.length > 0) {
                const info = data.balance_infos[0];
                this._deepseekBalance = {
                    total:     parseFloat(info.total_balance),
                    granted:   parseFloat(info.granted_balance),
                    topped_up: parseFloat(info.topped_up_balance),
                };
                this._deepseekBalanceTs = Date.now();
                return this._deepseekBalance;
            }
        } catch (e) { /* 查詢失敗不影響正常路由 */ }
        return null;
    }

    /**
     * 取得快取的 DeepSeek 餘額（不發 API 請求）
     */
    getDeepSeekBalance() {
        return this._deepseekBalance;
    }

    /**
     * 啟動摘要文字（providers Map + adapters Map → 字串）
     * @param {Map} providers   - ProviderHealth.providers
     * @param {Map} [adapters]  - ModelRouter.adapters（顯示 key 數量用）
     */
    getSummary(providers, adapters) {
        const lines = [];
        for (const [name, h] of providers) {
            if (!h.hasKey) continue;
            const rpdStr = h.rpd.limit === Infinity ? '∞' : String(h.rpd.limit);
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

module.exports = HealthReporter;
