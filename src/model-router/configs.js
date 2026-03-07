/**
 * Provider 配置 — 啟動時掃描 .env 對應的 envKey
 * 有值則啟用該 provider，無值則跳過
 *
 * modelCapabilities 已移至 provider-registry.js（INITIAL_CAPABILITIES）
 * Selector 在執行期從 registry 讀取能力，不再依賴此檔案的靜態設定。
 *
 * maxActiveModels：每個 provider 最多同時保持幾個 active model（roster 修剪上限）
 */
const PROVIDER_CONFIGS = {
    gemini: {
        baseUrl: null,
        envKey: 'GEMINI_API_KEYS',
        multiKey: true,
        maxActiveModels: 4,
        rpdLimits: {
            'gemini-2.5-flash-lite': 20,
            'gemini-2.5-flash': 20,
        },
        defaultRpm: 15,
    },
    groq: {
        baseUrl: 'https://api.groq.com/openai/v1',
        envKey: 'GROQ_API_KEYS',
        multiKey: true,
        maxActiveModels: 4,
        rpdLimits: {
            'llama-3.3-70b-versatile':                        1000,
            'openai/gpt-oss-120b':                            1000,
            'openai/gpt-oss-20b':                             1000,
            'meta-llama/llama-4-maverick-17b-128e-instruct':  1000,
            'meta-llama/llama-4-scout-17b-16e-instruct':      1000,
            'moonshotai/kimi-k2-instruct-0905':               1000,
            'moonshotai/kimi-k2-instruct':                    1000,
            'qwen/qwen3-32b':                                 1000,
        },
        defaultRpm: 30,
    },
    deepseek: {
        baseUrl: 'https://api.deepseek.com',
        envKey: 'DEEPSEEK_API_KEY',
        multiKey: false,
        maxActiveModels: 4,
        rpdLimits: {
            'deepseek-chat':     Infinity,
            'deepseek-reasoner': Infinity,
        },
        defaultRpm: 60,
    },
    mistral: {
        baseUrl: 'https://api.mistral.ai/v1',
        envKey: 'MISTRAL_API_KEY',
        multiKey: false,
        maxActiveModels: 4,
        rpdLimits: {
            'mistral-small-latest':    500,
            'mistral-large-latest':    500,
            'magistral-medium-latest': 500,
        },
        defaultRpm: 10,
    },
    cerebras: {
        priority: 0.1,
        baseUrl: 'https://api.cerebras.ai/v1',
        envKey: 'CEREBRAS_API_KEY',
        multiKey: false,
        maxActiveModels: 4,
        rpdLimits: {
            'gpt-oss-120b': 1000,
        },
        defaultRpm: 30,
    },
    sambanova: {
        baseUrl: 'https://api.sambanova.ai/v1',
        envKey: 'SAMBANOVA_API_KEY',
        multiKey: false,
        maxActiveModels: 4,
        rpdLimits: {
            'Meta-Llama-3.3-70B-Instruct':         1000,
            'Llama-4-Maverick-17B-128E-Instruct':  1000,
            'DeepSeek-V3-0324':                    1000,
            'Qwen3-32B':                           1000,
            'gpt-oss-120b':                        1000,
        },
        defaultRpm: 30,
    },
    openrouter: {
        baseUrl: 'https://openrouter.ai/api/v1',
        envKey: 'OPENROUTER_API_KEY',
        multiKey: true,
        maxActiveModels: 4,
        minIntervalMs: 3000,  // upstream rate limit 敏感，請求間強制 3s 緩衝
        rpdLimits: {
            'qwen/qwen3-next-80b-a3b-instruct:free': 200,
        },
        defaultRpm: 20,
    },
    nvidia: {
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        envKey: 'NVIDIA_API_KEY',
        multiKey: false,
        maxActiveModels: 4,
        rpdLimits: {
            'meta/llama-3.3-70b-instruct': 1000,
            'deepseek-ai/deepseek-v3.1':   500,
        },
        defaultRpm: 40,
    },
};

module.exports = PROVIDER_CONFIGS;
