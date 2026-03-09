'use strict';
/**
 * @module team/team-runner
 * @role 串行執行角色定義陣列，協調角色間的 context 傳遞；不含任何角色邏輯
 * @when-to-modify 調整 error handling、context 合併策略、或辯論觸發條件時
 */

const Debate = require('./debate');

// 角色間 inter-call delay：避免連續 LLM 呼叫觸發 rate limit
const INTER_ROLE_DELAY_MS = 1500;
const _sleep = ms => new Promise(res => setTimeout(res, ms));

class TeamRunner {
    /**
     * @param {object} deps
     * @param {object} deps.journal      - JournalManager
     * @param {object} deps.teamProvider - TeamProvider
     */
    constructor({ journal, teamProvider }) {
        this.journal      = journal;
        this.teamProvider = teamProvider;
        this._debate      = new Debate({ journal, interCallDelayMs: INTER_ROLE_DELAY_MS });
    }

    /**
     * 串行執行角色定義陣列
     *
     * @param {Array<{ role: object, debateWith?: object }>} roleDefs
     *   - role:      角色實例（必有 run() 方法）
     *   - debateWith: 若設定，則此角色與 debateWith 角色執行辯論流程
     * @param {object} [sharedCtx={}] - 初始共享 context
     * @returns {Promise<object|null>} 合併後的 context；任一角色回傳 null 則整體回傳 null
     */
    async run(roleDefs, sharedCtx = {}) {
        let ctx = { ...sharedCtx };

        for (let i = 0; i < roleDefs.length; i++) {
            const def = roleDefs[i];
            const roleName = def.role?.constructor?.name || 'unknown';

            if (i > 0) await _sleep(INTER_ROLE_DELAY_MS);

            let result;
            try {
                if (def.debateWith) {
                    result = await this._debate.run(def.role, def.debateWith, ctx);
                } else {
                    result = await def.role.run(ctx);
                }
            } catch (e) {
                console.error(`[TeamRunner] ${roleName} 執行失敗:`, e.message);
                this.journal.append({
                    action:  'team_runner',
                    role:    roleName,
                    outcome: 'error',
                    error:   e.message,
                });
                return null;
            }

            if (result === null || result === undefined) {
                console.warn(`[TeamRunner] ${roleName} 回傳 null，中止執行`);
                if (roleName === 'ImplementerRole' && ctx.analystOutput?.suggestion === 'whole_file_add') {
                    this.journal.append({ action: 'team_runner', outcome: 'needs_human', reason: 'whole_file_add suggested by analyst' });
                }
                return null;
            }

            // 結構化錯誤：target_file_invalid → 回退到 Architect 重試（最多 1 次）
            if (result._error === 'target_file_invalid' && !ctx._retried) {
                const feedback = `上一次你選擇的 target_file「${result._invalidTarget}」不存在於系統中。請重新從上方檔案清單中選擇一個真實存在的路徑。`;
                console.warn(`[TeamRunner] target_file 無效，feedback 給 Architect 重試`);
                this.journal.append({ action: 'team_runner', outcome: 'retry_architect', reason: feedback });

                // 找到 Architect 的 index，從那裡重跑
                const archIdx = roleDefs.findIndex(d => d.role?.constructor?.name === 'ArchitectRole');
                if (archIdx >= 0) {
                    ctx = { ...ctx, _retried: true, _architectFeedback: feedback };
                    i = archIdx - 1; // for loop 會 +1，所以 -1
                    continue;
                }
                return null;
            }

            // 重試後仍然失敗（_retried=true），中止，不繼續讓 Reviewer 拿空 proposals
            if (result._error && ctx._retried) {
                console.warn(`[TeamRunner] 重試後仍然失敗 (${result._error})，中止執行`);
                this.journal.append({ action: 'team_runner', outcome: 'retry_failed', error: result._error });
                return null;
            }

            ctx = { ...ctx, ...result };
        }

        return ctx;
    }
}

module.exports = TeamRunner;
