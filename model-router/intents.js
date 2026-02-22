/**
 * Intent → Provider 偏好矩陣
 * 
 * Router 根據健康狀態從候選中主動選最佳的一個，
 * 不是 fallback chain。只有選中的 provider 呼叫失敗時才退到下一個。
 */
const INTENT_PREFERENCES = {
    decision: [
        { provider: 'gemini',    model: 'gemini-2.5-flash-lite' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    chat: [
        { provider: 'gemini',    model: 'gemini-2.5-flash-lite' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'deepseek',  model: 'deepseek-chat' },
    ],
    analysis: [
        { provider: 'gemini',    model: 'gemini-2.5-flash' },
        { provider: 'deepseek',  model: 'deepseek-chat' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
    ],
    reflection: [
        { provider: 'deepseek',  model: 'deepseek-reasoner' },
        { provider: 'gemini',    model: 'gemini-2.5-flash' },
    ],
    utility: [
        { provider: 'gemini',    model: 'gemini-2.5-flash-lite' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    vision: [
        { provider: 'gemini',    model: 'gemini-2.5-flash' },
    ],
};

module.exports = INTENT_PREFERENCES;
