'use strict';
/**
 * @module maintenance/process-audit
 * @role 監控自身 Node.js process 記憶體用量，偵測 leak，記錄趨勢快照
 * @llm-free true
 */
const fs = require('fs');
const path = require('path');
const MaintenanceAction = require('./base');

const AUDIT_LOG = path.join(process.cwd(), 'memory', 'process-audit.json');
const RSS_WARN_MB = 300;
const RSS_CRIT_MB = 450;
const HEAP_WARN_MB = 200;

class ProcessAuditAction extends MaintenanceAction {
    constructor(deps) { super(deps, 'process_audit'); }

    async run() {
        const mem = process.memoryUsage();
        const toMB = b => (b / 1024 / 1024).toFixed(1);

        const snapshot = {
            ts: new Date().toISOString(),
            rss: parseFloat(toMB(mem.rss)),
            heapUsed: parseFloat(toMB(mem.heapUsed)),
            heapTotal: parseFloat(toMB(mem.heapTotal)),
            external: parseFloat(toMB(mem.external)),
            uptime: Math.round(process.uptime() / 60), // minutes
        };

        // 讀歷史，計算趨勢
        let history = [];
        try {
            if (fs.existsSync(AUDIT_LOG)) {
                history = JSON.parse(fs.readFileSync(AUDIT_LOG, 'utf8'));
                if (!Array.isArray(history)) history = [];
            }
        } catch {}

        history.push(snapshot);
        if (history.length > 48) history = history.slice(-48); // 保留最近 48 筆
        fs.writeFileSync(AUDIT_LOG, JSON.stringify(history, null, 2));

        // 趨勢分析（最近 5 筆）
        let trend = 'stable';
        if (history.length >= 5) {
            const recent = history.slice(-5).map(s => s.rss);
            const delta = recent[recent.length - 1] - recent[0];
            if (delta > 50) trend = 'rising';
            else if (delta < -20) trend = 'falling';
        }

        // 警告
        let level = 'ok';
        let alert = null;
        if (snapshot.rss > RSS_CRIT_MB) {
            level = 'critical';
            alert = `RSS ${snapshot.rss}MB 超過危險閾值 ${RSS_CRIT_MB}MB`;
        } else if (snapshot.rss > RSS_WARN_MB || snapshot.heapUsed > HEAP_WARN_MB) {
            level = 'warning';
            alert = `RSS ${snapshot.rss}MB / Heap ${snapshot.heapUsed}MB 偏高`;
        }

        if (alert) {
            console.warn(`⚠️ [ProcessAudit] ${alert}`);
            await this.notifier.sendToAdmin(`🔍 *Process 記憶體警告*\n${alert}\n趨勢: ${trend}`);
        }

        const summary = `RSS:${snapshot.rss}MB Heap:${snapshot.heapUsed}MB uptime:${snapshot.uptime}m trend:${trend} [${level}]`;
        console.log(`🔍 [ProcessAudit] ${summary}`);

        this._record('completed', { ...snapshot, trend, level, alert, summary });
        return { success: true, summary, snapshot, trend, level };
    }
}

module.exports = ProcessAuditAction;
