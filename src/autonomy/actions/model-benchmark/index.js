'use strict';
/**
 * @module model-benchmark/index
 * @role Telegram 觸發入口 — ModelBenchmarkAction extends BaseAction
 *
 * 用法：
 *   await action.run()                               // 測所有 provider/model
 *   await action.run({ models: ['gemini-2.5-flash'] }) // 只測指定 model
 */

const BaseAction      = require('../base-action');
const BenchmarkRunner = require('./runner');

class ModelBenchmarkAction extends BaseAction {
    /**
     * @param {object} [opts]
     * @param {string[]} [opts.models] - 限制只測指定 model 名稱
     * @returns {Promise<{ success: boolean, action: string, outcome: string, detail?: string }>}
     */
    async run(opts = {}) {
        const actionName = 'model_benchmark';
        const abort = this._abortIfChannelDown(actionName);
        if (abort) return abort;

        try {
            const runner = new BenchmarkRunner({
                onProgress: (msg) => console.log(msg),
            });

            const sent = await this.notifier.sendToAdmin('🔬 Model Benchmark 開始，完成後會通知...');
            const { outPath, summary } = await runner.run(opts);

            await this.notifier.sendToAdmin(`📊 ${summary}`);

            this.journal.append({
                action: actionName,
                outcome: this._sentOutcome(sent, 'completed'),
                ...this._sentErrorField(sent),
                outPath,
            });

            return { success: true, action: actionName, outcome: 'completed', detail: summary };
        } catch (e) {
            return this._handleError(actionName, e);
        }
    }
}

module.exports = ModelBenchmarkAction;
