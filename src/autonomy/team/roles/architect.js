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
        const { analystOutput, journalContext = '(無)', fileList = [], _architectFeedback = '' } = ctx;
        const retryFeedback = _architectFeedback
            ? `【重試提示】${_architectFeedback}\n\n`
            : '';
        // fileList 是 string[]（pathsOnly 模式），直接 join；限 80 個避免 token 爆炸
        const fileListStr = Array.isArray(fileList)
            ? fileList.slice(0, 80).join('\n')
            : String(fileList || '(無檔案清單)');
        const prompt = this.loadPrompt('reflect-architect.md', {
            DIAGNOSIS_JSON:  JSON.stringify(analystOutput, null, 2),
            JOURNAL_CONTEXT: journalContext,
            FILE_LIST:       fileListStr,
            RETRY_FEEDBACK:  retryFeedback,
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

        const strategyPreview = (architectOutput.strategy || '').substring(0, 80);
        console.log('[Team/Architect] 策略:', strategyPreview);
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
