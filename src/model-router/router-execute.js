/**
 * @module model-router/router-execute
 * @role LLM 請求執行器（候選選擇、failover 迴圈、健康狀態更新）
 * @when-to-modify 調整 failover 策略、錯誤分類、健康更新邏輯、回傳 meta 格式時
 *
 * 與 index.js 的職責分界：
 *   index.js          — router 組裝（adapter 建立、lifecycle、相容介面）
 *   router-execute.js — 請求執行（候選迭代、provider 呼叫、失敗退避）
 */

'use strict';

/**
 * 執行一次 LLM 請求，含候選選擇與 failover
 * @param {Map}          adapters - provider name → adapter instance
 * @param {ProviderHealth} health - 健康狀態追蹤器
 * @param {ModelSelector}  selector - 候選選擇器
 * @param {object}         opts   - complete() 的原始參數
 * @returns {Promise<{ text, usage, grounding, rawParts, meta }>}
 */
async function execute(adapters, health, selector, opts) {
    const { intent = 'chat' } = opts;
    const startTime = Date.now();

    const candidates = selector.select(intent);
    if (candidates.length === 0) {
        throw new Error(`[ModelRouter] intent "${intent}" 無可用 provider`);
    }

    let lastError = null;
    const failLog = [];

    for (const candidate of candidates) {
        const { provider, model } = candidate;
        const adapter = adapters.get(provider);
        if (!adapter) continue;

        try {
            const result = await adapter.complete({ ...opts, model });
            const latency = Date.now() - startTime;

            console.log(`✅ [ModelRouter] ${provider}/${model} (${latency}ms, intent=${intent})`);
            health.onSuccess(provider, model);

            return {
                text:      result.text,
                usage:     result.usage,
                grounding: result.grounding || null,
                rawParts:  result.rawParts  || null,
                meta: { provider, model, latency, intent },
            };

        } catch (e) {
            lastError = e;
            const errType = e.providerError || 'error';
            failLog.push(`${provider}: ${(e.message || errType).substring(0, 60)}`);

            // 依錯誤類型更新健康狀態
            if (errType === 'fatal')    health.onFatal(provider);
            else if (errType === '429') health.on429(provider, e.retryAfterMs || 90000);
            else if (errType === '503') health.on503(provider);
            else                        health.onError(provider);

            console.warn(`⚠️ [ModelRouter] ${provider}/${model} failed (${errType}): ${e.message}`);

            // 還有下一個候選，繼續 failover
            if (candidates.indexOf(candidate) < candidates.length - 1) {
                console.log('🔄 [ModelRouter] failover to next candidate...');
                continue;
            }
        }
    }

    const detail = failLog.length > 0 ? failLog.join(', ') : '未知錯誤';
    throw new Error(`[ModelRouter] 所有 provider 均失敗 (intent: ${intent}) — ${detail}`);
}

module.exports = { execute };
