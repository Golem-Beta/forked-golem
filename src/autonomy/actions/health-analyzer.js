'use strict';
/**
 * @module actions/health-analyzer
 * @role HealthCheck 資料分析 + 報告格式化 — 讀取 journal/log/providers/reflections 並格式化
 * @when-to-modify 新增分析維度、調整報告格式、或更改健康指標定義時
 */
const fs   = require('fs');
const path = require('path');

class HealthAnalyzer {
    constructor({ decision }) {
        this.decision = decision;
    }

    analyzeJournal(cutoff) {
        try {
            const jPath = path.join(process.cwd(), 'memory', 'journal.jsonl');
            if (!fs.existsSync(jPath)) return { total: 0, byOutcome: {}, errors: [], sendFailed: 0, verificationFailed: 0 };
            const cutoffISO = cutoff.toISOString();
            const entries = fs.readFileSync(jPath, 'utf-8').split('\n').filter(Boolean)
                .map(l => { try { return JSON.parse(l); } catch { return null; } })
                .filter(e => e && e.ts && e.ts >= cutoffISO);
            const byOutcome = {};
            const errors = [];
            let sendFailed = 0, verificationFailed = 0;
            for (const e of entries) {
                if (e.action === 'rest') continue;
                byOutcome[e.action + (e.outcome ? '/' + e.outcome : '')] = (byOutcome[e.action + (e.outcome ? '/' + e.outcome : '')] || 0) + 1;
                if (e.action === 'error') errors.push(e.error || e.outcome || '未知錯誤');
                if (e.outcome && e.outcome.includes('send_failed')) sendFailed++;
                if (e.outcome === 'verification_failed') verificationFailed++;
            }
            return { total: entries.length, byOutcome, errors, sendFailed, verificationFailed };
        } catch (e) {
            console.warn('[HealthCheck] journal 分析失敗:', e.message);
            return { total: 0, byOutcome: {}, errors: [], sendFailed: 0, verificationFailed: 0 };
        }
    }

    analyzeLog(cutoff) {
        try {
            const logPath = path.join(process.cwd(), 'logs', 'golem.log');
            if (!fs.existsSync(logPath)) return { errors: [], warns: [], total: 0 };
            const cfg    = this.decision.loadAutonomyConfig();
            const filter = (cfg.actions.health_check || {}).log_filter || {
                levels: ['[ERR]', '[WARN]'], keywords: ['❌', '⚠️', '失敗', '錯誤', '異常', 'FATAL'],
            };
            const errorMap = new Map(), warnMap = new Map();
            for (const line of fs.readFileSync(logPath, 'utf-8').split('\n')) {
                const m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
                if (!m) continue;
                const lineDate = new Date(m[1].replace(' ', 'T'));
                if (isNaN(lineDate.getTime()) || lineDate < cutoff) continue;
                if (!filter.levels.some(lv => line.includes(lv)) && !filter.keywords.some(kw => line.includes(kw))) continue;
                const msg     = line.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, '').trim();
                const display = '[' + m[1].substring(0, 16) + '] ' + msg;
                const tgt     = line.includes('[ERR]') ? errorMap : warnMap;
                const prev    = tgt.get(msg);
                tgt.set(msg, prev ? { ...prev, count: prev.count + 1 } : { display, count: 1 });
            }
            const fmt    = map => Array.from(map.values()).map(v => v.count > 1 ? v.display + ' (×' + v.count + ')' : v.display);
            const errors = fmt(errorMap), warns = fmt(warnMap);
            return { errors, warns, total: errors.length + warns.length };
        } catch (e) {
            console.warn('[HealthCheck] log 分析失敗:', e.message);
            return { errors: [], warns: [], total: 0 };
        }
    }

    analyzeRestartLog(cutoff) {
        try {
            const logPath  = path.join(process.cwd(), 'logs', 'golem-restart.log');
            if (!fs.existsSync(logPath)) return { restarts: [] };
            const restarts = fs.readFileSync(logPath, 'utf-8').split('\n').filter(l => {
                const m = l.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
                return m && new Date(m[1]) >= cutoff;
            });
            return { restarts };
        } catch (e) { return { restarts: [] }; }
    }

    analyzeProviders() {
        try {
            const rpdPath  = path.join(process.cwd(), 'memory', 'rpd-state.json');
            const coolPath = path.join(process.cwd(), 'memory', 'cooldown-state.json');
            const rpdUsage = {}, cooldowns = [], now = Date.now();
            if (fs.existsSync(rpdPath)) {
                const rpd = JSON.parse(fs.readFileSync(rpdPath, 'utf-8'));
                for (const [p, d] of Object.entries(rpd)) rpdUsage[p] = d.used || 0;
            }
            if (fs.existsSync(coolPath)) {
                const cool = JSON.parse(fs.readFileSync(coolPath, 'utf-8'));
                for (const [provider, keys] of Object.entries(cool)) {
                    const maxUntil = Math.max(...Object.values(keys));
                    if (maxUntil > now) {
                        const d = new Date(maxUntil);
                        cooldowns.push({ provider, until: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') });
                    }
                }
            }
            return { rpdUsage, cooldowns };
        } catch (e) {
            console.warn('[HealthCheck] provider 分析失敗:', e.message);
            return { rpdUsage: {}, cooldowns: [] };
        }
    }

    analyzeReflections(cutoff) {
        try {
            const reflDir   = path.join(process.cwd(), 'memory', 'reflections');
            const patchPath = path.join(process.cwd(), 'memory', 'pending-patches.json');
            const cutoffTag = cutoff.toISOString().replace(/[:.]/g, '-').substring(0, 19);
            const recentFiles = fs.existsSync(reflDir)
                ? fs.readdirSync(reflDir).filter(f => f.endsWith('.txt') && f.replace(/^[^-]+-/, '') >= cutoffTag).sort()
                : [];
            const patches = { proposed: 0, deployed: 0, stale: 0 };
            if (fs.existsSync(patchPath)) {
                for (const p of (JSON.parse(fs.readFileSync(patchPath, 'utf-8')) || [])) {
                    if (p.status === 'deployed') patches.deployed++;
                    else if (p.status === 'proposed') { patches.proposed++; if (p.createdAt && new Date(p.createdAt) < cutoff) patches.stale++; }
                }
            }
            return { recentFiles, patches };
        } catch (e) {
            console.warn('[HealthCheck] reflection 分析失敗:', e.message);
            return { recentFiles: [], patches: { proposed: 0, deployed: 0, stale: 0 } };
        }
    }

    formatReport(data) {
        const now     = new Date();
        const dateStr = now.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        const L = ['🏥 健康巡查報告 ' + dateStr, '', '🔄 系統穩定性'];
        L.push(data.restart.restarts.length === 0 ? '重啟記錄：無（正常）' : '⚠️ 發現 ' + data.restart.restarts.length + ' 次重啟');
        data.restart.restarts.forEach(r => L.push('  ' + r));

        const j = data.journal;
        L.push('', '📊 過去 24 小時行動概況（共 ' + j.total + ' 次）');
        L.push('✅ 成功：' + Math.max(0, j.total - j.sendFailed - j.verificationFailed - j.errors.length) + ' 次');
        if (j.sendFailed > 0)       L.push('❌ send_failed：' + j.sendFailed + ' 次');
        if (j.verificationFailed > 0) L.push('⚠️ verification_failed：' + j.verificationFailed + ' 次');
        if (Object.keys(j.byOutcome).length > 0) {
            L.push('📋 outcome 分布：');
            Object.entries(j.byOutcome).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => L.push('  ' + k + ': ' + v));
        }

        L.push('', '⚠️ 系統日誌異常');
        if (data.log.total === 0) { L.push('✅ 無異常'); }
        else {
            if (data.log.errors.length > 0) { L.push('錯誤（' + data.log.errors.length + ' 條）：'); data.log.errors.slice(0, 10).forEach(e => L.push('× ' + e)); }
            if (data.log.warns.length > 0)  { L.push('警告（' + data.log.warns.length  + ' 條）：'); data.log.warns.slice(0, 10).forEach(w => L.push('~ ' + w)); }
        }

        L.push('', '🔌 Provider 狀態');
        const rpdEntries = Object.entries(data.providers.rpdUsage);
        if (rpdEntries.length > 0) L.push('RPD 今日用量：' + rpdEntries.map(([p, n]) => p + ' ' + n).join(' / '));
        L.push(data.providers.cooldowns.length > 0
            ? '冷卻中：' + data.providers.cooldowns.map(c => c.provider + '（至 ' + c.until + '）').join('、')
            : '✅ 全部正常');

        const r = data.reflections;
        L.push('', '🪞 自我反思狀況', '最近 24h 反思檔：' + r.recentFiles.length + ' 個');
        L.push((r.patches.proposed > 0 || r.patches.deployed > 0 || r.patches.stale > 0)
            ? '提案：deployed ' + r.patches.deployed + ' / proposed ' + r.patches.proposed + ' / 過期未處理 ' + r.patches.stale
            : '✅ 無待處理提案');
        return L.join('\n');
    }
}

module.exports = HealthAnalyzer;
