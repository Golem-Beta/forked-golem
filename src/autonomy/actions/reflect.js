/**
 * @module reflect
 * @role Self-reflection 協調層 — 串連 Phase 1（診斷）和 Phase 2（patch）
 * @when-to-modify 調整 heap 監控、journalContext 建構方式、或兩階段之間的協調邏輯時
 */
const ReflectDiag = require('./reflect-diag');
const ReflectPatch = require('./reflect-patch');

class ReflectAction {
    constructor(deps) {
        this.journal = deps.journal;
        this.diag = new ReflectDiag(deps);
        this.patch = new ReflectPatch(deps);
    }

    async performSelfReflection(triggerCtx = null) {
        const _heapReflect = process.memoryUsage();
        console.log(`🧠 [Heap] self_reflection 開始: RSS=${(_heapReflect.rss/1024/1024).toFixed(0)}MB, Heap=${(_heapReflect.heapUsed/1024/1024).toFixed(0)}MB`);
        let journalContext = '(無)';  // 提升到 try 外，catch 才能存取
        try {
            // 建構共用 journalContext（phase1 + phase2 都需要）
            const recentJournal = this.journal.readRecent(10);
            if (recentJournal.length > 0) {
                journalContext = recentJournal.map(j => {
                    const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                    return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.description || j.topic || '');
                }).join('\n');
            }

            const result = await this.diag.run(journalContext, triggerCtx);
            if (!result) return { success: false, action: 'self_reflection', outcome: 'no_diagnosis' };

            const patchResult = await this.patch.run(result.diag, result.diagFile, journalContext, triggerCtx);
            return patchResult || { success: false, action: 'self_reflection', outcome: 'no_patch', target: result.diag.target_file };
        } catch (e) {
            console.error('[錯誤] 自主進化失敗:', e.message || e, e.stack);
            this.journal.append({
                action: 'self_reflection',
                outcome: e.message && e.message.includes('parse_failed') ? 'parse_failed' : 'error',
                error: e.message,
                details: {
                    stack: e.stack,
                    journalContext: journalContext,
                    triggerContext: triggerCtx
                }
            });
            return { success: false, action: 'self_reflection', outcome: 'error', detail: e.message };
        }
    }
}

module.exports = ReflectAction;
