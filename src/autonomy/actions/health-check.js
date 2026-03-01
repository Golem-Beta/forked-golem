'use strict';
/**
 * @module actions/health-check
 * @role HealthCheckAction — 巡查過去 24h 系統健康：協調分析、通知、觸發 self_reflection
 * @when-to-modify 調整業務流程、self_reflection 觸發條件、或通知邏輯時
 */
const HealthAnalyzer = require('./health-analyzer');

class HealthCheckAction {
    constructor({ journal, notifier, decision }) {
        this.journal   = journal;
        this.notifier  = notifier;
        this.decision  = decision;
        this._analyzer = new HealthAnalyzer({ decision });
    }

    async run() {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        console.log('🏥 [HealthCheck] 開始健康巡查...');
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
            outcome: sent === true ? 'reported' : sent === 'queued' ? 'queued' : 'send_failed',
            anomalies: data.log.errors.length + data.log.warns.length,
            needsReflection,
            ...(sent !== true && sent !== 'queued' && sent && sent.error ? { error: sent.error } : {})
        });
        return { success: true, action: 'health_check', needsReflection };
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
