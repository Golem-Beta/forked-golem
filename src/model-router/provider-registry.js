'use strict';
/**
 * @module model-router/provider-registry
 * @role Registry 讀寫（memory/provider-registry.json）
 * @when-to-modify 調整 registry 結構或讀寫邏輯時
 *
 * registry 是覆蓋層，優先於 configs.js 靜態設定。
 * configs.js 為人工維護底線，registry 為動態更新層。
 *
 * model 結構（v2）：
 * {
 *   status: 'active|pending_benchmark|benched|disabled',
 *   capabilities: ['tristream', 'reasoning', 'code', 'long_context', 'vision'],
 *   benchmarkScores: { tristream: 1, code: 1, chinese: 1, reasoning_quality: 1 },
 *   benchmarkMax: 4,
 *   benchmarkDate: '2026-03-07',
 *   avgLatencyMs: 1200,
 *   failureStreak: 0,
 *   notes: '',
 * }
 *
 * benched = roster 擇優後退場，分數正常，可被下次 benchmark 復活。
 * disabled = benchmark 失敗達門檻。
 */
const fs   = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(process.cwd(), 'memory', 'provider-registry.json');
const EMPTY = { version: 2, updatedAt: null, providers: {} };

/**
 * 初始能力對照表（原 configs.js modelCapabilities，遷移至此）
 * 供 initRegistryFromConfigs 在 model 尚未進 registry 時作為起始 capabilities。
 */
const INITIAL_CAPABILITIES = {
    gemini: {
        'gemini-2.5-flash':             ['tristream', 'vision', 'long_context'],
        'gemini-2.5-flash-lite':        ['tristream'],
        'gemini-3-flash-preview':        ['tristream'],  // probe OK 2026-03-08
        'gemini-3.1-flash-lite-preview': ['tristream'],  // probe OK 2026-03-08
    },
    groq: {
        'llama-3.3-70b-versatile':                        ['tristream'],
        'openai/gpt-oss-120b':                            ['tristream', 'reasoning'],
        'openai/gpt-oss-20b':                             ['tristream'],
        'meta-llama/llama-4-maverick-17b-128e-instruct':  ['tristream'],
        'meta-llama/llama-4-scout-17b-16e-instruct':      ['tristream'],
        'moonshotai/kimi-k2-instruct-0905':               ['tristream', 'long_context'],
        'moonshotai/kimi-k2-instruct':                    ['tristream', 'long_context'],
        'qwen/qwen3-32b':                                 [],
    },
    deepseek: {
        'deepseek-chat':     ['tristream', 'long_context'],
        'deepseek-reasoner': ['reasoning', 'long_context'],
    },
    mistral: {
        'mistral-small-latest':    ['tristream'],
        'mistral-large-latest':    ['tristream'],
        'magistral-medium-latest': ['reasoning'],
    },
    cerebras: {
        'gpt-oss-120b': [],
    },
    sambanova: {
        'Meta-Llama-3.3-70B-Instruct':        ['tristream'],
        'Llama-4-Maverick-17B-128E-Instruct': ['tristream'],
        'DeepSeek-V3-0324':                   ['tristream', 'long_context'],
        'Qwen3-32B':                          [],
        'gpt-oss-120b':                       [],
    },
    openrouter: {
        'qwen/qwen3-next-80b-a3b-instruct:free': ['tristream'],
    },
    nvidia: {
        'meta/llama-3.3-70b-instruct': ['tristream'],
        'deepseek-ai/deepseek-v3.1':   ['long_context'],
    },
};

/**
 * 舊 schema（v1）自動遷移：benchmarkScore → benchmarkScores.tristream
 * @param {object} reg - 已解析的 registry 物件（in-place 修改）
 * @returns {boolean} 是否有任何修改
 */
function _migrateSchema(reg) {
    let changed = false;
    for (const provData of Object.values(reg.providers)) {
        for (const info of Object.values(provData.models || {})) {
            if ('benchmarkScore' in info && !('benchmarkScores' in info)) {
                info.benchmarkScores = typeof info.benchmarkScore === 'number'
                    ? { tristream: info.benchmarkScore }
                    : {};
                delete info.benchmarkScore;
                changed = true;
            }
            if (!('benchmarkScores' in info)) {
                info.benchmarkScores = {};
                changed = true;
            }
        }
    }
    return changed;
}

function load() {
    try {
        if (!fs.existsSync(REGISTRY_PATH)) return { ...EMPTY, providers: {} };
        const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
        if (_migrateSchema(reg)) save(reg);
        return reg;
    } catch (e) {
        console.warn('[Registry] 讀取失敗，使用空白 registry:', e.message);
        return { ...EMPTY, providers: {} };
    }
}

function save(data) {
    try {
        data.updatedAt = new Date().toISOString();
        fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.warn('[Registry] 寫入失敗:', e.message);
    }
}

/**
 * 更新單一 model 的欄位（patch style）
 * @param {string} provider
 * @param {string} model
 * @param {object} patch
 */
function updateModelStatus(provider, model, patch) {
    const reg = load();
    if (!reg.providers[provider]) {
        reg.providers[provider] = { models: {}, discoveredAt: new Date().toISOString(), lastDiscovery: null };
    }
    if (!reg.providers[provider].models[model]) {
        reg.providers[provider].models[model] = { status: 'active', benchmarkScores: {} };
    }
    Object.assign(reg.providers[provider].models[model], patch);
    save(reg);
}

/**
 * 回傳 status=pending_benchmark 的 model 清單
 * @returns {Array<{provider: string, model: string, info: object}>}
 */
function getPendingBenchmark() {
    const reg = load();
    const pending = [];
    for (const [provider, provData] of Object.entries(reg.providers)) {
        for (const [model, info] of Object.entries(provData.models || {})) {
            if (info.status === 'pending_benchmark') pending.push({ provider, model, info });
        }
    }
    return pending;
}

/**
 * 取得單一 model 的 registry 資訊（不存在時回傳 null）
 * @param {string} provider
 * @param {string} model
 * @returns {object|null}
 */
function getModelInfo(provider, model) {
    const reg = load();
    return reg.providers[provider]?.models[model] || null;
}

/**
 * 從 providerConfigs 初始化 registry：對尚未存在的 model 補入預設條目。
 * 已有資料的 model 不覆蓋（只補缺失欄位）。
 * 應在 ModelRouter 啟動時呼叫一次。
 * @param {object} providerConfigs - PROVIDER_CONFIGS（configs.js）
 */
function initRegistryFromConfigs(providerConfigs) {
    const reg = load();
    let changed = false;

    for (const [prov, config] of Object.entries(providerConfigs)) {
        if (!reg.providers[prov]) {
            reg.providers[prov] = { models: {}, discoveredAt: new Date().toISOString(), lastDiscovery: null };
        }
        const initCaps  = INITIAL_CAPABILITIES[prov] || {};
        const rpdModels = Object.keys(config.rpdLimits || {});

        for (const model of rpdModels) {
            if (reg.providers[prov].models[model]) {
                // 已有條目：確保新欄位存在（向前兼容）
                const info = reg.providers[prov].models[model];
                if (!('benchmarkScores' in info)) {
                    info.benchmarkScores = {};
                    changed = true;
                }
                if (!('failureStreak' in info)) {
                    info.failureStreak = 0;
                    changed = true;
                }
                // 若 INITIAL_CAPABILITIES 確認有能力但 status 還是 pending_benchmark，升為 active
                const knownCaps = initCaps[model] || [];
                if (info.status === 'pending_benchmark' && knownCaps.length > 0) {
                    info.status = 'active';
                    if (!info.capabilities || info.capabilities.length === 0) {
                        info.capabilities = knownCaps;
                    }
                    changed = true;
                }
                continue;
            }
            const caps = initCaps[model] || [];
            reg.providers[prov].models[model] = {
                status:          caps.length > 0 ? 'active' : 'pending_benchmark',
                capabilities:    caps,
                benchmarkScores: {},
                benchmarkMax:    null,
                benchmarkDate:   null,
                avgLatencyMs:    null,
                failureStreak:   0,
                notes:           '',
            };
            changed = true;
        }
    }

    if (changed) save(reg);
}

module.exports = { load, save, updateModelStatus, getPendingBenchmark, getModelInfo, initRegistryFromConfigs };
