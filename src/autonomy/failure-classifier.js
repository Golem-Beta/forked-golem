'use strict';
/**
 * @module autonomy/failure-classifier
 * @role 純函式失敗模式分類 — 判斷失敗類型、連續失敗趨勢、高失敗率 action
 * @when-to-modify 調整失敗分類關鍵字或高失敗率閾值時；無外部依賴、純同步
 */

/** 判斷單一 journal 條目是否為失敗 */
function isFailed(e) {
    const o = e.outcome || '';
    return o.includes('fail') || o.includes('error') || e.action === 'error';
}

/** 判斷單一失敗條目的根因類型（external / config / general） */
function classifyFailure(e) {
    const o        = (e.outcome || '').toLowerCase();
    const EXTERNAL = ['send_failed', 'fetch_failed', 'network', 'timeout', 'rate_limited', 'connection'];
    const CONFIG   = ['folder_missing', 'verification_failed', 'config', 'not_found', 'missing'];
    if (EXTERNAL.some(k => o.includes(k))) return 'external';
    if (CONFIG.some(k => o.includes(k)))   return 'config';
    return 'general';
}

/** 判斷連續失敗片段的主導類型（需佔 ≥60% 才認定） */
function classifyStreak(entries) {
    const types = entries.filter(e => isFailed(e)).map(e => classifyFailure(e));
    const ext   = types.filter(t => t === 'external').length;
    const cfg   = types.filter(t => t === 'config').length;
    if (ext >= cfg && ext >= Math.ceil(types.length * 0.6)) return 'external';
    if (cfg > ext  && cfg >= Math.ceil(types.length * 0.6)) return 'config';
    return 'general';
}

/**
 * 分析 journal entries 的失敗模式，回傳壓力訊號陣列。
 * 偵測兩類問題：連續失敗（streak ≥ 3）、特定 action 高失敗率（≥ 60%，≥ 3 次嘗試）
 * @param {object[]} entries
 * @returns {string[]}
 */
function checkFailurePatterns(entries) {
    const signals = [];
    const nonRest = entries.filter(e => e.action !== 'rest');
    if (nonRest.length === 0) return signals;

    // 連續失敗（分類後給出不同建議）
    let streak = 0;
    for (let i = nonRest.length - 1; i >= 0; i--) {
        if (isFailed(nonRest[i])) streak++;
        else break;
    }
    if (streak >= 3) {
        const failType = classifyStreak(nonRest.slice(-streak));
        if (failType === 'external') {
            signals.push(`⚠️ 最近 ${streak} 次行動連續外部依賴失敗（網路/API），建議稍待後重試`);
        } else if (failType === 'config') {
            signals.push(`⚠️ 最近 ${streak} 次行動連續設定/程式問題，建議執行 self_reflection 或回報主人`);
        } else {
            signals.push(`⚠️ 最近 ${streak} 次行動連續失敗，建議換策略或執行 health_check`);
        }
    }

    // 特定 action 高失敗率（最近 20 筆，需至少 3 次嘗試）
    const stats = {};
    for (const e of nonRest.slice(-20)) {
        if (!stats[e.action]) stats[e.action] = { t: 0, f: 0, extF: 0, cfgF: 0 };
        stats[e.action].t++;
        if (isFailed(e)) {
            stats[e.action].f++;
            const ft = classifyFailure(e);
            if (ft === 'external') stats[e.action].extF++;
            else if (ft === 'config') stats[e.action].cfgF++;
        }
    }
    for (const [act, s] of Object.entries(stats)) {
        if (s.t >= 3 && s.f / s.t >= 0.6) {
            const pct = Math.round(s.f / s.t * 100);
            if (s.extF >= s.cfgF && s.extF > 0) {
                signals.push(`⚠️ ${act} 外部依賴失敗率 ${pct}%（${s.f}/${s.t}），暫時等待避免消耗配額`);
            } else if (s.cfgF > s.extF) {
                signals.push(`⚠️ ${act} 設定/程式問題失敗率 ${pct}%（${s.f}/${s.t}），需要診斷或主人介入`);
            } else {
                signals.push(`⚠️ ${act} 近期失敗率 ${pct}%（${s.f}/${s.t}），暫時迴避`);
            }
        }
    }
    return signals;
}

module.exports = { isFailed, classifyFailure, classifyStreak, checkFailurePatterns };
