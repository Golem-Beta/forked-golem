'use strict';
/**
 * @module model-benchmark/tests
 * @role 基準測試單元定義（5 個測試，按 suite 分組）
 *
 * standard_suite：['tristream', 'json_action', 'chinese', 'code']  → 給非 reasoning model
 * reasoning_suite：['chinese', 'code', 'reasoning_quality']         → 給 reasoning model
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
    {
        id: 'reasoning_quality',
        name: '推理品質',
        // 甲=10, 乙=30, 合計=40（不需要三流格式）
        prompt: '甲有一些糖，乙的糖是甲的 3 倍。如果乙給甲 10 顆糖，兩人糖數相等。請問兩人原本共有幾顆糖？請用繁體中文說明推理過程，最後給出答案數字。',
        maxTokens: 500,
        validate(text) {
            const hasChinese = /[\u4e00-\u9fff]/.test(text);
            const hasAnswer  = /40|四十/.test(text);
            const pass = hasChinese && hasAnswer;
            return {
                pass,
                detail: `chinese:${hasChinese ? '✅' : '❌'} answer(40):${hasAnswer ? '✅' : '❌'} length:${text.length}`,
                score: (hasChinese ? 1 : 0) + (hasAnswer ? 1 : 0),
            };
        },
    },
];

/**
 * Suite 定義：test id 清單
 * standard_suite：一般 model（需三流格式）
 * reasoning_suite：reasoning model（不強求三流格式）
 */
const SUITES = {
    standard_suite: ['tristream', 'json_action', 'chinese', 'code'],
    reasoning_suite: ['chinese', 'code', 'reasoning_quality'],
};

/** 每個 suite 的滿分 */
const SUITE_MAX_SCORE = {
    standard_suite: 4,
    reasoning_suite: 3,
};

// 向後兼容：MAX_SCORE 指 standard_suite 滿分
const MAX_SCORE = SUITE_MAX_SCORE.standard_suite;

module.exports = { TESTS, SUITES, SUITE_MAX_SCORE, MAX_SCORE };
