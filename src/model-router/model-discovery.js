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
    return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean);
}

/**
 * 執行一次 discovery（跳過 gemini、跳過距上次不足 24h 的 provider）
 * @returns {Promise<number>} 新發現的 model 數量
 */
async function runDiscovery() {
    const reg = registry.load();
    let discovered = 0;

    for (const [providerName, config] of Object.entries(PROVIDER_CONFIGS)) {
        if (providerName === 'gemini') continue;
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
            const known = Object.keys(provData?.models || {});
            const newModels = models.filter(m => !known.includes(m));

            for (const model of newModels) {
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
