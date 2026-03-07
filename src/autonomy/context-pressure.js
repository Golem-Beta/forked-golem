/**
 * @module autonomy/context-pressure
 * @role 情境壓力分析層 — 純規則、零 LLM、同步執行，閉合感知→決策迴路
 * @output evaluate() → 可插入 decision prompt 的純文字訊號 section
 *
 * 壓力來源：
 *   1. 失敗模式（連續失敗、特定 action 高失敗率）
 *   2. 重要行動長時間未執行（idle 閾值偵測）
 *   3. 外部感知（RSS 未消化、Moltbook 待回應 DM）
 *   4. 連續 rest 過多
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { checkFailurePatterns } = require('./failure-classifier');

// 重要行動的閒置警告閾值（毫秒）
const IDLE_THRESHOLDS = {
    health_check:    24 * 3600000,  // 24h
    self_reflection: 48 * 3600000,  // 48h
    github_explore:  72 * 3600000,  // 72h
    moltbook_check:   6 * 3600000,  // 6h（有 MOLTBOOK_API_KEY 才啟用）
};

const STATE_FILE = path.join(process.cwd(), 'data', 'moltbook-state.json');

class ContextPressure {
    /**
     * @param {object} deps
     * @param {import('./journal')} deps.journal
     * @param {object} deps.notifier
     */
    constructor({ journal, notifier }) {
        this.journal  = journal;
        this.notifier = notifier;
    }

    /**
     * 分析當前情境，回傳壓力訊號 section（空字串表示無壓力）
     * @returns {string}
     */
    evaluate() {
        try {
            const recent = this.journal.readRecent(30);
            const signals = [
                ...checkFailurePatterns(recent),
                ...this._checkIdleActions(),
                ...this._checkExternalSignals(recent),
                ...this._checkConsecutiveRest(recent),
            ];
            if (signals.length === 0) return '';
            return '【情境壓力訊號】（優先考慮以下因素）\n' + signals.join('\n');
        } catch (e) {
            return ''; // 壓力分析失敗不影響決策主流程
        }
    }

    // ── 重要行動閒置偵測 ────────────────────────────────────────────────────

    _checkIdleActions() {
        const signals = [];
        const now = Date.now();
        const entries = this.journal.readRecent(100); // 大窗口確保抓到遠期執行記錄

        const lastRan = {};
        for (const e of entries) {
            if (IDLE_THRESHOLDS[e.action] && e.ts) {
                if (!lastRan[e.action] || e.ts > lastRan[e.action]) lastRan[e.action] = e.ts;
            }
        }

        for (const [action, threshold] of Object.entries(IDLE_THRESHOLDS)) {
            if (action === 'moltbook_check' && !process.env.MOLTBOOK_API_KEY) continue;
            const last = lastRan[action];
            const idleMs = last ? now - new Date(last).getTime() : Infinity;
            if (idleMs > threshold) {
                const since = last ? `已 ${Math.round(idleMs / 3600000)}h 未執行` : '從未執行';
                signals.push(`⏰ ${action} ${since}，建議優先執行`);
            }
        }
        return signals;
    }

    // ── 外部感知訊號 ────────────────────────────────────────────────────────

    _checkExternalSignals(entries) {
        const signals = [];

        // RSS 有新項目尚未消化
        let lastFetchIdx = -1;
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].action === 'rss_fetch' && (entries[i].total || 0) > 0) {
                lastFetchIdx = i;
                break;
            }
        }
        if (lastFetchIdx >= 0) {
            const digestAfter = entries.slice(lastFetchIdx + 1)
                .some(e => e.action === 'digest' || e.action === 'morning_digest');
            if (!digestAfter) {
                signals.push(`📡 RSS 有 ${entries[lastFetchIdx].total} 則新項目待消化，建議執行 digest`);
            }
        }

        // Moltbook 待回應 DM（history 最後一條不是自己發的）
        try {
            if (process.env.MOLTBOOK_API_KEY && fs.existsSync(STATE_FILE)) {
                const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                const pending = Object.values(state.dmHistory || {}).filter(hist => {
                    return hist.length > 0 && hist[hist.length - 1].role !== 'me';
                }).length;
                if (pending > 0) {
                    signals.push(`💬 Moltbook 有 ${pending} 個 DM 對話待回應`);
                }
            }
        } catch (e) { /* 不影響主流程 */ }

        // API schema 漂移偵測
        const recentMismatch = entries.slice(-10).filter(e => e.outcome === 'api_schema_mismatch');
        if (recentMismatch.length > 0) {
            const acts = [...new Set(recentMismatch.map(e => e.action))].join(', ');
            signals.push('[schema] ' + acts + ' API schema 不符（最近 ' + recentMismatch.length + ' 次），程式碼需更新 - 建議執行 self_reflection');
        }

        return signals;
    }

    // ── 連續 rest 偵測 ──────────────────────────────────────────────────────

    _checkConsecutiveRest(entries) {
        let streak = 0;
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].action === 'rest') streak++;
            else break;
        }
        if (streak >= 4) return [`😴 已連續 rest ${streak} 次，請主動採取行動`];
        return [];
    }
}

module.exports = ContextPressure;
