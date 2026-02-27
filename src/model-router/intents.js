/**
 * Intent → Provider 偏好矩陣
 *
 * 架構原則（方向 A）：
 *   - 三流（記憶/行動/回覆）是 Golem 的認知架構，必須由能遵循格式的 model 執行
 *   - 目前只有 Gemini 系列可靠遵循三流格式，其他 provider 只做 decision/utility
 *   - 三流 intent（chat/creative/reflection/code_edit）只走 Gemini，無開源 model fallback
 *   - 非三流 intent（decision/utility）開放所有 provider，速度和容量優先
 *
 * Gemini free tier 容量（3 key 輪替，2026-02 實測）：
 *   flash-lite : 20 RPD × 3 =  60 RPD
 *   flash      : 20 RPD × 3 =  60 RPD
 *   3-flash    : 20 RPD × 3 =  60 RPD（能力 > 2.5 pro，SWE-bench 78%）
 *   pro        :  0 RPD（免費 tier 已移除，不使用）
 */
const INTENT_PREFERENCES = {
    // ── 三流 intent（Gemini 專屬）────────────────────────────────
    // 主對話：用戶互動，需要記憶寫入和行動執行
    chat: [
        { provider: 'gemini', model: 'gemini-2.5-flash' },
        { provider: 'gemini', model: 'gemini-2.5-flash-lite' },  // flash 耗盡時降級
    ],
    // 自主社交/摘要：spontaneous_chat、digest，需要情感溫度 + 三流
    creative: [
        { provider: 'gemini', model: 'gemini-2.5-flash' },
        { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    ],
    // 深度分析：github/web 研究，需要長 context + 三流
    analysis: [
        { provider: 'gemini', model: 'gemini-2.5-flash' },
        { provider: 'gemini', model: 'gemini-3-flash-preview' },
        { provider: 'deepseek', model: 'deepseek-chat' },  // 無三流，analysis 不需要行動
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    // 自我反思：閱讀程式碼、提出改進，需要三流（proposals 要記入記憶）
    reflection: [
        { provider: 'gemini', model: 'gemini-2.5-flash' },
        { provider: 'gemini', model: 'gemini-3-flash-preview' },
        { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    ],
    // 程式碼編輯：self_reflection patch 生成，最高 instruction following 要求
    code_edit: [
        { provider: 'gemini', model: 'gemini-3-flash-preview' },
        { provider: 'gemini', model: 'gemini-2.5-flash' },
        { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    ],

    // ── 非三流 intent（全 provider 可用）─────────────────────────
    // 快速決策：autonomy 選擇下一個行動，JSON 輸出
    decision: [
        { provider: 'gemini',    model: 'gemini-2.5-flash-lite' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'deepseek',  model: 'deepseek-chat' },
        { provider: 'mistral',   model: 'mistral-small-latest' },
        { provider: 'cerebras',  model: 'llama-3.3-70b' },
        { provider: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    // 工具任務：HallucinationGuard、格式判斷等單句任務
    utility: [
        { provider: 'gemini',    model: 'gemini-2.5-flash-lite' },
        { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
        { provider: 'mistral',   model: 'mistral-small-latest' },
        { provider: 'cerebras',  model: 'llama-3.3-70b' },
        { provider: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    // 視覺：圖片分析，Gemini 專屬
    vision: [
        { provider: 'gemini', model: 'gemini-2.5-flash' },
    ],
};

module.exports = INTENT_PREFERENCES;
