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
     * @param {object} deps.decision  - DecisionEngine
     * @param {object} deps.actions   - ActionRunner
     * @param {object} deps.journal   - JournalManager
     * @param {object} deps.failureTracker - FailureTracker
     * @param {Function} deps.getQuietMode - () => boolean（讀取 AutonomyManager.quietMode）
     */
    constructor({ decision, actions, journal, failureTracker, getQuietMode }) {
        this.decision = decision;
        this.actions = actions;
        this.journal = journal;
        this._failureTracker = failureTracker;
        this._getQuietMode = getQuietMode;
    }

    async run() {
        try {
            const _heapBefore = process.memoryUsage();
            console.log(`🧠 [Heap] 醒來: RSS=${(_heapBefore.rss/1024/1024).toFixed(0)}MB, Heap=${(_heapBefore.heapUsed/1024/1024).toFixed(0)}MB/${(_heapBefore.heapTotal/1024/1024).toFixed(0)}MB`);

            let decision = await this.decision.makeDecision();

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
                'spontaneous_chat': '💬', 'web_research': '🌐',
                'digest': '📝', 'health_check': '🏥', 'rest': '😴',
                'gmail_check': '📬', 'drive_sync': '💾', 'x_post': '🐦', 'moltbook_check': '🦞', 'moltbook_post': '🦞',
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
                case 'morning_digest':
                    _actionResult = await this.actions.performMorningDigest();
                    break;
                case 'digest':
                    _actionResult = await this.actions.performDigest();
                    break;
                case 'health_check':
                    _actionResult = await this.actions.performHealthCheck();
                    if (_actionResult && _actionResult.needsReflection) {
                        console.log('🏥 [HealthCheck] 發現異常，排程觸發 self_reflection');
                        const needsReflection = _actionResult.needsReflection;
                        setTimeout(() => this.actions.performSelfReflection({ trigger: 'health_check', ...needsReflection }), 5 * 60 * 1000);
                    }
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
                case 'moltbook_check':
                    _actionResult = await this.actions.performMoltbookCheck();
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
            if (_actionResult) await this._failureTracker.record(_actionResult);
        } catch (e) {
            console.error('[錯誤] 自由意志執行失敗:', e.message || e);
            this.journal.append({ action: 'error', error: e.message });
        }
    }
}

module.exports = FreeWillRunner;
