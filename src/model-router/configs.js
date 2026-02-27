/**
 * Provider 配置 — 啟動時掃描 .env 對應的 envKey
 * 有值則啟用該 provider，無值則跳過
 *
 * modelCapabilities 定義每個 model 的能力 tag，供 Router 動態比對：
 *   tristream  — 能穩定遵守 [🧠][🤖][💬] 三流格式
 *   vision     — 支援圖片輸入
 *   long_context — 支援長上下文（32K+ tokens）
 *   reasoning  — 強化推理能力
 */
const PROVIDER_CONFIGS = {
    gemini: {
        baseUrl: null,  // 用 Google SDK，不走 REST
        envKey: 'GEMINI_API_KEYS',
        multiKey: true,
        rpdLimits: {
            'gemini-2.5-flash-lite': 20,
            'gemini-2.5-flash': 20,
            'gemini-3-flash-preview': 20,
        },
        defaultRpm: 15,
        modelCapabilities: {
            'gemini-2.5-flash':       ['tristream', 'vision', 'long_context'],
            'gemini-3-flash-preview': ['tristream', 'vision', 'long_context'],
            'gemini-2.5-flash-lite':  ['tristream'],
        },
    },
    groq: {
        baseUrl: 'https://api.groq.com/openai/v1',
        envKey: 'GROQ_API_KEYS',
        multiKey: true,
        rpdLimits: {
            'llama-3.3-70b-versatile':     1000,
            'moonshotai/kimi-k2-instruct': 1000,
            'qwen/qwen3-32b':              1000,
        },
        defaultRpm: 30,
        modelCapabilities: {
            'llama-3.3-70b-versatile':     [],
            'moonshotai/kimi-k2-instruct': ['long_context'],
            'qwen/qwen3-32b':              [],
        },
    },
    deepseek: {
        baseUrl: 'https://api.deepseek.com',
        envKey: 'DEEPSEEK_API_KEY',
        multiKey: false,
        rpdLimits: {
            'deepseek-chat':     Infinity,
            'deepseek-reasoner': Infinity,
        },
        defaultRpm: 60,
        modelCapabilities: {
            'deepseek-chat':     ['long_context'],
            'deepseek-reasoner': ['long_context', 'reasoning'],
        },
    },
    mistral: {
        baseUrl: 'https://api.mistral.ai/v1',
        envKey: 'MISTRAL_API_KEY',
        multiKey: false,
        rpdLimits: {
            'mistral-small-latest': 500,
        },
        defaultRpm: 10,
        modelCapabilities: {
            'mistral-small-latest': [],
        },
    },
    openrouter: {
        baseUrl: 'https://openrouter.ai/api/v1',
        envKey: 'OPENROUTER_API_KEY',
        multiKey: false,
        rpdLimits: {
            'meta-llama/llama-3.3-70b-instruct:free': 200,
        },
        defaultRpm: 20,
        modelCapabilities: {
            'meta-llama/llama-3.3-70b-instruct:free': [],
        },
    },
    cerebras: {
        baseUrl: 'https://api.cerebras.ai/v1',
        envKey: 'CEREBRAS_API_KEY',
        multiKey: false,
        rpdLimits: {
            'llama-3.3-70b': 1000,
        },
        defaultRpm: 30,
        modelCapabilities: {
            'llama-3.3-70b': [],
        },
    },
    sambanova: {
        baseUrl: 'https://api.sambanova.ai/v1',
        envKey: 'SAMBANOVA_API_KEY',
        multiKey: false,
        rpdLimits: {
            'Meta-Llama-3.3-70B-Instruct': 1000,
        },
        defaultRpm: 30,
        modelCapabilities: {
            'Meta-Llama-3.3-70B-Instruct': [],
        },
    },
};

module.exports = PROVIDER_CONFIGS;
