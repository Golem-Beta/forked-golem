/**
 * @module reflect-diag
 * @role Self-reflection Phase 1 — 診斷當前問題，產出改進方向
 * @when-to-modify 調整診斷提示詞、歷史 reflection 讀取數量、或診斷輸出 schema 時
 */
const { execSync } = require('child_process');

class ReflectDiag {
    constructor({ journal, notifier, decision, memory, memoryLayer, loadPrompt }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
        this.memory = memory;              // 舊 ExperienceMemory（getAdvice 用）
        this.memoryLayer = memoryLayer || null; // 新三層記憶召回
        this.loadPrompt = loadPrompt || null;
    }

    /**
     * Phase 1 診斷
     * @param {string} journalContext - 已格式化的最近日誌字串
     * @param {object|null} triggerCtx - Telegram context（手動觸發時）
     * @returns {{ diag: object, diagFile: string } | null} 解析成功返回診斷物件，否則 null
     */
        async run(journalContext, triggerCtx) {
        const advice = this.memory ? this.memory.getAdvice() : '';
        const soul = this.decision.readSoul();
        const fileList = this.decision.getProjectFileList();
    
        const allJournal = this.journal.readRecent(50);
        const resolvedSet = new Set(
            allJournal
                .filter(j => j.action === 'self_reflection_feedback' && j.resolves)
                .map(j => j.resolves)
        );
        const recentReflections = allJournal
            .filter(j => j.action === 'self_reflection')
            .filter(j => !(j.outcome === 'proposed' && resolvedSet.has(j.ts)))
            .slice(-5)
            .map(j => {
                const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                const detail = [j.outcome, j.diagnosis, j.description, j.reason].filter(Boolean).join(' / ');
                return '[' + time + '] ' + (j.mode || 'phase1') + ' outcome=' + detail;
            }).join('\n') || '(無歷史記錄)';
    
        const failureAnalysis = allJournal
            .filter(j => j.outcome === 'failed' || j.outcome === 'parse_failed')
            .slice(-3)
            .map(j => `[${j.action}] ${j.error || j.reason || '未知錯誤'}`)
            .join('\n') || '(無近期失敗記錄)';
    
        let recentGitLog = '(無法取得)';
        try {
            recentGitLog = execSync('git log --oneline -8', { cwd: process.cwd() }).toString().trim();
        } catch (e) { }
    
        let coldInsights = '';
        let warmInsights = '';
        try {
            const diagQuery = (soul.substring(0, 200) + ' ' + journalContext.substring(0, 200)).trim();
            if (this.memoryLayer && diagQuery) {
                const { warm, cold } = this.memoryLayer.recall(diagQuery, { hotLimit: 0, warmLimit: 2, coldLimit: 3 });
                warmInsights = warm || '';
                coldInsights = cold || '';
            }
        } catch (e) { }
    
        const triggerSection = (() => {
            if (!triggerCtx || !triggerCtx.reason) return '';
            const typeLabel = { external: '外部依賴，通訊問題', config: '設定/程式問題', code: '程式碼問題' };
            const lines = ['【本次診斷重點】', `觸發原因：${triggerCtx.reason}`];
            if (triggerCtx.failedActions && triggerCtx.failedActions.length > 0)
                lines.push(`失敗行動：${triggerCtx.failedActions.join(', ')}`);
            if (triggerCtx.errorType) {
                lines.push(`錯誤類型：${triggerCtx.errorType}（${typeLabel[triggerCtx.errorType] || triggerCtx.errorType}）`);
                const focus = triggerCtx.errorType === 'external' ? '通訊層的錯誤處理，而非功能邏輯'
                    : triggerCtx.errorType === 'config' ? '設定讀取與驗證邏輯' : '失敗的程式邏輯';
                lines.push(`建議聚焦：${focus}`);
            }
            return lines.join('\n');
        })();
    
        const diagPrompt = this.loadPrompt('self-reflection-diag.md', {
            SOUL:               soul,
            TRIGGER_SECTION:    triggerSection ? '\n' + triggerSection : '',
            JOURNAL_CONTEXT:    journalContext,
            RECENT_REFLECTIONS: recentReflections,
            FAILURE_ANALYSIS:   failureAnalysis,
            GIT_LOG:            recentGitLog,
            ADVICE:             advice || '(無)',
            COLD_INSIGHTS:      coldInsights || '(無)',
            WARM_INSIGHTS:      warmInsights || '(無)',
            FILE_LIST:          fileList,
        });
        if (!diagPrompt) throw new Error('self-reflection-diag.md 載入失敗');
    
        console.log('🧬 [Reflection] Phase 1: 診斷...');
        const diagRaw = (await this.decision.callLLM(diagPrompt, { temperature: 0.5, intent: 'analysis' })).text;
        const diagFile = this.decision.saveReflection('self_reflection_diag', diagRaw);
    
        let diag;
        try {
            const cleaned = diagRaw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            diag = JSON.parse(cleaned);
        } catch (e) {
            console.warn('🧬 [Reflection] 診斷 JSON 解析失敗:', e.message);
            this.journal.append({ action: 'self_reflection', phase: 'diagnosis', outcome: 'parse_failed', reflection_file: diagFile });
            if (!triggerCtx) {
                const sent = await this.notifier.sendToAdmin('🧬 [self_reflection] Phase 1 診斷解析失敗: ' + e.message + '\n(輸出已存至 ' + diagFile + ')');
                this.journal.append({ action: 'notification', target: 'admin', outcome: sent ? 'done' : 'send_failed' });
            }
            return null;
        }
    
        if (diag.diagnosis === 'none') {
            console.log('🧬 [Reflection] 診斷結果：目前無需改進 — ' + (diag.reason || ''));
            this.journal.append({ action: 'self_reflection', phase: 'diagnosis', outcome: 'no_issues', reason: diag.reason, reflection_file: diagFile });
            return null;
        }
    
        console.log('🧬 [Reflection] 診斷: ' + diag.diagnosis);
        return { diag, diagFile };
    }
}

module.exports = ReflectDiag;
