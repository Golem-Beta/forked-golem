'use strict';
/**
 * @module actions/reviewer-agent
 * @role 語義審查層 — 在 patch 進入部署流程前，以獨立 LLM call 做語義審查
 * @when-to-modify 調整審查提示詞、verdict 判斷邏輯、或回傳結構時
 *
 * 設計約束：
 *   - 接受 decision（callLLM 介面）作為注入依賴，不直接 require model-router
 *   - LLM 失敗時安全降級為 needs_human（保守策略，不擋 patch 但要人確認）
 *   - verdict 後處理邏輯由程式控制，不完全信任 LLM 的 verdict 欄位
 */

class ReviewerAgent {
    constructor({ decision }) {
        this.decision = decision;
    }

    /**
     * 語義審查一個 patch
     *
     * @param {string} originalCode - 原始程式碼片段（proposal.search 或 AST target 說明）
     * @param {string} patchedCode  - Patch 後的程式碼片段（proposal.replace）
     * @param {object} proposal     - 完整 proposal 物件（包含 description、type 等）
     * @returns {Promise<{
     *   approved: boolean,
     *   removed_logic: string[],
     *   intentional_removals: string[],
     *   risks: string[],
     *   verdict: 'approve'|'reject'|'needs_human',
     *   summary: string
     * }>}
     */
    async review(originalCode, patchedCode, proposal) {
        const description    = proposal.description     || '(無描述)';
        const proposalType   = proposal.type            || '(無類型)';
        const expectedOutcome = proposal.expected_outcome || '(無預期)';
        const targetNode     = proposal.target_node     || proposal.file || '(未知)';

        const originalTrunc = _truncate(originalCode, 1200);
        const patchedTrunc  = _truncate(patchedCode,  1200);

        const prompt = `你是一個 AI 程式碼審查員。請審查以下對自主 AI Agent 程式碼所做的修改，確保修改符合意圖且沒有引入風險。

【Proposal 資訊】
描述：${description}
類型：${proposalType}
目標：${targetNode}
預期結果：${expectedOutcome}

【原始程式碼（被替換前）】
\`\`\`javascript
${originalTrunc}
\`\`\`

【Patch 後程式碼（替換後）】
\`\`\`javascript
${patchedTrunc}
\`\`\`

【審查任務】
分析這個修改，回傳 JSON：
{
  "removed_logic": ["被移除的邏輯描述，例如：error handling、null check 等。若無則空陣列"],
  "intentional_removals": ["根據 proposal 描述，確實是有意移除的項目（對應 removed_logic 中的條目）"],
  "risks": ["潛在風險，如：eval 注入、資料遺失、無限循環、移除保護邏輯等。若無則空陣列"],
  "verdict": "approve | reject | needs_human",
  "summary": "一句話說明你的判斷"
}

【判斷標準】
- reject：有明顯破壞性改動，如移除整個 try-catch、引入 eval/exec/child_process、刪除關鍵驗證邏輯
- needs_human：removed_logic 有項目不在 intentional_removals 中（即意外移除了某些邏輯）
- approve：修改符合描述，無明顯風險，無意外邏輯移除

只輸出 JSON，不要其他說明。`;

        let rawText;
        try {
            const result = await this.decision.callLLM(prompt, {
                intent: 'code_review',
                temperature: 0.2,
            });
            rawText = result.text || '';
        } catch (e) {
            console.warn('[ReviewerAgent] LLM 呼叫失敗，降級為 needs_human:', e.message);
            return _failSafe('LLM 呼叫失敗: ' + e.message);
        }

        let parsed;
        try {
            const cleaned = rawText.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
        } catch (e) {
            console.warn('[ReviewerAgent] JSON 解析失敗，降級為 needs_human:', e.message);
            return _failSafe('LLM 回傳非 JSON 格式');
        }

        const removedLogic        = Array.isArray(parsed.removed_logic)        ? parsed.removed_logic        : [];
        const intentionalRemovals = Array.isArray(parsed.intentional_removals) ? parsed.intentional_removals : [];
        const risks               = Array.isArray(parsed.risks)                ? parsed.risks                : [];
        const llmVerdict          = typeof parsed.verdict === 'string'         ? parsed.verdict              : 'approve';
        const summary             = typeof parsed.summary === 'string'         ? parsed.summary              : '無摘要';

        // ── 後處理 verdict 邏輯（程式控制，不完全信任 LLM）─────────────────
        let verdict;

        // 1. LLM 明確標示 reject → 保留（LLM 有破壞性偵測能力）
        if (llmVerdict === 'reject') {
            verdict = 'reject';
        // 2. 有未說明的邏輯移除 → needs_human
        } else if (_hasUnintentionalRemovals(removedLogic, intentionalRemovals)) {
            verdict = 'needs_human';
        // 3. LLM 說 needs_human → 保留
        } else if (llmVerdict === 'needs_human') {
            verdict = 'needs_human';
        // 4. 其餘：approve
        } else {
            verdict = 'approve';
        }

        const approved = verdict === 'approve';
        console.log(`🔍 [ReviewerAgent] verdict: ${verdict} — ${summary}`);

        return { approved, removed_logic: removedLogic, intentional_removals: intentionalRemovals, risks, verdict, summary };
    }
}

// ── 內部輔助函式 ───────────────────────────────────────────────────────────

function _truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str || '';
    return str.substring(0, maxLen) + '\n...(截斷)';
}

/**
 * 判斷是否有「未說明的邏輯移除」
 * 策略：removedLogic 的每個條目，若無法在 intentionalRemovals 中找到語義對應 → 未說明
 * 簡化實作：字串包含比對（足夠應對 LLM 的輸出格式）
 */
function _hasUnintentionalRemovals(removedLogic, intentionalRemovals) {
    if (removedLogic.length === 0) return false;
    if (intentionalRemovals.length === 0) return true; // 有移除但無說明

    for (const removed of removedLogic) {
        const isExplained = intentionalRemovals.some(ir =>
            ir.toLowerCase().includes(removed.toLowerCase().substring(0, 20)) ||
            removed.toLowerCase().includes(ir.toLowerCase().substring(0, 20))
        );
        if (!isExplained) return true;
    }
    return false;
}

/** LLM 失敗時的保守降級結果 */
function _failSafe(reason) {
    return {
        approved: false,
        removed_logic: [],
        intentional_removals: [],
        risks: [reason],
        verdict: 'needs_human',
        summary: `ReviewerAgent 無法完成審查（${reason}），保守降級為人工確認`,
    };
}

module.exports = ReviewerAgent;
