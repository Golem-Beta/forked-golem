'use strict';
/**
 * @module model-router/model-discovery
 * @role 定期抓 /models endpoint，發現新 model → registry pending_benchmark
 * @when-to-modify 調整 discovery 頻率、新增支援的 provider 類型時
 *
 * 觸發時機：health_check action 內，每 24 小時執行一次（不單獨排程）
 * 排除：gemini（不走 REST /models，用 SDK）
 */
const PROVIDER_CONFIGS = require('./configs');
const registry = require('./provider-registry');

const INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 排除明確非 chat/instruct 的 model（embed、guard、whisper、moderation、vision-only 等）
 * 規則：blocklist pattern，命名含這些關鍵字的不進 pending_benchmark
 */
const NON_CHAT_PATTERNS = [
    /embed/i,
    /guard/i,
    /whisper/i,
    /moderat/i,
    /safety/i,
    /reward/i,
    /rerank/i,
    /retriev/i,
    /parse/i,
    /transcrib/i,
    /translate/i,
    /ocr/i,
    /vision(?!.*instruct)/i,   // vision 但非 vision-instruct
    /clip/i,
    /deplot/i,
    /paligemma/i,
    /neva/i,
    /vila(?!$)/i,
    /blip/i,
    /streampetr/i,
    /llemma/i,
    /starcoder/i,
    /codellama.*solidity/i,
    /fuyu/i,
];

function isChatModel(modelId) {
    return !NON_CHAT_PATTERNS.some(p => p.test(modelId));
}

/**
 * OpenRouter 專用：用 /models 回傳的 metadata 判斷是否值得 benchmark
 * 條件：output_modalities 含 text + pricing.prompt <= MAX_PROMPT_PRICE
 * MAX_PROMPT_PRICE = 0.000010（$10/M token）— 超過這個對 Golem 來說不實際
 */
const OR_MAX_PROMPT_PRICE = 0;  // 只收錄 free tier（pricing.prompt === "0"）

function isOpenRouterUsable(model) {
    // 必須能輸出 text
    const outMods = model.architecture?.output_modalities || [];
    if (!outMods.includes('text')) return false;
    // 價格在接受範圍內（free = 0，或 <= $10/M）
    const promptPrice = parseFloat(model.pricing?.prompt || '0');
    if (promptPrice > OR_MAX_PROMPT_PRICE) return false;
    return true;
}

/**
 * 抓單一 provider 的 /models 清單
 * @returns {Promise<string[]>}
 */
async function fetchModels(baseUrl, apiKey) {
    const resp = await fetch(`${baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // 回傳完整物件，保留 metadata 供 OpenRouter 過濾使用
    return (data.data || data.models || []).filter(m => m.id || m.name);
}

/**
 * 執行一次 discovery（跳過 gemini、跳過距上次不足 24h 的 provider）
 * @returns {Promise<number>} 新發現的 model 數量
 */
async function runDiscovery() {
    const reg = registry.load();
    let discovered = 0;

    for (const [providerName, config] of Object.entries(PROVIDER_CONFIGS)) {
        if (providerName === 'gemini') continue;   // 不走 REST /models
        if (providerName === 'nvidia') continue;    // /models 無 metadata，完全依賴 configs.js rpdLimits
        if (!config.baseUrl) continue;

        const rawKey = process.env[config.envKey] || '';
        const apiKey = config.multiKey ? rawKey.split(',')[0].trim() : rawKey.trim();
        if (!apiKey) continue;

        // 24h 頻率控制
        const provData = reg.providers[providerName];
        if (provData?.lastDiscovery) {
            const elapsed = Date.now() - new Date(provData.lastDiscovery).getTime();
            if (elapsed < INTERVAL_MS) continue;
        }

        try {
            const models = await fetchModels(config.baseUrl, apiKey);
            const known = Object.keys(provData?.models || {});  // registry keys 就是 model id
            const newModels = providerName === 'openrouter'
                ? models.filter(m => !known.includes(m.id) && isOpenRouterUsable(m))
                : models.filter(m => !known.includes(m.id || m.name) && isChatModel(m.id || m.name));

            for (const modelObj of newModels) {
                const model = modelObj.id || modelObj.name;
                registry.updateModelStatus(providerName, model, {
                    status: 'pending_benchmark',
                    capabilities: [],
                    benchmarkScore: null,
                    benchmarkMax: null,
                    benchmarkDate: null,
                    avgLatencyMs: null,
                    notes: `discovered ${new Date().toISOString().split('T')[0]}`,
                });
                console.log(`[Discovery] 新發現 ${providerName}/${model} → pending_benchmark`);
                discovered++;
            }

            // 更新 lastDiscovery
            const freshReg = registry.load();
            if (!freshReg.providers[providerName]) {
                freshReg.providers[providerName] = { models: {}, discoveredAt: new Date().toISOString() };
            }
            freshReg.providers[providerName].lastDiscovery = new Date().toISOString();
            registry.save(freshReg);

        } catch (e) {
            console.warn(`[Discovery] ${providerName} /models 失敗:`, e.message);
        }
    }

    if (discovered > 0) console.log(`[Discovery] 本次共發現 ${discovered} 個新 model`);
    return discovered;
}

module.exports = { runDiscovery };
