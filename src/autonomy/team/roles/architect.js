'use strict';
/**
 * @module team/roles/architect
 * @role Architect — 驗證 Analyst 診斷、設計解法策略，必要時發起辯論挑戰
 * @when-to-modify 調整策略設計提示詞、challenge 邏輯、或 challenge_needed 判斷時
 */
const BaseAction = require('../../actions/base-action');

class ArchitectRole extends BaseAction {
    constructor({ journal, notifier, decision, loadPrompt }) {
        super({ journal, notifier, decision, loadPrompt });
    }

    /**
     * 主評估：驗證診斷 + 設計解法策略
     * @param {object} ctx - 含 analystOutput, diagFile, journalContext
     * @returns {Promise<{ architectOutput: object }|null>}
     */
    async run(ctx) {
        const { analystOutput, journalContext = '(無)', fileList = [], _architectFeedback = '', nodeList = '(無)' } = ctx;
        const retryFeedback = _architectFeedback
            ? `【重試提示】${_architectFeedback}\n\n`
            : '';
        // fileList 是 string[]（pathsOnly 模式），直接 join；限 80 個避免 token 爆炸
        const fileListStr = Array.isArray(fileList)
            ? fileList.slice(0, 80).join('\n')
            : String(fileList || '(無檔案清單)');
        const nodeListStr = typeof nodeList === 'string' ? nodeList : String(nodeList || '(無)');

        // 注入過去失敗 patch 歷史，讓 Architect 選 target 時迴避死路
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

        const prompt = this.loadPrompt('reflect-architect.md', {
            DIAGNOSIS_JSON:  JSON.stringify(analystOutput, null, 2),
            JOURNAL_CONTEXT: journalContext,
            FILE_LIST:       fileListStr,
            NODE_LIST:       nodeListStr,
            RETRY_FEEDBACK:  retryFeedback,
            PATCH_HISTORY:   patchHistory,
        });
        if (!prompt) throw new Error('reflect-architect.md 載入失敗');

        console.log('[Team/Architect] 驗證診斷，設計策略...');
        let architectOutput;
        for (let attempt = 1; attempt <= 2; attempt++) {
            const raw = (await this.decision.callLLM(prompt, { temperature: 0.4, intent: 'analysis' })).text;
            if (attempt === 1) this.decision.saveReflection('reflect_architect', raw);
            try {
                const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
                architectOutput = JSON.parse(cleaned);
                // 驗證 target_file 在 fileList 中（fileList 是 string[]）
                if (architectOutput.target_file && Array.isArray(fileList) && fileList.length > 0) {
                    if (!fileList.includes(architectOutput.target_file)) {
                        console.warn('[Team/Architect] target_file 不在清單:', architectOutput.target_file);
                        this.journal.append({ action: 'team_architect', outcome: 'target_file_invalid', target: architectOutput.target_file });
                        return { _error: 'target_file_invalid', _invalidTarget: architectOutput.target_file };
                    }
                }
                break; // 成功就跳出
            } catch (e) {
                console.warn(`[Team/Architect] JSON 解析失敗 (attempt ${attempt}):`, e.message);
                if (attempt === 2) {
                    this.journal.append({ action: 'team_architect', outcome: 'parse_failed', error: e.message });
                    return null;
                }
                console.log('[Team/Architect] 重試一次（換 model）...');
            }
        }

        // 驗證 target_node 是否真實存在；target_file 錯時嘗試從 CodebaseIndexer 自動修正
        if (architectOutput.target_node && architectOutput.target_file) {
            try {
                const { PatchManager } = require('../../../upgrader');
                const absPath = require('path').join(process.cwd(), architectOutput.target_file);
                const code = require('fs').readFileSync(absPath, 'utf8');
                PatchManager._locateNode(code, architectOutput.target_node);
                // 沒拋就是存在，保持不變
            } catch (_locateErr) {
                // target_file 可能選錯：從 CodebaseIndexer 查正確路徑
                let corrected = false;
                try {
                    const CodebaseIndexer = require('../../../codebase-indexer');
                    const idx = CodebaseIndexer.load();
                    const nodeName = architectOutput.target_node;
                    const info = idx.symbols.classMethods[nodeName] || idx.symbols.topLevelFunctions[nodeName];
                    if (info && info.file) {
                        const { PatchManager } = require('../../../upgrader');
                        const absPath2 = require('path').join(process.cwd(), info.file);
                        const code2 = require('fs').readFileSync(absPath2, 'utf8');
                        PatchManager._locateNode(code2, nodeName); // 再次驗證
                        console.log(`[Team/Architect] target_file 已自動修正: ${architectOutput.target_file} → ${info.file}`);
                        architectOutput.target_file = info.file;
                        corrected = true;
                    }
                } catch (_2) {}
                if (!corrected) {
                    console.warn('[Team/Architect] target_node 不存在，清空為 null:', architectOutput.target_node);
                    architectOutput.target_node = null;
                }
            }
        }

        const strategyPreview = (architectOutput.strategy || '').substring(0, 80);
        console.log('[Team/Architect] 策略:', strategyPreview);

        // === Fix 2: 提取 target_node 真實原始碼 ===
        if (architectOutput.target_node && architectOutput.target_file) {
            try {
                const extracted = this.decision.extractCodeSection(
                    architectOutput.target_file,
                    architectOutput.target_node
                );
                if (extracted && extracted.snippet && extracted.snippet.length > 10) {
                    architectOutput.codeSnippet  = extracted.snippet;
                    architectOutput.knownMethods = extracted.knownMethods || [];
                    console.log(`[Team/Architect] codeSnippet 已提取 (${extracted.snippet.length} chars)`);
                }
            } catch (e) {
                console.warn('[Team/Architect] codeSnippet 提取失敗:', e.message);
            }
        }

        return { architectOutput };
    }

    /**
     * 辯論挑戰：針對 Analyst 的立場提出質疑
     * @param {object} ctx - 含 analystOutput, architectOutput, debateRound, lastResponse
     * @returns {Promise<{ challenge: string, agree_on: string[], question: string }|null>}
     */
    async challenge(ctx) {
        const { analystOutput, architectOutput, debateRound = 1, lastResponse } = ctx;
        const prompt = this.loadPrompt('reflect-debate-challenge.md', {
            ANALYST_OUTPUT:   JSON.stringify(analystOutput, null, 2),
            ARCHITECT_OUTPUT: JSON.stringify(architectOutput, null, 2),
            DEBATE_ROUND:     String(debateRound),
            LAST_RESPONSE:    lastResponse ? JSON.stringify(lastResponse, null, 2) : '(無)',
        });
        if (!prompt) throw new Error('reflect-debate-challenge.md 載入失敗');

        const raw = (await this.decision.callLLM(prompt, { temperature: 0.3, intent: 'analysis' })).text;
        try {
            const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch (e) {
            console.warn('[Team/Architect] challenge 解析失敗:', e.message);
            return null;
        }
    }
}

module.exports = ArchitectRole;
