'use strict';
/**
 * @module model-benchmark/tests
 * @role 基準測試單元定義（4 個測試，各含 validate 函式）
 */

const TESTS = [
    {
        id: 'tristream',
        name: '三流格式遵從',
        prompt: '用繁體中文，簡短回答：今天天氣如何？',
        maxTokens: 300,
        validate(text) {
            const hasMemory = text.includes('[GOLEM_MEMORY]');
            const hasAction = text.includes('[GOLEM_ACTION]');
            const hasReply  = text.includes('[GOLEM_REPLY]');
            const score = (hasMemory ? 1 : 0) + (hasAction ? 1 : 0) + (hasReply ? 1 : 0);
            return {
                pass: score === 3,
                detail: `MEMORY:${hasMemory ? '✅' : '❌'} ACTION:${hasAction ? '✅' : '❌'} REPLY:${hasReply ? '✅' : '❌'}`,
                score,
            };
        },
    },
    {
        id: 'json_action',
        name: 'ACTION JSON 格式',
        prompt: '列出當前目錄的檔案。',
        maxTokens: 300,
        validate(text) {
            const m = text.match(/\[GOLEM_ACTION\]([\s\S]*?)\[GOLEM_REPLY\]/);
            if (!m) return { pass: false, detail: '找不到 ACTION 區塊', score: 0 };
            const raw = m[1].trim();
            try {
                const arr = JSON.parse(raw);
                const valid = Array.isArray(arr) && (arr.length === 0 || arr.every(a => 'cmd' in a));
                return {
                    pass: valid,
                    detail: valid ? `✅ 合法 JSON Array (${arr.length} steps)` : '❌ 格式錯誤',
                    score: valid ? 1 : 0,
                };
            } catch {
                return { pass: false, detail: `❌ JSON parse 失敗: ${raw.substring(0, 60)}`, score: 0 };
            }
        },
    },
    {
        id: 'chinese',
        name: '中文品質',
        prompt: '用繁體中文寫一句關於學習的格言（20字以內）。',
        maxTokens: 200,
        validate(text) {
            const m = text.match(/\[GOLEM_REPLY\]([\s\S]*?)$/);
            const reply = m ? m[1].trim() : text;
            const hasChinese = /[\u4e00-\u9fff]/.test(reply);
            const len = reply.replace(/\s/g, '').length;
            const reasonable = len > 5 && len < 100;
            return {
                pass: hasChinese && reasonable,
                detail: hasChinese ? `✅ 有中文 (${len} chars)` : '❌ 無中文',
                score: hasChinese ? 1 : 0,
            };
        },
    },
    {
        id: 'code',
        name: '程式碼能力',
        prompt: '用 JavaScript 寫一個 function，輸入數字陣列，回傳總和。只寫 function，不要解釋。',
        maxTokens: 300,
        validate(text) {
            const hasFunction = /function\s+\w+|const\s+\w+\s*=\s*(\(|function)/.test(text);
            const hasReturn   = /return/.test(text);
            const hasReduce   = /reduce|for|forEach/.test(text);
            const pass = hasFunction && hasReturn;
            return {
                pass,
                detail: `function:${hasFunction ? '✅' : '❌'} return:${hasReturn ? '✅' : '❌'} logic:${hasReduce ? '✅' : '❌'}`,
                score: (hasFunction ? 1 : 0) + (hasReturn ? 1 : 0) + (hasReduce ? 1 : 0),
            };
        },
    },
];

// 每測試最高 1 分（通過/不通過），MAX_SCORE = 4
// validate() 仍回傳內部細粒度 score，runner 以 pass ? 1 : 0 計算總分
const MAX_SCORE = TESTS.length;

module.exports = { TESTS, MAX_SCORE };
