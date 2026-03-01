/**
 * @module action-filter
 * @role 行動可用性過濾 — 根據 dailyLimit、blockedHours、硬限制、靜默佇列決定可選行動清單
 * @when-to-modify 調整硬限制時間、morning_digest 邏輯、或新增行動過濾規則時
 *
 * 被 DecisionEngine 在每次自主決策前呼叫。
 * cfg 由呼叫方（decision.js）載入後傳入，此模組本身不做 IO。
 */
'use strict';

class ActionFilter {
    // 各行動的硬限制（程式層強制，不進入 LLM 決策）
    static get HARD_LIMITS() {
        return {
            gmail_check: 2 * 60 * 60 * 1000,   // 2 小時
            drive_sync:  6 * 60 * 60 * 1000,   // 6 小時
        };
    }

    getAvailableActions({ journal, notifier, cfg }) {
        const now = new Date();
        const hour = now.getHours();
        const today = now.toISOString().slice(0, 10);
        // 多讀 50 條以覆蓋硬限制查詢（gmail/drive 可能超出 decisionReadCount）
        const hardLimitEntries = journal.readRecent(50);
        const entries = hardLimitEntries.slice(-(cfg.journal.decisionReadCount));

        // 硬限制輔助：找最後一次執行時間（ms）
        const lastRunMs = (actionName) => {
            const entry = hardLimitEntries.filter(e => e.action === actionName).slice(-1)[0];
            return entry?.ts ? new Date(entry.ts).getTime() : 0;
        };
        const HARD_LIMITS = ActionFilter.HARD_LIMITS;
        const passesHardLimit = (id) => {
            const limit = HARD_LIMITS[id];
            if (!limit) return true;
            return (now.getTime() - lastRunMs(id)) >= limit;
        };

        const lastAction = entries.filter(j => j.action !== 'error').slice(-1)[0];
        const minutesSinceLast = lastAction && lastAction.ts
            ? (now.getTime() - new Date(lastAction.ts).getTime()) / 60000
            : Infinity;

        const available = [];

        for (const [id, actionCfg] of Object.entries(cfg.actions)) {
            if (id === 'rest') continue;

            // 硬限制：未達時間門檻，直接從候選清單移除
            if (!passesHardLimit(id)) continue;

            let blocked = false;
            let note = '';

            if (actionCfg.dailyLimit) {
                const todayCount = entries.filter(
                    j => j.action === id && j.ts && j.ts.startsWith(today)
                ).length;
                if (todayCount >= actionCfg.dailyLimit) {
                    blocked = true;
                    note = '今天已達上限 (' + todayCount + '/' + actionCfg.dailyLimit + ')';
                }
            }

            if (!blocked && actionCfg.blockedHours && actionCfg.blockedHours.includes(hour)) {
                blocked = true;
                note = '目前時段不適合';
            }

            if (!blocked) {
                // 硬限制行動用 hardLimitEntries 以確保找得到（可能超出 decisionReadCount）
                const lastOfType = (HARD_LIMITS[id]
                    ? hardLimitEntries
                    : entries
                ).filter(j => j.action === id).slice(-1)[0];
                if (lastOfType) {
                    const agoMs = lastOfType.ts
                        ? now.getTime() - new Date(lastOfType.ts).getTime()
                        : null;
                    if (HARD_LIMITS[id] && agoMs !== null) {
                        // 硬限制行動：小時顯示（更直觀）
                        note = '上次 ' + (agoMs / 3600000).toFixed(1) + ' 小時前';
                    } else {
                        note = '上次 ' + (agoMs !== null ? Math.round(agoMs / 60000) + ' 分鐘前' : '時間不明');
                    }
                    if (lastOfType.outcome) note += '，結果: ' + lastOfType.outcome;
                } else {
                    note = '從未執行過';
                }
                available.push({ id, desc: actionCfg.desc, note });
            }
        }

        const restNote = minutesSinceLast < cfg.cooldown.minActionGapMinutes
            ? '距離上次行動僅 ' + Math.round(minutesSinceLast) + ' 分鐘'
            : '';

        // morning_digest：有靜默 queue 且今天尚未執行才加入可選
        if (cfg.actions.morning_digest) {
            const queueLen = notifier ? notifier._quietQueue.length : 0;
            const digestToday = entries.filter(j => j.action === 'morning_digest' && j.ts && j.ts.startsWith(today)).length;
            const digestLimit = cfg.actions.morning_digest.dailyLimit || 1;
            const digestBlocked = cfg.actions.morning_digest.blockedHours && cfg.actions.morning_digest.blockedHours.includes(hour);
            if (!digestBlocked && queueLen > 0 && digestToday < digestLimit) {
                available.unshift({
                    id: 'morning_digest',
                    desc: cfg.actions.morning_digest.desc,
                    note: '有 ' + queueLen + ' 則未匯報的靜默時段訊息'
                });
            }
        }

        available.push({ id: 'rest', desc: cfg.actions.rest.desc, note: restNote });
        return available;
    }
}

module.exports = ActionFilter;
