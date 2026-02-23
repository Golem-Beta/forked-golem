/**
 * Intent → Provider 偏好矩陣
 * 
 * Router 根據健康狀態從候選中主動選最佳的一個，
 * 不是 fallback chain。只有選中的 provider 呼叫失敗時才退到下一個。
 * OpenRouter (:free) 作為所有 intent 的 ultimate fallback。
 */
const INTENT_PREFERENCES = {
    decision: [
        { provider: 'gemini',    model: 'gemini-2.5-flash-lite' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'mistral',   model: 'mistral-small-latest' },
        { provider: 'cerebras',  model: 'llama-3.3-70b' },
        { provider: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    chat: [
        { provider: 'gemini',    model: 'gemini-2.5-flash-lite' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'mistral',   model: 'mistral-small-latest' },
        { provider: 'deepseek',  model: 'deepseek-chat' },
        { provider: 'cerebras',  model: 'llama-3.3-70b' },
        { provider: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    analysis: [
        { provider: 'gemini',    model: 'gemini-2.5-flash' },
        { provider: 'deepseek',  model: 'deepseek-chat' },
        { provider: 'mistral',   model: 'mistral-small-latest' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'cerebras',  model: 'llama-3.3-70b' },
        { provider: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    reflection: [
        { provider: 'gemini',    model: 'gemini-2.5-flash' },
        { provider: 'deepseek',  model: 'deepseek-chat' },
        { provider: 'mistral',   model: 'mistral-small-latest' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'cerebras',  model: 'llama-3.3-70b' },
        { provider: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    utility: [
        { provider: 'gemini',    model: 'gemini-2.5-flash-lite' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'mistral',   model: 'mistral-small-latest' },
        { provider: 'cerebras',  model: 'llama-3.3-70b' },
        { provider: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    vision: [
        { provider: 'gemini',    model: 'gemini-2.5-flash' },
    ],
};

module.exports = INTENT_PREFERENCES;
