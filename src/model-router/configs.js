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
            'moonshotai/kimi-k2-instruct-0905': 1000,
            'qwen/qwen3-32b':              1000,
        },
        defaultRpm: 30,
        modelCapabilities: {
            'llama-3.3-70b-versatile':     ['tristream'],  // benchmark 8/8 通過
            'moonshotai/kimi-k2-instruct-0905': ['long_context'],
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
        priority: 0.1,
        baseUrl: 'https://openrouter.ai/api/v1',
        envKey: 'OPENROUTER_API_KEY',
        multiKey: false,
        rpdLimits: {
            'meta-llama/llama-3.3-70b-instruct:free': 200,
            'moonshotai/kimi-k2.5:free':              200,
            'minimax/minimax-m2.1:free':              200,
            'qwen/qwen3-coder-480b:free':             200,
        },
        defaultRpm: 20,
        modelCapabilities: {
            'meta-llama/llama-3.3-70b-instruct:free': [],
            'moonshotai/kimi-k2.5:free':              ['long_context'],
            'minimax/minimax-m2.1:free':              ['long_context'],
            'qwen/qwen3-coder-480b:free':             ['long_context'],
        },
    },
    cerebras: {
        priority: 0.1,
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
    nvidia: {
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        envKey: 'NVIDIA_API_KEY',
        multiKey: false,
        rpdLimits: {
            'meta/llama-3.3-70b-instruct':               1000,
            'nvidia/llama-3.3-nemotron-super-49b-v1.5':  1000,
            'nvidia/llama-3.1-nemotron-ultra-253b-v1':   500,
            'qwen/qwen3-235b-a22b':                      500,
            'minimaxai/minimax-m2.5':                    500,
        },
        defaultRpm: 40,
        modelCapabilities: {
            'meta/llama-3.3-70b-instruct':               ['long_context'],
            'nvidia/llama-3.3-nemotron-super-49b-v1.5':  ['long_context', 'reasoning'],
            'nvidia/llama-3.1-nemotron-ultra-253b-v1':   ['long_context', 'reasoning'],
            'qwen/qwen3-235b-a22b':                      ['long_context'],
            'minimaxai/minimax-m2.5':                    ['long_context', 'reasoning'],
        },
    },
};

module.exports = PROVIDER_CONFIGS;
