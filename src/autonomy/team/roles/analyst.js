'use strict';
const fs   = require('fs');
const path = require('path');
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
        const fileList = this.decision.getProjectFileList(true); // pathsOnly → string[]

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

        // === Fix 1: 注入過去失敗 patch 歷史 ===
        let patchHistory = '(無)';
        try {
            const ppPath = path.join(process.cwd(), 'memory', 'pending-patches.json');
            if (fs.existsSync(ppPath)) {
                const patches = JSON.parse(fs.readFileSync(ppPath, 'utf8'));
                const failed = patches
                    .filter(p => p.status === 'dropped' && p.dropReason)
                    .slice(-8)
                    .map(p => {
                        const t = p.target ? p.target.replace(process.cwd() + '/', '') : '?';
                        return `- [${p.proposalType || '?'}] ${t}: ${p.dropReason}`;
                    });
                if (failed.length > 0) patchHistory = failed.join('\n');
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
            PATCH_HISTORY:      patchHistory,
        });
        if (!prompt) throw new Error('reflect-analyst.md 載入失敗');

        console.log('🧬 [Team/Analyst] 分析症狀與根本原因...');
        const raw      = (await this.decision.callLLM(prompt, { temperature: 0.5, intent: 'analysis', requireJson: true })).text;
        const diagFile = this.decision.saveReflection('reflect_analyst', raw);

        let analystOutput;
        try {
            const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        // 防禦：修復 LLM 輸出中 JSON 字串值內的裸換行（JSON 規格不允許）
        const fixedJson = cleaned.replace(/"(?:[^"\\]|\\.)*"/g, m =>
            m.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
        );
            analystOutput = JSON.parse(fixedJson);
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

        // 收集 autonomy/ 節點清單（格式：ClassName.methodName → file.js），供 Architect 同時選 node + file
        let nodeList = '(無)';
        try {
            const CodebaseIndexer = require('../../../codebase-indexer');
            const idx = CodebaseIndexer.load();
            const lines = [];
            for (const [name, info] of Object.entries(idx.symbols.classMethods)) {
                if (!info.file || !info.file.startsWith('src/')) continue;
                if (info.file.includes('.test.') || info.file.includes('/test/')) continue;
                if (name.endsWith('.constructor')) continue; // constructor 通常不需要單獨 patch
                lines.push(`${name} → ${info.file}`);
            }
            for (const [name, info] of Object.entries(idx.symbols.topLevelFunctions)) {
                if (!info.file || !info.file.startsWith('src/')) continue;
                if (info.file.includes('.test.') || info.file.includes('/test/')) continue;
                lines.push(`${name} → ${info.file}`);
            }
            nodeList = lines.join('\n');
        } catch (_) {}

        // 可達性標記：檢查 root_cause 是否與 nodeList 中的任何檔名有 substring 交集
        const rootCauseLower = (analystOutput.root_cause || '').toLowerCase();
        const nodeLines = nodeList !== '(無)' ? nodeList.split('\n') : [];
        let reachable = false;
        for (const line of nodeLines) {
            const parts = line.split(' → ');
            if (parts.length < 2) continue;
            const filePath = parts[1].trim().toLowerCase();
            const baseName = path.basename(filePath, '.js').toLowerCase();
            if (rootCauseLower.includes(filePath) || rootCauseLower.includes(baseName)) {
                reachable = true;
                break;
            }
        }
        analystOutput.reachable = reachable;
        if (!reachable) analystOutput.suggestion = 'whole_file_add';

        console.log('[Team/Analyst] 症狀:', analystOutput.symptom);
        console.log('[Team/Analyst] 可達性:', reachable ? 'reachable' : 'not reachable (suggestion: whole_file_add)');
        return { analystOutput, diagFile, fileList, nodeList };
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

        const raw = (await this.decision.callLLM(prompt, { temperature: 0.3, intent: 'analysis', requireJson: true })).text;
        try {
            const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        // 防禦：修復 LLM 輸出中 JSON 字串值內的裸換行（JSON 規格不允許）
        const fixedJson = cleaned.replace(/"(?:[^"\\]|\\.)*"/g, m =>
            m.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
        );
            return JSON.parse(fixedJson);
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
