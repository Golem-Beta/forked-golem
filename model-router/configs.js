/**
 * Provider 配置 — 啟動時掃描 .env 對應的 envKey
 * 有值則啟用該 provider，無值則跳過
 */
const PROVIDER_CONFIGS = {
    gemini: {
        baseUrl: null,  // 用 Google SDK，不走 REST
        envKey: 'GEMINI_API_KEYS',
        multiKey: true,
        rpdLimits: {
            'gemini-2.5-flash-lite': 1000,
            'gemini-2.5-flash': 250,
            'gemini-2.5-pro': 100,
        },
        defaultRpm: 15,
    },
    groq: {
        baseUrl: 'https://api.groq.com/openai/v1',
        envKey: 'GROQ_API_KEY',
        multiKey: false,
        rpdLimits: {
            'llama-3.3-70b-versatile': 1000,
            'moonshotai/kimi-k2-instruct': 1000,
            'qwen/qwen3-32b': 1000,
        },
        defaultRpm: 30,
    },
    deepseek: {
        baseUrl: 'https://api.deepseek.com',
        envKey: 'DEEPSEEK_API_KEY',
        multiKey: false,
        rpdLimits: {
            'deepseek-chat': Infinity,
            'deepseek-reasoner': Infinity,
        },
        defaultRpm: 60,
    },
    mistral: {
        baseUrl: 'https://api.mistral.ai/v1',
        envKey: 'MISTRAL_API_KEY',
        multiKey: false,
        rpdLimits: {
            'mistral-small-latest': 500,
        },
        defaultRpm: 10,
    },
    openrouter: {
        baseUrl: 'https://openrouter.ai/api/v1',
        envKey: 'OPENROUTER_API_KEY',
        multiKey: false,
        rpdLimits: {
            'meta-llama/llama-3.3-70b-instruct:free': 200,
        },
        defaultRpm: 20,
    },
};

module.exports = PROVIDER_CONFIGS;
