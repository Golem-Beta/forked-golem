/**
 * Intent 能力需求矩陣
 *
 * 架構原則（方向 B）：
 *   - Intent 只宣告「需要哪些能力」，不綁定具體 provider/model
 *   - Model 能力在 configs.js 的 modelCapabilities 宣告
 *   - Router 動態比對，自動產生 candidate list
 *
 * 能力 tag 定義：
 *   tristream  — 能穩定遵守 [🧠][🤖][💬] 三流格式（目前只有 Gemini 系列）
 *   vision     — 支援圖片輸入
 *   long_context — 支援長上下文（32K+ tokens）
 *   reasoning  — 強化推理能力（deepseek-reasoner 等）
 *
 * priority 定義：
 *   quality — 優先選高能力模型（tristream 模型不降分）
 *   speed   — 優先選可用性高的模型（tristream 模型降分，節省 Gemini quota）
 *
 * Gemini free tier 容量（3 key 輪替，2026-02 實測）：
 *   flash-lite : 20 RPD × 3 =  60 RPD
 *   flash      : 20 RPD × 3 =  60 RPD
 *   3-flash    : 20 RPD × 3 =  60 RPD（能力 > 2.5 pro，SWE-bench 78%）
 *   pro        :  0 RPD（免費 tier 已移除，不使用）
 */
const INTENT_REQUIREMENTS = {
    // ── 三流 intent（需要 tristream 能力）────────────────────────
    // 主對話：用戶互動，需要記憶寫入和行動執行
    chat:       { requires: ['tristream'], priority: 'quality', defaultMaxTokens: 2048 },
    // 自我反思：proposals 需記入記憶，必須三流
    reflection: { requires: ['tristream'], priority: 'quality', defaultMaxTokens: 1024 },
    // 程式碼編輯：patch 生成，純 JSON Array 輸出，不需三流格式
    // excludeTags: reasoning model 輸出 <think> 過程會破壞 JSON parse
    code_edit:  { requires: [], excludeTags: ['reasoning'], priority: 'quality', defaultMaxTokens: 4096 },

    // ── 非三流 intent（不需 tristream，節省 Gemini quota）─────────
    // 自主社交/摘要：spontaneous_chat、digest，純文字輸出即可
    creative:   { requires: [],           priority: 'quality', defaultMaxTokens: 512  },
    // 深度分析：github/web 研究，長 context 優先
    analysis:   { requires: [],           priority: 'speed',   defaultMaxTokens: 3072 },
    // 快速決策：autonomy 選擇下一個行動，JSON 輸出
    // excludeTags: reasoning model 傾向輸出思考過程而非 JSON，不適合 decision
    decision:   { requires: [], excludeTags: ['reasoning'], priority: 'speed', defaultMaxTokens: 512  },
    // 工具任務：HallucinationGuard、格式判斷等單句任務
    utility:    { requires: [],           priority: 'speed',   defaultMaxTokens: 256  },

    // 社交互動：moltbook_check、moltbook_post 等 AI 社群互動
    // excludeTags: reasoning model 輸出思考過程干擾 JSON plan 解析
    social:     { requires: [], excludeTags: ['reasoning'], priority: 'quality', defaultMaxTokens: 512  },

    // 程式碼審查：ReviewerAgent 語義審查 patch，需要結構化 JSON 輸出
    // excludeTags: reasoning model 的思考過程會破壞 JSON parse
    code_review: { requires: [], excludeTags: ['reasoning'], priority: 'quality', defaultMaxTokens: 1024 },

    // ── 特殊能力 intent ───────────────────────────────────────────
    // 視覺：圖片分析，需要 vision 能力
    vision:     { requires: ['vision'],   priority: 'quality', defaultMaxTokens: 1024 },
};

module.exports = INTENT_REQUIREMENTS;
