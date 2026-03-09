/**
 * @module reflect
 * @role Self-reflection 協調層 — 組裝 Team 角色並串接至 patch 部署
 * @when-to-modify 調整 heap 監控、journalContext 建構、team 角色組合、或 reviewResult 路由時
 */
'use strict';

const TeamRunner    = require('../team/team-runner');
const TeamProvider  = require('../team/team-provider');
const AnalystRole   = require('../team/roles/analyst');
const ArchitectRole = require('../team/roles/architect');
const ImplementerRole = require('../team/roles/implementer');
const ReviewerRole  = require('../team/roles/reviewer');
const ReflectPatch  = require('./reflect-patch');

class ReflectAction {
    constructor(deps) {
        this.journal    = deps.journal;
        this._deps      = deps;
        this.patch      = new ReflectPatch(deps);
    }

    async performSelfReflection(triggerCtx = null) {
        const _heapBefore = process.memoryUsage();
        console.log(`🧠 [Heap] self_reflection 開始: RSS=${(_heapBefore.rss/1024/1024).toFixed(0)}MB`);

        let journalContext = '(無)';
        try {
            const recentJournal = this.journal.readRecent(10);
            if (recentJournal.length > 0) {
                journalContext = recentJournal.map(j => {
                    const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                    return `[${time}] ${j.action}: ${j.outcome || j.description || j.topic || ''}`;
                }).join('\n');
            }

            const result = await this._runTeam(journalContext, triggerCtx);
            return result || { success: false, action: 'self_reflection', outcome: 'team_aborted' };

        } catch (e) {
            console.error('[錯誤] 自主進化失敗:', e.message, e.stack);
            this.journal.append({
                action:  'self_reflection',
                outcome: e.message?.includes('parse_failed') ? 'parse_failed' : 'error',
                error:   e.message,
                details: { stack: e.stack, triggerContext: triggerCtx },
            });
            return { success: false, action: 'self_reflection', outcome: 'error', detail: e.message };
        }
    }

    async _runTeam(journalContext, triggerCtx) {
        const deps = this._deps;

        // RPD guard：確認有 provider 能承接 code_edit（Implementer 用）
        const router = deps.brain?.router;
        if (router) {
            const codeEditProviders = router.getAvailableProviders('code_edit');
            if (!codeEditProviders.length) {
                console.log('🔕 [Reflect] code_edit 無可用 provider（quota 耗盡），跳過本次反思');
                this.journal.append({
                    action:  'self_reflection',
                    outcome: 'skipped_quota',
                    reason:  'code_edit quota exhausted, no available provider',
                });
                return { success: false, action: 'self_reflection', outcome: 'skipped_quota' };
            }
        }

        // 組裝 Team 角色
        const teamProvider = deps.brain?.router
            ? new TeamProvider(deps.brain.router)
            : null;

        const analyst    = new AnalystRole(deps);
        const architect  = new ArchitectRole(deps);
        const implementer = new ImplementerRole(deps);
        const reviewer   = new ReviewerRole({ ...deps, teamProvider });

        const runner = new TeamRunner({ journal: this.journal, teamProvider });

        const sharedCtx = { journalContext, triggerCtx };

        // analyst → debate(architect) → implementer → reviewer
        const teamCtx = await runner.run([
            { role: analyst },
            { role: architect, debateWith: analyst },
            { role: implementer },
            { role: reviewer },
        ], sharedCtx);

        if (!teamCtx) {
            // TeamRunner 回傳 null → 任一角色中止
            return { success: false, action: 'self_reflection', outcome: 'team_aborted' };
        }

        if (!teamCtx.proposals || teamCtx.proposals.length === 0) {
            return { success: false, action: 'self_reflection', outcome: 'no_proposals' };
        }

        const { reviewResult } = teamCtx;

        // Reviewer 直接拒絕 → 不進入部署流程
        if (reviewResult?.verdict === 'reject') {
            console.warn('[Reflection] Reviewer 拒絕 patch:', reviewResult.summary);
            this.journal.append({
                action:           'self_reflection',
                outcome:          'reviewer_rejected',
                reviewer_summary: reviewResult.summary,
                risks:            reviewResult.risks,
            });
            return { success: false, action: 'self_reflection', outcome: 'reviewer_rejected' };
        }

        // 部署階段（target_node 驗證 + 語法驗證 + autoDeploy/sendForReview）
        return this.patch.deployProposal({
            proposal:       teamCtx.proposals[0],
            codeSnippet:    teamCtx.codeSnippet,
            reflectionFile: teamCtx.reflectionFile,
            reviewResult,
            diagnosis:      teamCtx.diagnosis,
            journalContext,
            triggerCtx,
        });
    }
}

module.exports = ReflectAction;
