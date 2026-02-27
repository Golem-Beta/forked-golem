/**
 * @module failure-tracker
 * @role 追蹤 action 失敗模式，達閾值時回報給管理員並設暫停旗標
 */

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 小時

class FailureTracker {
    constructor(notifier) {
        this.notifier = notifier;
        /** @type {Map<string, { count: number, lastTs: number, coolingUntil: number }>} */
        this._map = new Map();
    }

    /**
     * 回報一次失敗，若達閾值則通知並冷卻
     * @param {import('./action-result').ActionResult} result
     */
    async record(result) {
        if (result.success) return;
        const key = result.target
            ? result.action + ':' + result.target
            : result.action + ':' + result.outcome;

        const now = Date.now();
        const entry = this._map.get(key) || { count: 0, lastTs: 0, coolingUntil: 0 };
        entry.count++;
        entry.lastTs = now;
        this._map.set(key, entry);

        if (entry.count >= FAILURE_THRESHOLD && now > entry.coolingUntil) {
            entry.coolingUntil = now + COOLDOWN_MS;
            const msg = [
                '⚠️ **Failure Pattern 偵測**',
                '行動: ' + result.action,
                result.target ? '目標: ' + result.target : '',
                '失敗次數: ' + entry.count,
                '最後 outcome: ' + result.outcome,
                result.detail ? '細節: ' + result.detail : '',
                '',
                '→ 此 key 已暫停 24 小時，請人工介入。',
            ].filter(Boolean).join('\n');
            await this.notifier.sendToAdmin(msg);
            console.warn('⚠️ [FailureTracker] 閾值觸發:', key, '× ' + entry.count);
        }
    }

    /** 查詢某 key 是否在冷卻期（給 decision 用，未來可注入 prompt） */
    isCooling(action, target = '') {
        const key = target ? action + ':' + target : action;
        const entry = this._map.get(key);
        return entry ? Date.now() < entry.coolingUntil : false;
    }

    /** 匯出失敗摘要（給 decision prompt 注入用，#3 的後半） */
    getSummary() {
        const lines = [];
        for (const [key, e] of this._map.entries()) {
            if (e.count === 0) continue;
            const cooling = Date.now() < e.coolingUntil ? ' [冷卻中]' : '';
            lines.push(key + ': 失敗 ' + e.count + ' 次' + cooling);
        }
        return lines.length ? lines.join('\n') : '(無失敗記錄)';
    }
}

module.exports = { FailureTracker };
