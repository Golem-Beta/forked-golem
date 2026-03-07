'use strict';
/**
 * @module model-benchmark/callers
 * @role LLM 呼叫純函式（Gemini REST + OpenAI-compat REST）
 *
 * 皆走原生 https/http，不依賴 model-router SDK，確保 benchmark 與路由邏輯解耦。
 */

const https = require('https');
const http  = require('http');

/**
 * 呼叫 Gemini REST generateContent API。
 * @param {string} apiKey
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
function callGemini(apiKey, model, systemPrompt, userPrompt, maxTokens) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature: 0.7,
                ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            },
        });

        const reqPath = `/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: reqPath,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: 60000,
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) return reject(new Error(json.error.message));
                    resolve(json.candidates?.[0]?.content?.parts?.[0]?.text || '');
                } catch (e) {
                    reject(new Error('JSON parse failed: ' + data.substring(0, 200)));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
    });
}

/**
 * 呼叫 OpenAI-compat REST chat/completions API。
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
function callOpenAICompat(baseUrl, apiKey, model, systemPrompt, userPrompt, maxTokens) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature: 0.7,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userPrompt },
            ],
        });

        const url = new URL(baseUrl + '/chat/completions');
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(body),
                // openrouter 需要這兩個 header 才不會被 rate-limit
                'HTTP-Referer': 'https://golem.local',
                'X-Title': 'GolemBenchmark',
            },
            timeout: 60000,
        };

        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
                    const msg = json.choices?.[0]?.message;
                    const raw = msg?.content;
                    // magistral 等 reasoning model 回傳 content array [{type:'thinking',...},{type:'text',...}]
                    // deepseek-reasoner 的 content 可能是 null，實際文字在 reasoning_content
                    let text = '';
                    if (Array.isArray(raw)) {
                        const textBlock = raw.find(b => b.type === 'text');
                        text = textBlock?.text || '';
                    } else if (raw) {
                        text = raw;
                    } else if (msg?.reasoning_content) {
                        // reasoning model fallback：content 為 null，用 reasoning_content
                        text = msg.reasoning_content;
                    }
                    resolve(text);
                } catch (e) {
                    reject(new Error('JSON parse failed: ' + data.substring(0, 200)));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
    });
}

module.exports = { callGemini, callOpenAICompat };
