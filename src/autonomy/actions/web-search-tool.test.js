'use strict';
/**
 * WebSearchTool 手動測試腳本
 * 用法：node src/autonomy/actions/web-search-tool.test.js
 *
 * 不需要 BRAVE_API_KEY：無 key 時自動走 DDG fallback。
 * JINA_API_KEY 選用：無 key 時走免費版 r.jina.ai（有 rate limit）。
 */

require('dotenv').config();
const WebSearchTool = require('./web-search-tool');

async function main() {
    // 不傳 config，讓工具從 process.env 讀 key（若無則走 fallback）
    const tool = new WebSearchTool({});

    // ─── Test 1: search() ──────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('Test 1: search("AI agent memory architecture")');
    console.log('='.repeat(60));

    let results;
    try {
        results = await tool.search('AI agent memory architecture');
        console.log('\n結果數：', results.length);
        if (results.length === 0) {
            console.warn('⚠️  search() 回傳空陣列（DDG 可能被 rate limit 或拒絕）');
        } else {
            results.slice(0, 3).forEach((r, i) => {
                console.log('\n[' + (i + 1) + '] ' + r.title);
                console.log('    URL:     ' + r.url);
                console.log('    Snippet: ' + (r.snippet ? r.snippet.slice(0, 120) + '...' : '(空)'));
            });
        }
    } catch (e) {
        console.error('❌ search() 拋出錯誤:', e.message);
    }

    // ─── Test 2: fetchPage() ───────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('Test 2: fetchPage("https://example.com")');
    console.log('='.repeat(60));

    try {
        const page = await tool.fetchPage('https://example.com');
        console.log('\n前 200 chars:');
        console.log(page.slice(0, 200));
        if (page.length === 0) {
            console.warn('⚠️  fetchPage() 回傳空字串');
        }
    } catch (e) {
        console.error('❌ fetchPage() 拋出錯誤:', e.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ 測試完成');
    console.log('='.repeat(60));
}

main().catch(e => {
    console.error('❌ 測試執行失敗:', e);
    process.exit(1);
});
