/**
 * @module model-router/adapters/openai-http
 * @role OpenAI-compatible HTTPS 請求執行器（純函式，無狀態）
 * @when-to-modify HTTP 請求格式、回應解析邏輯、或新增錯誤碼處理時
 *
 * 與 openai-compat.js 的職責分界：
 *   openai-compat.js — key pool 管理、輪換、重試策略
 *   openai-http.js   — 原始 HTTPS 請求 + 回應解析（不感知重試/key 狀態）
 */

'use strict';

const https = require('https');

/**
 * 向 OpenAI-compatible API 發出單次 HTTPS 請求並解析回應
 * @param {string} name      - provider 名稱（用於 log / error message）
 * @param {string} baseUrl   - API base URL（e.g. https://api.groq.com/openai/v1）
 * @param {string} apiKey    - 本次使用的 API key
 * @param {object} params    - 請求參數（model, messages, maxTokens, ...）
 * @returns {Promise<{ text: string, usage: { inputTokens, outputTokens } }>}
 */
function doRequest(name, baseUrl, apiKey, params) {
    const { model, messages, maxTokens, temperature, requireJson, systemInstruction } = params;

    const apiMessages = [];
    if (systemInstruction) {
        apiMessages.push({ role: 'system', content: systemInstruction });
    }
    for (const m of messages) {
        apiMessages.push({ role: m.role || 'user', content: m.content });
    }

    const body = {
        model,
        messages: apiMessages,
        max_tokens: maxTokens,
        temperature,
    };

    if (requireJson) {
        body.response_format = { type: 'json_object' };
    }

    const url = new URL(baseUrl + '/chat/completions');
    const postData = JSON.stringify(body);

    return new Promise((resolve, reject) => {
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);

                    if (res.statusCode === 429) {
                        const retryAfterRaw = res.headers['retry-after'];
                        const retryAfterMs = retryAfterRaw ? parseInt(retryAfterRaw) * 1000 : null;
                        const remainingRpm = res.headers['x-ratelimit-remaining-req-minute'];
                        const err = new Error(`[${name}] 429 Too Many Requests`);
                        err.providerError = '429';
                        err.retryAfterMs = retryAfterMs;
                        err.isRpmLimit = (remainingRpm !== undefined && parseInt(remainingRpm) === 0);
                        reject(err);
                        return;
                    }

                    if (res.statusCode === 503) {
                        const err = new Error(`[${name}] 503 Service Unavailable`);
                        err.providerError = '503';
                        reject(err);
                        return;
                    }

                    // 401 (auth) / 402 (balance) = 長期不可用，標記特殊錯誤類型
                    if (res.statusCode === 401 || res.statusCode === 402) {
                        const errMsg = json.error?.message || JSON.stringify(json);
                        const err = new Error(`[${name}] HTTP ${res.statusCode}: ${errMsg}`);
                        err.providerError = 'fatal';  // router 給長冷卻
                        reject(err);
                        return;
                    }

                    if (res.statusCode >= 400) {
                        const errMsg = json.error?.message || JSON.stringify(json);
                        const err = new Error(`[${name}] HTTP ${res.statusCode}: ${errMsg}`);
                        err.providerError = 'error';
                        reject(err);
                        return;
                    }

                    const choice = json.choices?.[0];
                    const rawText = choice?.message?.content
                        || choice?.message?.reasoning_content
                        || '';
                    const usage = json.usage || {};

                    // 空字串視為失敗，讓 router failover 到下一個 provider
                    if (!rawText.trim()) {
                        const err = new Error(`[${name}] empty response from ${model}`);
                        err.providerError = 'error';
                        reject(err);
                        return;
                    }

                    resolve({
                        text: rawText.trim(),
                        usage: {
                            inputTokens: usage.prompt_tokens || 0,
                            outputTokens: usage.completion_tokens || 0,
                        },
                    });
                } catch (e) {
                    reject(new Error(`[${name}] response parse error: ${e.message}`));
                }
            });
        });

        req.on('error', (e) => {
            const err = new Error(`[${name}] network error: ${e.message}`);
            err.providerError = 'error';
            reject(err);
        });

        req.setTimeout(60000, () => {
            req.destroy();
            const err = new Error(`[${name}] request timeout (60s)`);
            err.providerError = 'error';
            reject(err);
        });

        req.write(postData);
        req.end();
    });
}

module.exports = { doRequest };
