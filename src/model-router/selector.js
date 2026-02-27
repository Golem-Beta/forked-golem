'use strict';
const PROVIDER_CONFIGS = require('./configs');
const INTENT_REQUIREMENTS = require('./intents');

class ModelSelector {
    constructor(router) {
        // 持有 router 引用以存取 adapters、health
        this._r = router;
    }

    /**
     * 動態比對能力需求，選出可用的候選並按健康分數排序
     *
     * 非三流 intent（requires 不含 tristream）對 tristream 模型降分 0.3×，
     * 優先消耗非 Gemini 供應商，保留 Gemini quota 給三流 intent 使用。
     */
    select(intent) {
        const req = INTENT_REQUIREMENTS[intent];
        if (!req) {
            console.warn(`[ModelRouter] Unknown intent "${intent}", falling back to "chat"`);
            return this.select('chat');
        }

        const requires = req.requires || [];
        // 不需要 tristream 的 intent → 對 tristream 模型降分，節省 Gemini quota
        const savePremium = !requires.includes('tristream');

        const buildCandidates = (strict) => {
            const candidates = [];

            for (const [providerName, config] of Object.entries(PROVIDER_CONFIGS)) {
                if (!this._r.adapters.has(providerName)) continue;
                const caps = config.modelCapabilities || {};

                for (const [model, modelCaps] of Object.entries(caps)) {
                    // 能力比對：intent 所需的每個 tag 都必須在 model 能力中
                    if (!requires.every(r => modelCaps.includes(r))) continue;

                    if (strict) {
                        if (!this._r.health.isAvailable(providerName, model)) continue;
                    } else {
                        // 放寬：只要 provider 有 key 就納入
                        const h = this._r.health.get(providerName, model);
                        if (!h || !h.hasKey) continue;
                    }

                    candidates.push({ provider: providerName, model, caps: modelCaps });
                }
            }

            candidates.sort((a, b) => {
                const prioA = PROVIDER_CONFIGS[a.provider]?.priority ?? 1.0;
                const prioB = PROVIDER_CONFIGS[b.provider]?.priority ?? 1.0;
                let scoreA = this._r.health.score(a.provider, a.model) * prioA;
                let scoreB = this._r.health.score(b.provider, b.model) * prioB;
                // tristream 模型降分：讓非 Gemini 優先服務非三流 intent
                if (savePremium) {
                    if (a.caps.includes('tristream')) scoreA *= 0.3;
                    if (b.caps.includes('tristream')) scoreB *= 0.3;
                }
                return scoreB - scoreA;
            });

            return candidates.map(c => ({ provider: c.provider, model: c.model }));
        };

        const strict = buildCandidates(true);
        if (strict.length > 0) return strict;

        // 放寬條件：允許冷卻即將結束的 provider
        return buildCandidates(false);
    }
}

module.exports = ModelSelector;
