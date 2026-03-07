'use strict';
/**
 * @module model-router/roster-manager
 * @role Benchmark 後 roster 修剪：每個 provider 每個 capability 維度保留最優代表
 * @when-to-modify 調整 roster 選拔邏輯或 benched/revival 規則時
 *
 * 規則：
 *   1. 候選範圍：status=active 或 status=benched（有 benchmarkDate 的才算）
 *   2. 每個 capability 維度選出分數最高的代表（平手選 avgLatencyMs 較低者）
 *   3. 合併各維度代表（去重），不足 maxActiveModels 時補入整體分數最高者
 *   4. 入選 → active；落選 active → benched；落選 benched 維持 benched
 *   5. benched model 若新分數超越現有同維度代表 → 復活為 active（由本函式統一重算）
 */

const registry       = require('./provider-registry');
const PROVIDER_CONFIGS = require('./configs');

/**
 * 計算 model 的 benchmark 總分（benchmarkScores 各值加總）
 * @param {object} info - registry model 條目
 * @returns {number}
 */
function _totalScore(info) {
    const scores = info.benchmarkScores || {};
    return Object.values(scores).reduce((s, v) => s + (v || 0), 0);
}

/**
 * 對每個 provider 執行 roster 修剪。
 * @returns {boolean} 是否有任何 status 變更
 */
function pruneToRoster() {
    const reg = registry.load();
    let changed = false;

    for (const [provName, config] of Object.entries(PROVIDER_CONFIGS)) {
        const maxActive = config.maxActiveModels || 4;
        const provData  = reg.providers[provName];
        if (!provData) continue;

        const models = provData.models || {};

        // 候選：active 或 benched，且已有 benchmarkDate（跑過測試的）
        const candidates = Object.entries(models)
            .filter(([, info]) =>
                (info.status === 'active' || info.status === 'benched') &&
                info.benchmarkDate
            )
            .map(([model, info]) => ({ model, info }));

        if (candidates.length === 0) continue;

        // 收集所有出現過的 capability 維度
        const capDims = new Set();
        for (const { info } of candidates) {
            for (const cap of (info.capabilities || [])) capDims.add(cap);
        }

        // 每個維度選最優代表
        const rosterSet = new Set();
        for (const cap of capDims) {
            const capCandidates = candidates.filter(({ info }) =>
                (info.capabilities || []).includes(cap)
            );
            if (capCandidates.length === 0) continue;

            capCandidates.sort((a, b) => {
                const scoreDiff = _totalScore(b.info) - _totalScore(a.info);
                if (scoreDiff !== 0) return scoreDiff;
                return (a.info.avgLatencyMs || 9999) - (b.info.avgLatencyMs || 9999);
            });

            rosterSet.add(capCandidates[0].model);
        }

        // 空位補入整體分數最高者（直到 maxActiveModels）
        const sortedAll = [...candidates].sort((a, b) => _totalScore(b.info) - _totalScore(a.info));
        for (const { model } of sortedAll) {
            if (rosterSet.size >= maxActive) break;
            rosterSet.add(model);
        }

        // 更新 status
        for (const { model, info } of candidates) {
            const shouldBeActive = rosterSet.has(model);

            if (shouldBeActive && info.status !== 'active') {
                models[model].status = 'active';
                // 清除 benched 標記
                models[model].notes = (info.notes || '').replace(/\s*\[benched [^\]]+\]/g, '').trim();
                changed = true;
            } else if (!shouldBeActive && info.status === 'active') {
                models[model].status = 'benched';
                const today = new Date().toISOString().split('T')[0];
                models[model].notes = ((info.notes || '').trim() + ` [benched ${today}]`).trim();
                changed = true;
            }
        }
    }

    if (changed) registry.save(reg);
    return changed;
}

module.exports = { pruneToRoster };
