/**
 * @module action-result
 * @role 統一 ActionResult 工廠 — 所有 perform* 函數的回傳格式
 */

/**
 * @param {object} opts
 * @param {boolean} opts.success
 * @param {string}  opts.action      - 行動名稱（e.g. 'github_explore'）
 * @param {string}  opts.outcome     - journal outcome 字串（e.g. 'shared', 'error'）
 * @param {string}  [opts.detail]    - 人可讀的補充說明
 * @param {number}  [opts.duration_ms]
 * @param {string}  [opts.model]     - 使用的 LLM model
 * @param {string}  [opts.target]    - 目標檔案（self_reflection 專用）
 * @returns {ActionResult}
 */
function ActionResult({ success, action, outcome, detail = '', duration_ms = 0, model = '', target = '' }) {
    return { success: !!success, action, outcome, detail, duration_ms, model, target };
}

/** 快捷：成功 */
ActionResult.ok = (action, outcome, opts = {}) =>
    ActionResult({ success: true, action, outcome, ...opts });

/** 快捷：失敗 */
ActionResult.fail = (action, outcome, opts = {}) =>
    ActionResult({ success: false, action, outcome, ...opts });

module.exports = { ActionResult };
