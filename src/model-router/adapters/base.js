/**
 * ProviderAdapter — 所有 LLM provider adapter 的基底 class
 * 子類必須實作 complete() 方法
 */
class ProviderAdapter {
    constructor(name, config) {
        this.name = name;
        this.config = config;
    }

    /**
     * @param {object} params
     * @param {string} params.model - 該 provider 的模型名
     * @param {Array}  params.messages - OpenAI 格式 [{ role, content }]
     * @param {number} [params.maxTokens=4096]
     * @param {number} [params.temperature=0.7]
     * @param {boolean} [params.requireJson=false]
     * @param {string} [params.systemInstruction] - system prompt（獨立傳遞）
     * @param {Array}  [params.tools] - tool definitions（如 google_search）
     * @param {Array}  [params.inlineData] - multimodal data（圖片等）
     * @returns {Promise<{ text: string, usage: { inputTokens: number, outputTokens: number } }>}
     */
    async complete(params) {
        throw new Error(`${this.name}: complete() not implemented`);
    }

    /**
     * 快速檢查此 adapter 是否可用（有 key、未全部冷卻）
     */
    isAvailable() {
        return false;
    }
}

module.exports = ProviderAdapter;
