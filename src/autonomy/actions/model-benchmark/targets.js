'use strict';
/**
 * @module model-benchmark/targets
 * @role 從 configs.js 動態讀取 provider 資訊，建立測試目標清單
 *
 * Gemini baseUrl 為 null（原始 SDK），此處改走 REST，故 type='gemini' 由 callers.js 分支處理。
 */

const PROVIDER_CONFIGS = require('../../../model-router/configs');

/**
 * 建立測試目標清單。
 * @param {object} [overrides]
 * @param {string[]} [overrides.models] - 限制只測指定 model 名稱（省略則測全部）
 * @returns {Array<{provider: string, model: string, type: string, key: string, baseUrl?: string}>}
 */
function buildTargets(overrides = {}) {
    const { models: onlyModels } = overrides;
    const targets = [];

    for (const [providerName, config] of Object.entries(PROVIDER_CONFIGS)) {
        const rawKey = process.env[config.envKey] || '';
        const key = config.multiKey
            ? rawKey.split(',')[0].trim()
            : rawKey.trim();

        if (!key) continue;

        const isGemini = providerName === 'gemini';
        const modelsToTest = Object.keys(config.modelCapabilities || {});

        for (const model of modelsToTest) {
            if (onlyModels && !onlyModels.includes(model)) continue;

            targets.push({
                provider: providerName,
                model,
                type: isGemini ? 'gemini' : 'openai',
                key,
                ...(isGemini ? {} : { baseUrl: config.baseUrl }),
            });
        }
    }

    return targets;
}

module.exports = { buildTargets };
