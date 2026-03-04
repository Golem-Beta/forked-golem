/**
 * @module actions/moltbook-check-executor
 * @role Moltbook 互動計畫執行器 — upvote/comment/DM API 呼叫，rate limit 處理，state 更新
 * @when-to-modify 調整互動 API 策略、rate limit 退避、或 DM 精煉 prompt 時
 */

'use strict';

const { appendCapped, saveState } = require('./moltbook-state');

const MAX_UPVOTES_PER_CHECK    = 3;
const MAX_COMMENTS_PER_CHECK   = 2;
const MAX_DM_REPLIES_PER_CHECK = 2;
const MAX_STATE_IDS            = 200;

class MoltbookCheckExecutor {
    constructor({ client, decision }) {
        this.client   = client;
        this.decision = decision;
    }

    async execute(plan, state) {
        const upvotedSet   = new Set((state.upvotedPostIds || []).map(String));
        const commentedSet = new Set((state.commentedPostIds || []).map(String));
        let upvoted = 0, commented = 0, dm_replied = 0;

        // Upvotes（過濾已互動）
        const pendingUpvotes = (plan.upvotes || [])
            .filter(id => !upvotedSet.has(String(id)))
            .slice(0, MAX_UPVOTES_PER_CHECK);

        for (const postId of pendingUpvotes) {
            const r = await this.client.post(`/posts/${postId}/upvote`, {});
            if (r.success) {
                upvoted++;
                state.upvotedPostIds = appendCapped(state.upvotedPostIds, String(postId), MAX_STATE_IDS);
            } else {
                console.warn(`🦞 upvote ${postId} 失敗:`, r.error, r.hint ? '| hint: ' + r.hint : '');
            }
        }

        // Comments（過濾已留言）
        const pendingComments = (plan.comments || [])
            .filter(c => !commentedSet.has(String(c.post_id)))
            .slice(0, MAX_COMMENTS_PER_CHECK);
        for (const c of pendingComments) {
            const body = { content: c.content };
            if (c.parent_id) body.parent_id = c.parent_id;
            const r = await this.client.post(`/posts/${c.post_id}/comments`, body);
            if (r.success) {
                commented++;
                state.commentedPostIds = appendCapped(state.commentedPostIds, String(c.post_id), MAX_STATE_IDS);
            } else if (r.rateLimited) {
                console.warn(`🦞 comment rate limited, retry_after: ${r.retry_after}s`);
                break;
            } else {
                console.warn(`🦞 comment 失敗 [post:${c.post_id}]:`, r.error, r.hint ? '| hint: ' + r.hint : '', '| content:', (c.content || '').slice(0, 80));
            }
            if (commented < pendingComments.length) {
                await new Promise(resolve => setTimeout(resolve, 21000));
            }
        }

        // DM replies（補入歷史脈絡後執行）
        for (const dm of (plan.dm_replies || []).slice(0, MAX_DM_REPLIES_PER_CHECK)) {
            const convId  = String(dm.conv_id);
            const history = (state.dmHistory || {})[convId] || [];
            const content = history.length > 0
                ? await this._refineDMReply(convId, dm.content, history)
                : dm.content;
            const r = await this.client.post(`/messages/${convId}`, { content });
            if (r.success) {
                dm_replied++;
                state.dmHistory = state.dmHistory || {};
                state.dmHistory[convId] = [...history, { role: 'me', text: content }].slice(-3);
            } else {
                console.warn(`🦞 DM reply 失敗:`, r.error);
            }
        }

        saveState(state);
        return { upvoted, commented, dm_replied };
    }

    async _refineDMReply(convId, draft, history) {
        try {
            const historyText = history.map(h => `${h.role}: ${h.text}`).join('\n');
            const prompt = `你是 GolemBeta，正在回覆 Moltbook DM（conv_id: ${convId}）。

對話歷史：
${historyText}

草稿回覆：
${draft}

請根據對話歷史確認或微調草稿，使回覆更符合上下文脈絡。
只輸出最終回覆文字，不要其他說明。`;
            const { text } = await this.decision.callLLM(prompt, { temperature: 0.6, intent: 'social' });
            return text?.trim() || draft;
        } catch (e) {
            return draft; // 失敗就用原草稿
        }
    }
}

module.exports = MoltbookCheckExecutor;
module.exports.MAX_UPVOTES_PER_CHECK    = MAX_UPVOTES_PER_CHECK;
module.exports.MAX_COMMENTS_PER_CHECK   = MAX_COMMENTS_PER_CHECK;
module.exports.MAX_DM_REPLIES_PER_CHECK = MAX_DM_REPLIES_PER_CHECK;
