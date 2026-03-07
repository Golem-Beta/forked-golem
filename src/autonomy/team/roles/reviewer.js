'use strict';
/**
 * @module team/roles/reviewer
 * @role Reviewer — 語義審查 patch，強制使用與 Implementer 不同的 provider
 * @when-to-modify 調整審查提示詞、verdict 後處理邏輯、或 provider 互斥策略時
 *
 * 重構自 reviewer-agent.js，新增 TeamProvider 互斥 + issues[] 輸出欄位
 */
const BaseAction = require('../../actions/base-action');

class ReviewerRole extends BaseAction {
    constructor({ journal, notifier, decision, teamProvider, loadPrompt }) {
        super({ journal, notifier, decision, loadPrompt });
        this.teamProvider = teamProvider;
    }

    /**
     * 語義審查 patch
     * @param {object} ctx - 含 proposals, codeSnippet, strategy, implementerProvider
     * @returns {Promise<{ reviewResult: object }>}
     */
    async run(ctx) {
        const { proposals, codeSnippet, strategy, implementerProvider, knownMethods = [] } = ctx;
        const proposal     = proposals[0];
        const originalCode = proposal.target_node
            ? `// [AST target: ${proposal.target_node}]\n${codeSnippet || ''}`.substring(0, 1500)
            : (codeSnippet || '(未知)').substring(0, 1500);
        const patchedCode  = (proposal.replace || '').substring(0, 1500);

        // 強制使用與 Implementer 不同的 provider
        const excludeList = [implementerProvider].filter(Boolean);

        const prompt = _buildReviewPrompt(proposal, originalCode, patchedCode, strategy, knownMethods);

        let rawText;
        try {
            rawText = (await this.decision.callLLM(prompt, {
                intent:          'code_review',
                temperature:     0.2,
                excludeProvider: excludeList[0] || null,
            })).text || '';
        } catch (e) {
            console.warn('[Team/Reviewer] LLM 失敗，降級 needs_human:', e.message);
            return { reviewResult: _failSafe('LLM 失敗: ' + e.message) };
        }

        const reviewerProvider = this.decision.lastModel?.split('/')[0] || 'unknown';
        console.log(`[Team/Reviewer] 使用 provider: ${reviewerProvider}（Implementer: ${implementerProvider || 'unknown'}）`);

        let parsed;
        try {
            const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
        } catch (e) {
            return { reviewResult: _failSafe('JSON 解析失敗: ' + e.message) };
        }

        const reviewResult = _buildReviewResult(parsed);
        console.log(`[Team/Reviewer] verdict: ${reviewResult.verdict} — ${reviewResult.summary}`);
        return { reviewResult };
    }
}

function _buildReviewPrompt(proposal, originalCode, patchedCode, strategy, knownMethods = []) {
    const knownMethodsBlock = knownMethods.length > 0
        ? `\n【target class known methods】\n${knownMethods.join(', ')}\n`
        : '';
    return `你是一個 AI 程式碼審查員。請審查以下自主 AI Agent 程式碼修改。

【Proposal】
描述：${proposal.description || '(無)'}
類型：${proposal.type || '(無)'}
目標：${proposal.target_node || proposal.file || '(未知)'}
策略依據：${strategy?.strategy || '(無)'}
預期：${proposal.expected_outcome || '(無)'}
${knownMethodsBlock}
【原始程式碼】
\`\`\`javascript
${originalCode}
\`\`\`

【Patch 後程式碼】
\`\`\`javascript
${patchedCode}
\`\`\`

回傳 JSON（只輸出 JSON，無其他文字）：
{
  "removed_logic": ["被移除的邏輯項目。若無則空陣列"],
  "intentional_removals": ["根據 proposal 描述確實有意移除的項目"],
  "risks": ["潛在風險。若無則空陣列"],
  "verdict": "approve | reject | needs_human",
  "summary": "一句話說明判斷"
}

判斷標準：
- reject：replace 中出現了呼叫不在已知方法清單中的 this.xxx() 直接方法（例如 this.run()、this.execute()）
  ⚠️ 注意：this.journal.append、this.notifier.send 等鏈式屬性呼叫（this.屬性.方法()）不受此限，不算違規
- reject：有明顯破壞性改動（移除整個 try-catch、引入 eval/exec、刪除關鍵驗證）
- needs_human：removed_logic 有項目不在 intentional_removals 中
- approve：修改符合描述，無明顯風險`;
}

function _buildReviewResult(parsed) {
    const removed      = Array.isArray(parsed.removed_logic)        ? parsed.removed_logic        : [];
    const intentional  = Array.isArray(parsed.intentional_removals) ? parsed.intentional_removals : [];
    const risks        = Array.isArray(parsed.risks)                ? parsed.risks                : [];
    const llmVerdict   = typeof parsed.verdict === 'string'         ? parsed.verdict              : 'approve';
    const summary      = typeof parsed.summary === 'string'         ? parsed.summary              : '無摘要';

    let verdict;
    if (llmVerdict === 'reject') {
        verdict = 'reject';
    } else if (_hasUnexplainedRemovals(removed, intentional)) {
        verdict = 'needs_human';
    } else if (llmVerdict === 'needs_human') {
        verdict = 'needs_human';
    } else {
        verdict = 'approve';
    }

    const issues = [...risks];
    for (const r of removed) {
        if (!intentional.some(i => r.toLowerCase().includes(i.toLowerCase().substring(0, 15)))) {
            issues.push('意外移除: ' + r);
        }
    }

    return {
        approved:             verdict === 'approve',
        issues,
        confidence:           verdict === 'approve' ? 0.8 : 0.3,
        removed_logic:        removed,
        intentional_removals: intentional,
        risks,
        verdict,
        summary,
    };
}

function _hasUnexplainedRemovals(removed, intentional) {
    if (removed.length === 0) return false;
    if (intentional.length === 0) return true;
    for (const r of removed) {
        const explained = intentional.some(i =>
            i.toLowerCase().includes(r.toLowerCase().substring(0, 20)) ||
            r.toLowerCase().includes(i.toLowerCase().substring(0, 20))
        );
        if (!explained) return true;
    }
    return false;
}

function _failSafe(reason) {
    return {
        approved: false, issues: [reason], confidence: 0,
        removed_logic: [], intentional_removals: [], risks: [reason],
        verdict: 'needs_human',
        summary: `Reviewer 失敗（${reason}），保守降級為人工確認`,
    };
}

module.exports = ReviewerRole;
