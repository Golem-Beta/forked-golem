/**
 * @module result-handler
 * @role 統一處理 ActionResult 的 side effects
 *
 *   1. failureTracker.record()    — 失敗追蹤
 *   2. brain.memorize()           — 長期記憶寫入（result.memorize 有值時）
 *   3. brain.observe()            — 即時感知注入 chatHistory，不觸發 LLM（result.observe 有值時）
 *   4. side effect 路由           — result.needsReflection → actions.performSelfReflection()
 *
 * 呼叫方：FreeWillRunner.run()（在 switch case 後統一交給此處）
 */

class ResultHandler {
    /**
     * @param {object} deps
     * @param {object} deps.brain          - GolemBrain
     * @param {object} deps.failureTracker - FailureTracker
     * @param {object} deps.actions        - ActionRunner
     */
    constructor({ brain, failureTracker, actions }) {
        this.brain = brain;
        this.failureTracker = failureTracker;
        this.actions = actions;
    }

    /**
     * 處理 action 執行結果的所有 side effects
     * @param {import('./action-result').ActionResult} result
     */
    async handle(result) {
        if (!result) return;

        // 1. 失敗追蹤（success=false 時內部才真正記錄）
        await this.failureTracker.record(result);

        // 2. 長期記憶寫入
        if (result.memorize) {
            const { text, metadata } = result.memorize;
            await this.brain.memorize(text, metadata || {});
        }

        // 3. 即時感知注入（不觸發 LLM）
        if (result.observe) {
            this.brain.observe(result.observe);
        }

        // 4. health_check → self_reflection side effect
        if (result.needsReflection) {
            console.log('🏥 [ResultHandler] 偵測到 needsReflection，5 分鐘後觸發 self_reflection');
            const needsReflection = result.needsReflection;
            setTimeout(
                () => this.actions.performSelfReflection({ trigger: 'health_check', ...needsReflection }),
                5 * 60 * 1000
            );
        }
    }
}

module.exports = { ResultHandler };
