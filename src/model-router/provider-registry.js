'use strict';
/**
 * @module model-router/provider-registry
 * @role Registry 讀寫（memory/provider-registry.json）
 * @when-to-modify 調整 registry 結構或讀寫邏輯時
 *
 * registry 是覆蓋層，優先於 configs.js 靜態設定。
 * configs.js 為人工維護底線，registry 為動態更新層。
 */
const fs   = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(process.cwd(), 'memory', 'provider-registry.json');
const EMPTY = { version: 1, updatedAt: null, providers: {} };

function load() {
    try {
        if (!fs.existsSync(REGISTRY_PATH)) return { ...EMPTY, providers: {} };
        return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
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
        reg.providers[provider].models[model] = { status: 'active' };
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

module.exports = { load, save, updateModelStatus, getPendingBenchmark, getModelInfo };
