/**
 * Provider 配置 — 啟動時掃描 .env 對應的 envKey
 * 有值則啟用該 provider，無值則跳過
 *
 * modelCapabilities 定義每個 model 的能力 tag，供 Router 動態比對：
 *   tristream  — 能穩定遵守 [🧠][🤖][💬] 三流格式（三輪 benchmark 一致通過）
 *   vision     — 支援圖片輸入
 *   long_context — 支援長上下文（32K+ tokens）
 *   reasoning  — 強化推理能力（注意：可能輸出 <think> 標籤）
 *
 * 最後 benchmark: 2026-03-07 (23 models × 4 tests × 3 runs)
 */
const PROVIDER_CONFIGS = {
    gemini: {
        baseUrl: null,
        envKey: 'GEMINI_API_KEYS',
        multiKey: true,
        rpdLimits: {
            'gemini-2.5-flash-lite': 20,
            'gemini-2.5-flash': 20,
        },
        defaultRpm: 15,
        modelCapabilities: {
            'gemini-2.5-flash':      ['tristream', 'vision', 'long_context'],
            'gemini-2.5-flash-lite': ['tristream'],
        },
    },
    groq: {
        baseUrl: 'https://api.groq.com/openai/v1',
        envKey: 'GROQ_API_KEYS',
        multiKey: true,
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
        modelCapabilities: {
            'llama-3.3-70b-versatile':                        ['tristream'],
            'openai/gpt-oss-120b':                            ['tristream', 'reasoning'],
            'openai/gpt-oss-20b':                             ['tristream'],
            'meta-llama/llama-4-maverick-17b-128e-instruct':  ['tristream'],
            'meta-llama/llama-4-scout-17b-16e-instruct':      ['tristream'],
            'moonshotai/kimi-k2-instruct-0905':               ['tristream', 'long_context'],
            'moonshotai/kimi-k2-instruct':                    ['tristream', 'long_context'],
            'qwen/qwen3-32b':                                 [],  // ACTION 區塊不穩、中文字數評分 bug
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
            'deepseek-chat':     ['tristream', 'long_context'],
            'deepseek-reasoner': ['reasoning', 'long_context'],  // tristream/code 持續失敗
        },
    },
    mistral: {
        baseUrl: 'https://api.mistral.ai/v1',
        envKey: 'MISTRAL_API_KEY',
        multiKey: false,
        rpdLimits: {
            'mistral-small-latest':    500,
            'mistral-large-latest':    500,
            'magistral-medium-latest': 500,
        },
        defaultRpm: 10,
        modelCapabilities: {
            'mistral-small-latest':    ['tristream'],
            'mistral-large-latest':    ['tristream'],
            'magistral-medium-latest': ['reasoning'],  // tristream/中文持續失敗，但 ACTION/code 通過
        },
    },
    cerebras: {
        priority: 0.1,
        baseUrl: 'https://api.cerebras.ai/v1',
        envKey: 'CEREBRAS_API_KEY',
        multiKey: false,
        rpdLimits: {
            'gpt-oss-120b': 1000,
        },
        defaultRpm: 30,
        modelCapabilities: {
            'gpt-oss-120b': [],  // 中文結果不穩（2/3 輪失敗），不加 tristream
        },
    },
    sambanova: {
        baseUrl: 'https://api.sambanova.ai/v1',
        envKey: 'SAMBANOVA_API_KEY',
        multiKey: false,
        rpdLimits: {
            'Meta-Llama-3.3-70B-Instruct':         1000,
            'Llama-4-Maverick-17B-128E-Instruct':  1000,
            'DeepSeek-V3-0324':                    1000,
            'Qwen3-32B':                           1000,
            'gpt-oss-120b':                        1000,
        },
        defaultRpm: 30,
        modelCapabilities: {
            'Meta-Llama-3.3-70B-Instruct':        ['tristream'],
            'Llama-4-Maverick-17B-128E-Instruct': ['tristream'],
            'DeepSeek-V3-0324':                   ['tristream', 'long_context'],  // code 偶爾伺服器錯誤，整體穩
            'Qwen3-32B':                          [],  // tristream T1 不穩、ACTION T3 失敗
            'gpt-oss-120b':                       [],  // ACTION/中文持續失敗
        },
    },
    openrouter: {
        baseUrl: 'https://openrouter.ai/api/v1',
        envKey: 'OPENROUTER_API_KEY',
        multiKey: true,
        rpdLimits: {
            'qwen/qwen3-next-80b-a3b-instruct:free': 200,
        },
        defaultRpm: 20,
        modelCapabilities: {
            // interval=3s 測試 4/4 全過。upstream rate limit 敏感，router 已有 openrouter 120s cooldown。
            'qwen/qwen3-next-80b-a3b-instruct:free': ['tristream'],
        },
    },
    nvidia: {
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        envKey: 'NVIDIA_API_KEY',
        multiKey: false,
        rpdLimits: {
            'meta/llama-3.3-70b-instruct': 1000,
            'deepseek-ai/deepseek-v3.1':   500,
        },
        defaultRpm: 40,
        modelCapabilities: {
            'meta/llama-3.3-70b-instruct': ['tristream'],
            'deepseek-ai/deepseek-v3.1':   ['long_context'],  // tristream 跨輪不穩（timeout/✅交替）
        },
    },
};

module.exports = PROVIDER_CONFIGS;
