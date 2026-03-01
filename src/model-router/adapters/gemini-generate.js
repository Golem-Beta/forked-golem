/**
 * @module model-router/adapters/gemini-generate
 * @role Gemini SDK 呼叫執行器（純函式，無狀態）
 * @when-to-modify SDK API 格式變更、回應解析、grounding 結構、Gemini 3 thinkingConfig 調整時
 *
 * 與 gemini.js 的職責分界：
 *   gemini.js          — key pool 管理、節流、重試策略、429/503 冷卻
 *   gemini-generate.js — 單次 SDK 呼叫 + 回應解析（不感知重試/key 狀態）
 */

'use strict';

const { GoogleGenAI } = require('@google/genai');

/**
 * 向 Gemini API 發出單次呼叫並解析回應
 * @param {string} apiKey  - 本次使用的 API key
 * @param {object} params  - 請求參數
 * @returns {Promise<{ text, usage, grounding, rawParts }>}
 */
async function doGenerate(apiKey, params) {
    const {
        model, messages, maxTokens, temperature, requireJson,
        systemInstruction, tools, inlineData, chatHistory,
    } = params;

    const client = new GoogleGenAI({ apiKey });
    const isGemini3 = model.startsWith('gemini-3');

    const config = {
        maxOutputTokens: maxTokens,
        temperature,
    };
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (requireJson)        config.responseMimeType = 'application/json';
    // Gemini 3 引入 thinking mode，thinkingBudget: 0 關閉推理節省延遲
    if (isGemini3)          config.thinkingConfig = { thinkingBudget: 0 };
    if (tools)              config.tools = tools;

    let response;

    if (chatHistory) {
        // 對話模式：使用 chat API
        const chat = client.chats.create({ model, history: chatHistory, config });
        const lastMsg = messages[messages.length - 1];
        response = await chat.sendMessage({ message: lastMsg ? lastMsg.content : '' });
    } else if (inlineData) {
        // 多模態模式：contents 包含 text + inlineData parts
        const lastMsg = messages[messages.length - 1];
        const contents = [{
            role: 'user',
            parts: [
                { text: lastMsg ? lastMsg.content : '' },
                { inlineData },
            ],
        }];
        response = await client.models.generateContent({ model, contents, config });
    } else {
        // 簡單模式：messages 合併為 prompt
        const prompt = messages.map(m => m.content).join('\n');
        response = await client.models.generateContent({ model, contents: prompt, config });
    }

    // 檢查 MAX_TOKENS
    const candidate = response.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
        throw Object.assign(
            new Error(`[Gemini] MAX_TOKENS: response truncated by ${model}`),
            { providerError: 'error' }
        );
    }

    // 讀取文字回應（新 SDK 有 .text getter）
    const text = (response.text || '').trim();
    if (!text) {
        throw Object.assign(
            new Error(`[Gemini] empty response from ${model}`),
            { providerError: 'error' }
        );
    }

    // 讀取 grounding metadata
    const gm = candidate?.groundingMetadata;
    const grounding = gm ? {
        webSearchQueries: gm.webSearchQueries || [],
        sources: (gm.groundingChunks || []).map(c => ({
            title: c.web?.title || '',
            url:   c.web?.uri  || '',
        })),
    } : null;

    // rawParts 供 brain.js 保留 thought signature
    const rawParts = candidate?.content?.parts || [{ text }];

    return {
        text,
        usage: {
            inputTokens:  response.usageMetadata?.promptTokenCount     || 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        },
        grounding,
        rawParts,
    };
}

module.exports = { doGenerate };
