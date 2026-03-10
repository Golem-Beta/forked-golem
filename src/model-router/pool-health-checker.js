'use strict';
/**
 * @module model-router/pool-health-checker
 * @role Benchmark 後 active pool 健康評估 + 不足時自動排入復測
 * @when-to-modify 調整閾值定義或復測觸發邏輯時
 *
 * 閾值（可被 autonomy.json poolHealth 欄位覆蓋）：
 *   tristream >= 2   — 低於此為 CRITICAL，發 Telegram 通知
 *   total    >= 4    — 低於此為 WARNING，標記 benched model 復測
 *
 * 防誤刪設計（與 runner.js failureStreak 搭配）：
 *   model 至少連續 2 次 benchmark 失敗才會被 disabled；
 *   pool 不足時優先從 benched 找復測候選，而非從 disabled 找。
 */

const registryMod = require('./provider-registry');

const DEFAULTS = {
    minTristream: 2,   // tristream active 最低數量
    minTotal:     4,   // 整體 active 最低數量
    rebenchDays:  7,   // benched/pending 超過幾天視為候選復測
};

/**
 * 評估目前 active pool 健康度，不足時自動標記復測候選。
 *
 * @param {object} [opts]
 * @param {number} [opts.minTristream]
 * @param {number} [opts.minTotal]
 * @param {number} [opts.rebenchDays]
 * @returns {{
 *   healthy: boolean,
 *   level: 'ok'|'warning'|'critical',
 *   activeTotal: number,
 *   tristreamCount: number,
 *   issues: string[],
 *   revivals: string[],
 *   needsNotify: boolean,
 *   notifyMsg: string,
 * }}
 */
function checkPoolHealth(opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };
    // 嘗試從 autonomy.json 讀取覆蓋值
    try {
        const autonomyPath = require('path').join(process.cwd(), 'config', 'autonomy.json');
        if (require('fs').existsSync(autonomyPath)) {
            const autonomy = JSON.parse(require('fs').readFileSync(autonomyPath, 'utf-8'));
            if (autonomy.poolHealth) Object.assign(cfg, autonomy.poolHealth);
        }
    } catch (_) {}

    const reg = registryMod.load();
    const now = Date.now();
    const cutoffMs = cfg.rebenchDays * 24 * 60 * 60 * 1000;

    // 統計 active pool
    let activeTotal = 0;
    let tristreamCount = 0;
    for (const provData of Object.values(reg.providers)) {
        for (const info of Object.values(provData.models || {})) {
            if (info.status !== 'active') continue;
            activeTotal++;
            if ((info.capabilities || []).includes('tristream')) tristreamCount++;
        }
    }

    const issues = [];
    let level = 'ok';

    if (tristreamCount < cfg.minTristream) {
        issues.push(`tristream active 不足：${tristreamCount} / 最低 ${cfg.minTristream}`);
        level = 'critical';
    }
    if (activeTotal < cfg.minTotal) {
        issues.push(`active 總數不足：${activeTotal} / 最低 ${cfg.minTotal}`);
        if (level !== 'critical') level = 'warning';
    }

    // 找復測候選（benched 或 pending_benchmark，且距上次 benchmark 超過閾值天數）
    const revivals = [];
    if (level !== 'ok') {
        let changed = false;
        for (const [prov, provData] of Object.entries(reg.providers)) {
            for (const [model, info] of Object.entries(provData.models || {})) {
                if (info.status !== 'benched' && info.status !== 'pending_benchmark') continue;
                // disabled 不納入（連續 2 次失敗，需要更謹慎的人工評估）
                const lastBench = info.benchmarkDate ? new Date(info.benchmarkDate).getTime() : 0;
                const isStale   = !info.benchmarkDate || (now - lastBench) > cutoffMs;
                if (!isStale) continue;
                // 標記為 pending_benchmark，讓下次 benchmark 重測
                if (info.status !== 'pending_benchmark') {
                    registryMod.updateModelStatus(prov, model, { status: 'pending_benchmark' });
                    changed = true;
                }
                revivals.push(`${prov}/${model} (${info.status}, lastBench: ${info.benchmarkDate || '從未'})`);
            }
        }
    }

    const healthy = level === 'ok';
    const needsNotify = level === 'critical';

    let notifyMsg = '';
    if (needsNotify) {
        notifyMsg = [
            '⚠️ **Model Pool 健康警告 (CRITICAL)**',
            issues.map(i => `• ${i}`).join('\n'),
            revivals.length
                ? `\n🔄 已排入復測：${revivals.length} 個 model`
                : '\n⚠️ 無可復測候選，請手動補充 API key 或新增 model',
        ].join('\n');
    }

    return { healthy, level, activeTotal, tristreamCount, issues, revivals, needsNotify, notifyMsg };
}

module.exports = { checkPoolHealth };
