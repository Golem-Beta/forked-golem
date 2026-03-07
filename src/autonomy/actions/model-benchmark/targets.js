'use strict';
/**
 * @module model-benchmark/targets
 * @role 從 registry + configs.js 建立測試目標清單
 *
 * 名單來源改為 registry（active + pending_benchmark），
 * provider 連線資訊（baseUrl / key）仍從 configs.js 讀。
 * 每個 target 附帶 suite 欄位，由 runner 決定跑哪些測試。
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../../.env') });
const PROVIDER_CONFIGS  = require('../../../model-router/configs');
const { load: loadReg, initRegistryFromConfigs } = require('../../../model-router/provider-registry');

/**
 * 根據 model 的 capabilities 判斷 suite：
 * 含 reasoning capability → reasoning_suite，否則 standard_suite。
 * pending_benchmark 且 capabilities 為空 → 預設 standard_suite。
 * @param {string[]} capabilities
 * @returns {'standard_suite'|'reasoning_suite'}
 */
function _suitForCaps(capabilities) {
    return (capabilities || []).includes('reasoning') ? 'reasoning_suite' : 'standard_suite';
}

/**
 * 建立測試目標清單。
 * @param {object} [overrides]
 * @param {string[]} [overrides.models] - 限制只測指定 model 名稱（省略則測全部）
 * @returns {Array<{provider, model, type, key, baseUrl?, suite}>}
 */
function buildTargets(overrides = {}) {
    const { models: onlyModels } = overrides;
    initRegistryFromConfigs(PROVIDER_CONFIGS);
    const reg     = loadReg();
    const targets = [];

    for (const [providerName, config] of Object.entries(PROVIDER_CONFIGS)) {
        const rawKey = process.env[config.envKey] || '';
        const keys = config.multiKey
            ? rawKey.split(',').map(k => k.trim()).filter(Boolean)
            : [rawKey.trim()];
        if (!keys[0]) continue;

        const provModels = reg.providers[providerName]?.models || {};
        const isGemini   = providerName === 'gemini';

        for (const [model, info] of Object.entries(provModels)) {
            // 只跑 active；pending_benchmark 留給增量 benchmark
            if (info.status !== 'active') continue;
            if (onlyModels && !onlyModels.includes(model)) continue;

            const keyIdx = targets.filter(t => t.provider === providerName).length;
            const key   = keys[keyIdx % keys.length];
            targets.push({
                provider: providerName,
                model,
                type: isGemini ? 'gemini' : 'openai',
                key,
                suite: _suitForCaps(info.capabilities),
                ...(isGemini ? {} : { baseUrl: config.baseUrl }),
            });
        }
    }

    return targets;
}

module.exports = { buildTargets };
