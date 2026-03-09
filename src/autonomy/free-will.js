/**
 * @module free-will
 * @role 自由意志執行器 — 呼叫 makeDecision + action dispatch switch
 * @when-to-modify 新增行動類型、調整行動分派邏輯、或修改 dispatch 後處理時
 *
 * 被 AutonomyManager.manifestFreeWill() 委派呼叫。
 * 依賴由呼叫方（autonomy/index.js）組裝完成後注入。
 */

class FreeWillRunner {
    /**
     * @param {object} deps
     * @param {object} deps.decision       - DecisionEngine
     * @param {object} deps.actions        - ActionRunner
     * @param {object} deps.journal        - JournalManager
     * @param {object} deps.resultHandler  - ResultHandler（統一處理 side effects）
     * @param {Function} deps.getQuietMode - () => boolean（讀取 AutonomyManager.quietMode）
     */
    constructor({ decision, actions, journal, resultHandler, getQuietMode }) {
        this.decision = decision;
        this.actions = actions;
        this.journal = journal;
        this._resultHandler = resultHandler;
        this._getQuietMode = getQuietMode;
    }

    async run() {
        try {
            const _heapBefore = process.memoryUsage();
            console.log(`🧠 [Heap] 醒來: RSS=${(_heapBefore.rss/1024/1024).toFixed(0)}MB, Heap=${(_heapBefore.heapUsed/1024/1024).toFixed(0)}MB/${(_heapBefore.heapTotal/1024/1024).toFixed(0)}MB`);

            let decision;
            try {
                decision = await this.decision.makeDecision();
            } catch (decErr) {
                console.error('❌ [Decision] 決策引擎異常:', decErr.message || decErr);
                this.journal.append({
                    action: 'decision_error',
                    outcome: 'engine_exception',
                    error: decErr.message,
                    stack: decErr.stack?.split('\n').slice(0, 3).join(' | '),
                    note: 'makeDecision() 拋出例外，fallback 到 rest'
                });
                decision = { action: 'rest', reason: 'fallback: 決策引擎異常，強制休息' };
            }

            if (!decision) {
                console.warn('😴 [Decision] 決策失敗 → 強制 rest');
                decision = { action: 'rest', reason: 'fallback: 決策失敗，強制休息保護配額' };
            }

            if (decision.action !== 'rest') {
                console.log('⏳ [Autonomy] 決策完成，等待 5 秒後執行行動...');
                await new Promise(r => setTimeout(r, 5000));
            }

            const actionEmoji = {
                'self_reflection': '🧬', 'github_explore': '🔍',
                'spontaneous_chat': '💬', 'web_research': '🌐', 'model_benchmark': '🔬',
                'digest': '📝', 'health_check': '🏥', 'rest': '😴',
                'gmail_check': '📬', 'drive_sync': '💾', 'x_post': '🐦', 'moltbook_check': '🦞', 'moltbook_post': '🦞', 'threads_post': '🧵',
                'threads_check': '🧵', 'x_check': '🐦',
            };
            console.log((actionEmoji[decision.action] || '❓') + ' Golem 決定: ' + decision.action + ' — ' + decision.reason);

            let _actionResult = null;
            switch (decision.action) {
                case 'self_reflection':
                    _actionResult = await this.actions.performSelfReflection();
                    break;
                case 'github_explore':
                    _actionResult = await this.actions.performGitHubExplore();
                    break;
                case 'spontaneous_chat':
                    if (this._getQuietMode()) {
                        console.log('🌙 [Autonomy] 靜音時段，跳過社交 → 改做 GitHub 探索');
                        this.journal.append({ action: 'spontaneous_chat', outcome: 'skipped_quiet_mode' });
                        _actionResult = await this.actions.performGitHubExplore();
                    } else {
                        _actionResult = await this.actions.performSpontaneousChat();
                    }
                    break;
                case 'web_research':
                    _actionResult = await this.actions.performWebResearch(decision.reason);
                    break;
                case 'model_benchmark':
                    _actionResult = await this.actions.performModelBenchmark();
                    break;
                case 'morning_digest':
                    _actionResult = await this.actions.performMorningDigest();
                    break;
                case 'digest':
                    _actionResult = await this.actions.performDigest();
                    break;
                case 'health_check':
                    _actionResult = await this.actions.performHealthCheck();
                    break;
                case 'gmail_check':
                    _actionResult = await this.actions.performGoogleCheck();
                    break;
                case 'drive_sync':
                    _actionResult = await this.actions.performDriveSync();
                    break;
                case 'x_post':
                    _actionResult = await this.actions.performXPost();
                    break;
                case 'threads_check':
                    _actionResult = await this.actions.performThreadsCheck();
                    break;
                case 'x_check':
                    _actionResult = await this.actions.performXCheck();
                    break;
                case 'moltbook_check':
                    _actionResult = await this.actions.performMoltbookCheck();
                    break;
                case 'threads_post':
                    _actionResult = await this.actions.performThreadsPost();
                    break;
                case 'moltbook_post':
                    _actionResult = await this.actions.performMoltbookPost();
                    break;
                case 'rest':
                    console.log('😴 [Autonomy] Golem 選擇繼續休息。');
                    this.journal.append({
                        action: 'rest',
                        reason: decision.reason,
                        outcome: '選擇不行動，繼續休息'
                    });
                    break;
                default:
                    // maintenance actions 自動路由
                    if (this.actions.hasMaintenance(decision.action)) {
                        _actionResult = await this.actions.performMaintenance(decision.action);
                    } else {
                        console.warn('⚠️ [Autonomy] 未知行動:', decision.action);
                    }
            }
            try {
                if (_actionResult) await this._resultHandler.handle(_actionResult);
            } catch (actErr) {
                console.error('❌ [Action] 行動執行或結果處理失敗:', actErr.message || actErr);
                this.journal.append({
                    action: decision.action,
                    outcome: 'action_failed',
                    error: actErr.message,
                    stack: actErr.stack?.split('\n').slice(0, 3).join(' | '),
                    note: 'switch/resultHandler 執行時拋出例外'
                });
            }
        } catch (e) {
            console.error('[錯誤] 自由意志執行失敗:', e.message || e);
            this.journal.append({
                action: 'free_will_error',
                outcome: 'uncaught_exception',
                error: e.message,
                stack: e.stack?.split('\n').slice(0, 3).join(' | '),
                note: 'run() 外層 catch，表示 heap log 或前置流程失敗'
            });
        }
    }
}

module.exports = FreeWillRunner;
