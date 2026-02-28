'use strict';
/**
 * @module maintenance/journal-stats
 * @role 統計 journal 行動分布、成功率、provider 用量，記錄快照到 journal
 * @llm-free true
 */
const fs = require('fs');
const path = require('path');
const MaintenanceAction = require('./base');

const JOURNAL_PATH = path.join(process.cwd(), 'memory', 'journal.jsonl');
const LOOKBACK_DAYS = 7;

class JournalStatsAction extends MaintenanceAction {
    constructor(deps) { super(deps, 'journal_stats'); }

    async run() {
        const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;
        let entries = [];
        try {
            const raw = fs.readFileSync(JOURNAL_PATH, 'utf8').trim().split('\n');
            entries = raw.map(l => { try { return JSON.parse(l); } catch { return null; } })
                .filter(e => e && new Date(e.ts).getTime() > cutoff);
        } catch (e) {
            this._record('error', { error: e.message });
            return { success: false, error: e.message };
        }

        // 行動分布
        const actionCounts = {};
        const outcomeCounts = {};
        entries.forEach(e => {
            if (e.action) actionCounts[e.action] = (actionCounts[e.action] || 0) + 1;
            if (e.outcome) {
                const key = e.action + '/' + e.outcome;
                outcomeCounts[key] = (outcomeCounts[key] || 0) + 1;
            }
        });

        // 成功率
        const successRate = entries.length > 0
            ? (entries.filter(e => e.outcome && !e.outcome.includes('fail') && !e.outcome.includes('error')).length / entries.length * 100).toFixed(1)
            : 0;

        const topActions = Object.entries(actionCounts)
            .sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([k, v]) => `${k}:${v}`).join(', ');

        const summary = `過去${LOOKBACK_DAYS}天 ${entries.length} 筆 | 成功率 ${successRate}% | top: ${topActions}`;
        console.log(`📊 [JournalStats] ${summary}`);

        this._record('completed', {
            period_days: LOOKBACK_DAYS,
            total: entries.length,
            success_rate: parseFloat(successRate),
            top_actions: actionCounts,
            outcome_breakdown: outcomeCounts,
            summary,
        });

        return { success: true, summary, total: entries.length, successRate };
    }
}

module.exports = JournalStatsAction;
