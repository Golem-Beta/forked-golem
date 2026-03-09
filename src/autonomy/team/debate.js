'use strict';
/**
 * @module team/debate
 * @role 協調兩個角色間的辯論（最多 2 輪）
 *   primaryRole  (Architect) — 執行主評估 + 發起挑戰
 *   respondingRole (Analyst) — 回應挑戰
 *   2 輪未收斂：primaryRole 勝出，記錄 divergence 到 journal
 */

class Debate {
    /**
     * @param {object} deps
     * @param {object} deps.journal - JournalManager
     */
    constructor({ journal }) {
        this.journal = journal;
    }

    /**
     * 執行辯論流程
     * @param {object} primaryRole    - 主評估角色（具有 run() 與 challenge()）
     * @param {object} respondingRole - 回應角色（具有 respond()）
     * @param {object} ctx            - 共享 context（含 analystOutput 等前一角色輸出）
     * @returns {Promise<{ diagnosis: string, strategy: object, divergence?: object }|null>}
     */
    async run(primaryRole, respondingRole, ctx) {
        // Step 1: primaryRole 主評估（驗證診斷 + 設計策略）
        const primaryResult = await primaryRole.run(ctx);
        if (!primaryResult) return null;

        const architectOutput = primaryResult.architectOutput;
        if (!architectOutput) return null;

        const baseResult = {
            diagnosis: architectOutput.validated_diagnosis,
            strategy:  architectOutput,
        };

        // rationale 驗證：若 rationale 與 root_cause 無關鍵字交集，強制辯論
        // 避免 Architect 用名稱相似但功能無關的 target_node 矇混過關
        const rootWords = (ctx.analystOutput?.root_cause || '').toLowerCase().match(/\b\w{5,}\b/g) || [];
        const rationale = (architectOutput.rationale || '').toLowerCase();
        if (rootWords.length > 0 && !rootWords.some(w => rationale.includes(w)) && !architectOutput.challenge_needed) {
            console.log('[Debate] rationale 與 root_cause 無關鍵字交集，強制 challenge_needed=true');
            architectOutput.challenge_needed = true;
        }

        // Step 2: 不需辯論 → 直接回傳
        if (!architectOutput.challenge_needed) {
            console.log('[Debate] 無需辯論，直接採用 Architect 策略');
            return baseResult;
        }

        // Step 3: 最多 2 輪辯論
        let debateCtx  = { ...ctx, architectOutput };
        let lastResponse = null;

        for (let round = 1; round <= 2; round++) {
            console.log(`[Debate] 第 ${round} 輪辯論`);

            const challenge = await primaryRole.challenge({ ...debateCtx, debateRound: round, lastResponse });
            if (!challenge) {
                console.warn('[Debate] challenge() 回傳 null，中止辯論');
                break;
            }

            const response = await respondingRole.respond({ ...debateCtx, debateRound: round, challenge });
            if (!response) {
                console.warn('[Debate] respond() 回傳 null，中止辯論');
                break;
            }

            lastResponse = response;
            debateCtx    = { ...debateCtx, lastResponse };

            if (response.consensus === true) {
                console.log(`[Debate] 第 ${round} 輪收斂`);
                return {
                    diagnosis: response.revised_root_cause || architectOutput.validated_diagnosis,
                    strategy:  architectOutput,
                };
            }
        }

        // Step 4: 2 輪未收斂 → Architect 勝出
        const divergence = {
            reason:        '2 輪辯論後未收斂，Architect 視角勝出',
            analystView:   ctx.analystOutput?.root_cause   || '(unknown)',
            architectView: architectOutput.validated_diagnosis,
        };
        console.warn('[Debate] 2 輪未收斂，記錄 divergence');
        this.journal.append({
            action:         'team_debate',
            outcome:        'divergence',
            analyst_view:   divergence.analystView,
            architect_view: divergence.architectView,
        });

        return { ...baseResult, divergence };
    }
}

module.exports = Debate;
