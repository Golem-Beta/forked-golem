'use strict';
/**
 * @module model-benchmark/index
 * @role Telegram 觸發入口 — ModelBenchmarkAction extends BaseAction
 *
 * 用法：
 *   await action.run()                               // 測所有 provider/model
 *   await action.run({ models: ['gemini-2.5-flash'] }) // 只測指定 model
 */

const fs              = require('fs');
const path            = require('path');
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
            const { outPath, summary, perModelResults, registryDelta } = await runner.run(opts);

            // Telegram 通知：加上 registry 變動摘要
            let notifMsg = `📊 ${summary}`;
            if (registryDelta.activated.length)
                notifMsg += `\n✅ 啟用：${registryDelta.activated.join(', ')}`;
            if (registryDelta.disabled.length)
                notifMsg += `\n❌ 停用：${registryDelta.disabled.map(d => d.key).join(', ')}`;
            if (registryDelta.skipped.length)
                notifMsg += `\n⏭ Skip：${registryDelta.skipped.join(', ')}`;
            await this.notifier.sendToAdmin(notifMsg);

            // journal 寫結構化資料
            this.journal.append({
                action: actionName,
                outcome: this._sentOutcome(sent, 'completed'),
                ...this._sentErrorField(sent),
                outPath,
                perModelResults,
                registryDelta,
            });

            // warm memory synthesis
            try {
                const date      = new Date().toISOString().split('T')[0];
                const synthDir  = path.join(process.cwd(), 'memory', 'synthesis');
                const synthPath = path.join(synthDir, `${date}-model-benchmark-summary.md`);
                fs.mkdirSync(synthDir, { recursive: true });

                const tristreamModels = Object.entries(perModelResults)
                    .filter(([, v]) => v.tristream).map(([k]) => k);

                const activatedList = registryDelta.activated.join(', ') || '（無）';
                const disabledList  = registryDelta.disabled.length
                    ? registryDelta.disabled.map(d => `${d.key}（${d.reason}）`).join('、')
                    : '（無）';
                const skippedList   = registryDelta.skipped.join(', ') || '（無）';

                const tableRows = Object.entries(perModelResults).map(([key, v]) => {
                    const triStr  = v.tristream ? '✅' : '❌';
                    const latency = v.avgLatency > 0 ? `${v.avgLatency}ms` : '-';
                    const status  = registryDelta.skipped.includes(key) ? 'skip'
                                  : registryDelta.activated.includes(key) ? 'active'
                                  : 'disabled';
                    return `| ${key} | ${v.passRate}% | ${triStr} | ${latency} | ${status} |`;
                }).join('\n');

                const synthContent = [
                    `# Model Benchmark 摘要 ${date}`,
                    '',
                    '## 摘要',
                    `本次測試 ${Object.keys(perModelResults).length} 個 model，${tristreamModels.length} 個支援三流格式（${tristreamModels.join(', ') || '無'}）。啟用：${activatedList}；停用：${disabledList}；Skip：${skippedList}。`,
                    '',
                    '## 各 Model 結果',
                    '| model | passRate | tristream | latency | 狀態 |',
                    '| --- | :---: | :---: | :---: | :---: |',
                    tableRows,
                    '',
                    '## Registry 變動',
                    `- 啟用：${activatedList}`,
                    `- 停用：${disabledList}`,
                    `- Skip（保留原狀態）：${skippedList}`,
                ].join('\n');

                fs.writeFileSync(synthPath, synthContent);
                console.log(`[Benchmark] warm memory 已寫入：${synthPath}`);
            } catch (synthErr) {
                console.error('[Benchmark] warm memory 寫入失敗:', synthErr.message);
            }

            return { success: true, action: actionName, outcome: 'completed', detail: summary };
        } catch (e) {
            return this._handleError(actionName, e);
        }
    }
}

module.exports = ModelBenchmarkAction;
