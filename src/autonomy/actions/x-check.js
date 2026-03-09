/**
 * @module actions/x-check
 * @role X (Twitter) 感知層 — 用 Brave 搜尋自己的 mentions，摘要成 observe 注入感知
 * @when-to-modify 調整搜尋策略、LLM 摘要邏輯、或搜尋關鍵字時
 *
 * 設計選擇：不用 X 官方讀取 API（free tier 50 reads/月），改用 Brave Search
 * 只做感知（observe），不直接互動（互動需 X API premium）
 */
'use strict';

const CONFIG = require('../../config');
const WebSearchTool = require('./web-search-tool');

class XCheckAction {
    constructor({ journal, decision }) {
        this.journal  = journal;
        this.decision = decision;
        this._search  = new WebSearchTool({ config: CONFIG });
    }

    async run() {
        const username = CONFIG.X_USERNAME;
        if (!username) {
            console.log('🐦 [XCheck] X_USERNAME 未設定，跳過');
            this.journal.append({ action: 'x_check', outcome: 'skipped_no_username' });
            return { skipped: true, reason: 'no_username' };
        }

        console.log(`🐦 [XCheck] 搜尋 @${username} mentions...`);

        // Brave 搜尋：排除自己發的，找別人提及的
        const query = `"@${username}" -from:${username} site:x.com`;
        let results = [];
        try {
            results = await this._search.search(query, { limit: 5 });
        } catch (e) {
            console.warn('🐦 [XCheck] Brave 搜尋失敗:', e.message);
            this.journal.append({ action: 'x_check', outcome: 'search_failed', error: e.message });
            return { success: false, error: e.message };
        }

        if (!results.length) {
            console.log('🐦 [XCheck] 無搜尋結果');
            this.journal.append({ action: 'x_check', outcome: 'no_results' });
            return { success: true, outcome: 'no_results', observe: null };
        }

        // 組裝搜尋結果摘要
        const snippets = results
            .map((r, i) => `${i + 1}. ${r.title || ''}: ${r.description || r.snippet || ''}`.slice(0, 200))
            .join('\n');

        const prompt = `你是 GolemBeta，一個自主 AI Agent。以下是 Brave 搜尋到的外部提及你（@${username}）的結果：\n\n${snippets}\n\n請用 1-2 句話摘要：有誰提到你？說了什麼？若沒有明確提及直接說「目前無明顯外部提及」。只輸出摘要文字，不要額外解釋。`;

        const { text } = await this.decision.callLLM(prompt, { temperature: 0.3, intent: 'utility' });
        const summary = text?.trim() || '目前無明顯外部提及';

        const observe = `[X 感知] @${username} 的外部提及摘要：${summary}`;

        this.journal.append({
            action: 'x_check',
            outcome: 'completed',
            results_count: results.length,
            summary: summary.slice(0, 100),
            model: this.decision.lastModel,
        });

        console.log(`🐦 [XCheck] 完成 — 找到 ${results.length} 筆結果`);
        return { success: true, observe };
    }
}

module.exports = XCheckAction;
