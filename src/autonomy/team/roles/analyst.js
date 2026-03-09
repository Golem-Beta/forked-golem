'use strict';
const fs   = require('fs');
const path = require('path');
/**
 * @module team/roles/analyst
 * @role Analyst — 從 journal + memory + 程式碼片段 診斷症狀與根本原因，不提解法
 * @when-to-modify 調整診斷提示詞載入、記憶召回參數、或輸出 schema 時
 *
 * 重構自 reflect-diag.js，輸出格式改為 { symptom, root_cause, evidence, confidence }
 */
const { execSync } = require('child_process');
const BaseAction   = require('../../actions/base-action');

// 涵蓋 self_reflection 所有已知失敗型態（不只 failed/parse_failed）
const FAILURE_OUTCOMES = [
    'failed', 'parse_failed', 'reviewer_rejected',
    'verification_failed', 'no_target_node', 'llm_review_failed', 'invalid_patch',
];

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
        const { prompt, fileList } = await this._buildContext(ctx);
        if (!prompt) throw new Error('reflect-analyst.md 載入失敗');

        console.log('🧬 [Team/Analyst] 分析症狀與根本原因...');
        const raw      = (await this.decision.callLLM(prompt, { temperature: 0.5, intent: 'analysis', requireJson: true })).text;
        const diagFile = this.decision.saveReflection('reflect_analyst', raw);

        let analystOutput;
        try {
            const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
            // 防禦：修復 LLM 輸出中 JSON 字串值內的裸換行
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

        // 收集全 src/ 節點清單（格式：ClassName.methodName → file.js），供 Architect 選 node
        let nodeList = '(無)';
        try {
            const CodebaseIndexer = require('../../../codebase-indexer');
            const idx = CodebaseIndexer.load();
            const lines = [];
            for (const [name, info] of Object.entries(idx.symbols.classMethods)) {
                if (!info.file || !info.file.startsWith('src/')) continue;
                if (info.file.includes('.test.') || info.file.includes('/test/')) continue;
                if (name.endsWith('.constructor')) continue;
                lines.push(`${name} → ${info.file}`);
            }
            for (const [name, info] of Object.entries(idx.symbols.topLevelFunctions)) {
                if (!info.file || !info.file.startsWith('src/')) continue;
                if (info.file.includes('.test.') || info.file.includes('/test/')) continue;
                lines.push(`${name} → ${info.file}`);
            }
            nodeList = lines.join('\n');
        } catch (_) {}

        // 可達性標記：root_cause 提到的模組是否在 nodeList 中有對應節點
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
     * 組裝 Analyst 所需的所有診斷 context（journal、記憶、程式碼片段等）
     * @param {object} ctx - 含 journalContext, triggerCtx
     * @returns {Promise<{ prompt: string, fileList: string[] }>}
     */
    async _buildContext({ journalContext = '(無)', triggerCtx = null }) {
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

        // 修正：涵蓋全部失敗型態，排除 team_* 流水線自身雜訊
        const failureAnalysis = allJournal
            .filter(j => FAILURE_OUTCOMES.includes(j.outcome))
            .filter(j => !j.action?.startsWith('team_'))
            .slice(-5)
            .map(j => `[${j.action}] outcome=${j.outcome} ${j.error || j.reason || ''}`)
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

        // 程式碼讀取：從 failureAnalysis + journalContext 提取失敗 action → 對應 src 檔案
        const codeContext = _readFailingActionCode(failureAnalysis, journalContext);

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
            CODE_CONTEXT:       codeContext,
        });

        return { prompt, fileList };
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
            // 防禦：修復 LLM 輸出中 JSON 字串值內的裸換行
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

/**
 * 從 failureAnalysis 與 journalContext 提取失敗 action name，
 * 轉換為 src/autonomy/actions/<name>.js 路徑並讀取前 2000 字元。
 * 排除 self_reflection / team_* / decision（避免自我參照診斷）。
 */
function _readFailingActionCode(failureAnalysis, journalContext) {
    const SKIP = new Set([
        'self_reflection', 'decision', 'rest',
        'team_analyst', 'team_implementer', 'team_architect', 'team_runner', 'team_debate',
    ]);
    const actionSet = new Set();

    // 從 failureAnalysis 提取：格式 "[action] outcome=..."
    for (const line of failureAnalysis.split('\n')) {
        const m = line.match(/^\[([^\]]+)\]/);
        if (m && !SKIP.has(m[1])) actionSet.add(m[1]);
    }
    // 從 journalContext 補充：格式 "[time] action: outcome"
    for (const line of journalContext.split('\n')) {
        const m = line.match(/\]\s+([^:\s]+):/);
        if (m) {
            const action = m[1].trim();
            if (action && !SKIP.has(action)) actionSet.add(action);
        }
    }

    const snippets = [];
    for (const action of [...actionSet].slice(0, 2)) {
        const kebab = action.replace(/_/g, '-');
        const candidates = [
            `src/autonomy/actions/${kebab}.js`,
            `src/autonomy/actions/${action}.js`,
        ];
        for (const rel of candidates) {
            const abs = path.join(process.cwd(), rel);
            if (fs.existsSync(abs)) {
                try {
                    const code = fs.readFileSync(abs, 'utf-8');
                    const preview = code.length > 2000
                        ? code.substring(0, 2000) + '\n// ... (truncated)'
                        : code;
                    snippets.push(`// === ${rel} ===\n${preview}`);
                } catch (_) {}
                break;
            }
        }
    }

    return snippets.length > 0 ? snippets.join('\n\n') : '(無相關程式碼)';
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
