'use strict';
/**
 * @module team/roles/analyst
 * @role Analyst — 從 journal + memory 診斷症狀與根本原因，不提解法
 * @when-to-modify 調整診斷提示詞載入、記憶召回參數、或輸出 schema 時
 *
 * 重構自 reflect-diag.js，輸出格式改為 { symptom, root_cause, evidence, confidence }
 */
const { execSync } = require('child_process');
const BaseAction   = require('../../actions/base-action');

class AnalystRole extends BaseAction {
    constructor({ journal, notifier, decision, memory, memoryLayer, loadPrompt }) {
        super({ journal, notifier, decision, loadPrompt });
        this.memory      = memory;
        this.memoryLayer = memoryLayer || null;
    }

    /**
     * 主診斷：分析症狀與根本原因
     * @param {object} ctx - 含 journalContext, triggerCtx
     * @returns {Promise<{ analystOutput: object, diagFile: string }|null>}
     */
    async run(ctx) {
        const { journalContext = '(無)', triggerCtx = null } = ctx;
        const advice   = this.memory ? this.memory.getAdvice() : '';
        const soul     = this.decision.readSoul();
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
                const time   = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                const detail = [j.outcome, j.diagnosis, j.description, j.reason].filter(Boolean).join(' / ');
                return `[${time}] ${j.mode || 'phase1'} outcome=${detail}`;
            }).join('\n') || '(無)';

        const failureAnalysis = allJournal
            .filter(j => j.outcome === 'failed' || j.outcome === 'parse_failed')
            .slice(-3)
            .map(j => `[${j.action}] ${j.error || j.reason || '未知'}`)
            .join('\n') || '(無)';

        let recentGitLog = '(無法取得)';
        try { recentGitLog = execSync('git log --oneline -8', { cwd: process.cwd() }).toString().trim(); } catch (_) {}

        let coldInsights = '', warmInsights = '';
        try {
            const diagQuery = (soul.substring(0, 200) + ' ' + journalContext.substring(0, 200)).trim();
            if (this.memoryLayer && diagQuery) {
                const { warm, cold } = this.memoryLayer.recall(diagQuery, { hotLimit: 0, warmLimit: 2, coldLimit: 3 });
                warmInsights = warm || '';
                coldInsights = cold || '';
            }
        } catch (_) {}

        const triggerSection = _buildTriggerSection(triggerCtx);
        const prompt = this.loadPrompt('reflect-analyst.md', {
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
        if (!prompt) throw new Error('reflect-analyst.md 載入失敗');

        console.log('🧬 [Team/Analyst] 分析症狀與根本原因...');
        const raw      = (await this.decision.callLLM(prompt, { temperature: 0.5, intent: 'analysis' })).text;
        const diagFile = this.decision.saveReflection('reflect_analyst', raw);

        let analystOutput;
        try {
            const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
            analystOutput = JSON.parse(cleaned);
        } catch (e) {
            console.warn('[Team/Analyst] JSON 解析失敗:', e.message);
            this.journal.append({ action: 'team_analyst', outcome: 'parse_failed', error: e.message });
            return null;
        }

        if (analystOutput.diagnosis === 'none') {
            console.log('[Team/Analyst] 無需改進 —', analystOutput.reason || '');
            this.journal.append({ action: 'team_analyst', outcome: 'no_issues', reason: analystOutput.reason });
            return null;
        }

        console.log('[Team/Analyst] 症狀:', analystOutput.symptom);
        return { analystOutput, diagFile, fileList };
    }

    /**
     * 回應 Architect 的辯論挑戰
     * @param {object} ctx - 含 analystOutput, challenge
     * @returns {Promise<{ response: string, revised_root_cause: string, consensus: boolean }|null>}
     */
    async respond(ctx) {
        const { analystOutput, challenge } = ctx;
        const prompt = this.loadPrompt('reflect-debate-response.md', {
            ANALYST_OUTPUT: JSON.stringify(analystOutput, null, 2),
            CHALLENGE:      JSON.stringify(challenge, null, 2),
        });
        if (!prompt) throw new Error('reflect-debate-response.md 載入失敗');

        const raw = (await this.decision.callLLM(prompt, { temperature: 0.3, intent: 'analysis' })).text;
        try {
            const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch (e) {
            console.warn('[Team/Analyst] respond 解析失敗，保守回傳 consensus: false');
            return { response: raw.substring(0, 200), revised_root_cause: analystOutput?.root_cause, consensus: false };
        }
    }
}

function _buildTriggerSection(triggerCtx) {
    if (!triggerCtx?.reason) return '';
    const typeLabel = { external: '外部依賴，通訊問題', config: '設定/程式問題', code: '程式碼問題' };
    const lines = ['【本次診斷重點】', `觸發原因：${triggerCtx.reason}`];
    if (triggerCtx.failedActions?.length > 0) lines.push(`失敗行動：${triggerCtx.failedActions.join(', ')}`);
    if (triggerCtx.errorType) {
        lines.push(`錯誤類型：${triggerCtx.errorType}（${typeLabel[triggerCtx.errorType] || triggerCtx.errorType}）`);
        const focus = triggerCtx.errorType === 'external' ? '通訊層的錯誤處理，而非功能邏輯'
            : triggerCtx.errorType === 'config' ? '設定讀取與驗證邏輯' : '失敗的程式邏輯';
        lines.push(`建議聚焦：${focus}`);
    }
    return lines.join('\n');
}

module.exports = AnalystRole;
