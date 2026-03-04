'use strict';
/**
 * @module actions/health-check
 * @role HealthCheckAction — 巡查過去 24h 系統健康：協調分析、通知、觸發 self_reflection
 * @when-to-modify 調整業務流程、self_reflection 觸發條件、或通知邏輯時
 */
const fs   = require('fs');
const path = require('path');
const HealthAnalyzer = require('./health-analyzer');
const BaseAction = require('./base-action');

class HealthCheckAction extends BaseAction {
    constructor({ journal, notifier, decision }) {
        super({ journal, notifier, decision });
        this._analyzer = new HealthAnalyzer({ decision });
    }

    async run() {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        console.log('🏥 [HealthCheck] 開始健康巡查...');
        this._checkIndexHealth();
        this._cleanOrphanNodes();
        await this._checkMemoryHealth();
        const data = {
            journal:     this._analyzer.analyzeJournal(cutoff),
            log:         this._analyzer.analyzeLog(cutoff),
            restart:     this._analyzer.analyzeRestartLog(cutoff),
            providers:   this._analyzer.analyzeProviders(),
            reflections: this._analyzer.analyzeReflections(cutoff),
        };
        const report = this._analyzer.formatReport(data);
        const needsReflection = this._shouldTriggerReflection(data);
        const sent = await this.notifier.sendToAdmin(report);
        this.journal.append({
            action: 'health_check',
            outcome: this._sentOutcome(sent, 'reported'),
            anomalies: data.log.errors.length + data.log.warns.length,
            needsReflection,
            ...this._sentErrorField(sent)
        });
        return { success: true, action: 'health_check', needsReflection };
    }

    _cleanOrphanNodes() {
        try {
            const { execSync } = require('child_process');
            const selfPid = process.pid;
            const lines = execSync('ps -eo pid,etimes,comm,args --no-headers', { encoding: 'utf8' }).split('\n');
            const killed = [];
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 4) continue;
                const pid = parseInt(parts[0]);
                const etimes = parseInt(parts[1]); // 存活秒數
                const comm = parts[2];
                const args = parts.slice(3).join(' ');
                if (comm !== 'node') continue;
                if (pid === selfPid) continue;
                if (args.includes('index.js') || args.includes('npm')) continue;
                if (etimes < 1800) continue; // 小於 30 分鐘不管
                try {
                    process.kill(pid, 'SIGTERM');
                    killed.push({ pid, etimes: Math.round(etimes / 60) + 'm', args: args.slice(0, 60) });
                    console.log(`🧹 [HealthCheck] 清除孤兒 node process PID:${pid} (${Math.round(etimes/60)}m) ${args.slice(0,50)}`);
                } catch {}
            }
            if (killed.length > 0) {
                this.journal.append({ action: 'orphan_cleanup', killed, count: killed.length });
            }
        } catch (e) {
            console.warn('[HealthCheck] 孤兒清理失敗:', e.message);
        }
    }

    _checkIndexHealth() {
        try {
            const CodebaseIndexer = require('../../codebase-indexer');
            let needsRebuild = true;
            try {
                const idx = CodebaseIndexer.load();
                needsRebuild = CodebaseIndexer.isStale(idx);
            } catch (e) { /* 索引不存在 → 需要重建 */ }
            if (needsRebuild) {
                console.log('🔍 [HealthCheck] Codebase 索引過期，重建中...');
                CodebaseIndexer.rebuild();
                return 'rebuilt';
            }
            return 'ok';
        } catch (e) {
            console.warn('[HealthCheck] 索引檢查失敗:', e.message);
            return 'error';
        }
    }

    async _checkMemoryHealth() {
        try {
            const memDir      = path.join(process.cwd(), 'memory');
            const journalPath = path.join(memDir, 'journal.jsonl');
            const reposPath   = path.join(memDir, 'explored-repos.json');
            const warnings    = [];
            let lines       = 0;
            let totalSizeKB = 0;

            if (fs.existsSync(journalPath)) {
                const content = fs.readFileSync(journalPath, 'utf8');
                lines = content.split('\n').filter(Boolean).length;
                if (lines > 5000) warnings.push(`journal.jsonl 已達 ${lines} 行（警戒：5000）`);
            }

            for (const entry of fs.readdirSync(memDir, { withFileTypes: true })) {
                if (entry.isFile()) {
                    try { totalSizeKB += fs.statSync(path.join(memDir, entry.name)).size / 1024; } catch (_) {}
                }
            }
            if (totalSizeKB > 10 * 1024) warnings.push(`memory/ 總大小 ${Math.round(totalSizeKB)}KB（警戒：10240KB）`);

            if (fs.existsSync(reposPath)) {
                const reposSizeKB = fs.statSync(reposPath).size / 1024;
                if (reposSizeKB > 50) warnings.push(`explored-repos.json ${Math.round(reposSizeKB)}KB（警戒：50KB）`);
            }

            this.journal.append({ action: 'memory_health', lines, sizeKB: Math.round(totalSizeKB), warnings });
            if (warnings.length > 0) {
                await this.notifier.sendToAdmin('⚠️ [記憶健康] 警告:\n' + warnings.join('\n'));
            }
        } catch (e) {
            console.warn('[HealthCheck] 記憶健康檢查失敗:', e.message);
        }
    }

    _shouldTriggerReflection(data) {
        const j = data.journal;
        const items = [];
        if (j.verificationFailed > 0)            items.push({ type: 'config', msg: `verification_failed ${j.verificationFailed} 次` });
        if (j.errors.length > 0)                 items.push({ type: 'code',   msg: `系統錯誤 ${j.errors.length} 次` });
        if (data.log.errors.length > 0)          items.push({ type: 'code',   msg: `日誌錯誤 ${data.log.errors.length} 條` });
        if (data.reflections.patches.stale > 0)  items.push({ type: 'config', msg: `${data.reflections.patches.stale} 個過期未處理提案` });
        if (items.length === 0) return null;

        const errorType = ['config', 'code', 'external'].find(t => items.some(i => i.type === t));
        const failedActions = [...new Set(
            Object.keys(j.byOutcome)
                .filter(k => { const o = k.split('/').slice(1).join('/'); return /fail|error/.test(o); })
                .map(k => k.split('/')[0])
        )];
        return { reason: items.map(i => i.msg).join('、'), failedActions, errorType };
    }
}

module.exports = HealthCheckAction;
