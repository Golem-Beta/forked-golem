'use strict';
/**
 * @module actions/base-action
 * @role 所有自主行動的共用基礎邏輯
 * @when-to-modify 確認新的共用樣板在 ≥3 個 action 中出現後再抽取
 *
 * 抽取自以下重複樣板（2026-03-03 分析）：
 *   - constructor 核心注入（journal/notifier/decision/loadPrompt）：8 個 action 共用
 *   - sendToAdmin outcome 三元（sent===true/queued/send_failed）：6+ 個 action 共用
 *   - sent error 展開欄位：6+ 個 action 共用
 *   - 標準 error catch 格式：4 個 action 共用
 *   - isHardFailed 早期中止：2 個 action 共用
 */

class BaseAction {
    /**
     * @param {object} deps
     * @param {object} deps.journal    - JournalManager
     * @param {object} deps.notifier   - Notifier（含 sendToAdmin / isHardFailed）
     * @param {object} deps.decision   - DecisionEngine（含 callLLM / readSoul）
     * @param {Function} [deps.loadPrompt] - PromptLoader 函式
     */
    constructor({ journal, notifier, decision, loadPrompt }) {
        this.journal    = journal;
        this.notifier   = notifier;
        this.decision   = decision;
        this.loadPrompt = loadPrompt || null;
    }

    /**
     * 通知通道硬失敗時快速中止。
     * @param {string} actionName - 用於 journal.append 的 action 欄位
     * @returns {object|null} 若硬失敗回傳 ActionResult；否則回傳 null（可繼續執行）
     */
    _abortIfChannelDown(actionName) {
        if (!this.notifier?.isHardFailed?.()) return null;
        console.warn(`[${actionName}] 通知通道硬失敗，提前中止`);
        this.journal.append({ action: actionName, outcome: 'aborted_channel_down' });
        return { success: false, action: actionName, outcome: 'aborted_channel_down' };
    }

    /**
     * 根據 sendToAdmin 回傳值決定 outcome 字串。
     * @param {boolean|string|object} sent - sendToAdmin 的回傳值
     * @param {string} [successLabel='sent'] - sent===true 時使用的 outcome 值
     * @returns {string}
     */
    _sentOutcome(sent, successLabel = 'sent') {
        if (sent === true)      return successLabel;
        if (sent === 'queued')  return 'queued';
        return 'send_failed';
    }

    /**
     * 從 sendToAdmin 回傳值提取 error 展開欄位（用於 journal.append 展開）。
     * @param {boolean|string|object} sent
     * @returns {object} `{ error: string }` 或空物件
     */
    _sentErrorField(sent) {
        if (sent === true || sent === 'queued') return {};
        if (!sent) return {};
        if (sent.error) return { error: sent.error };
        // 非物件值（string 等）強制序列化
        return { error: typeof sent === 'string' ? sent : JSON.stringify(sent) };
    }

    /**
     * 標準錯誤處理：console.error + journal.append + 回傳 ActionResult。
     * @param {string} actionName
     * @param {Error}  e
     * @returns {{ success: false, action: string, outcome: 'error', detail: string }}
     */
    _handleError(actionName, e) {
        console.error(`❌ [${actionName}] 失敗:`, e.message);
        this.journal.append({ action: actionName, outcome: 'error', error: e.message });
        return { success: false, action: actionName, outcome: 'error', detail: e.message };
    }
}

module.exports = BaseAction;
