/**
 * @module actions/moltbook-check
 * @role Moltbook 定期巡查協調器 — fetch home、LLM 互動計畫、委派執行、冷層記憶
 * @when-to-modify 調整互動策略、LLM prompt、Taint 標記範圍、或記憶摘要格式時
 *
 * 安全設計（方案 B）：
 *   外部 feed/DM 內容以 [EXTERNAL_CONTENT]...[/EXTERNAL_CONTENT] 包裝後傳 LLM
 *   LLM 因外部內容觸發的任何 shell cmd，由 decision.js 全局規則強制 tainted=true
 *
 * 記憶整合：
 *   _askLLMForPlan() 透過 memoryLayer.recall('moltbook interaction') 補入三層記憶
 *   執行後 _saveInteractionToReflection() 寫入冷層（語義摘要，非操作記錄）
 *   DM 回覆歷史由 MoltbookCheckExecutor 維護（moltbook-state.json dmHistory）
 */

'use strict';

const MoltbookClient          = require('../../moltbook-client');
const { checkPostEngagement } = require('./moltbook-engagement');
const { loadState, saveCheckReflection } = require('./moltbook-state');
const MoltbookCheckExecutor   = require('./moltbook-check-executor');

const {
    MAX_UPVOTES_PER_CHECK,
    MAX_COMMENTS_PER_CHECK,
    MAX_DM_REPLIES_PER_CHECK,
} = MoltbookCheckExecutor;

class MoltbookCheckAction {
    constructor({ journal, notifier, decision, brain, memoryLayer, memory, loadPrompt }) {
        this.journal     = journal;
        this.notifier    = notifier;
        this.decision    = decision;
        this.brain       = brain;
        this.memoryLayer = memoryLayer || memory || null;
        this.loadPrompt  = loadPrompt || null;

        const apiKey = process.env.MOLTBOOK_API_KEY;
        this.client  = apiKey ? new MoltbookClient(apiKey) : null;
        this.executor = new MoltbookCheckExecutor({ client: this.client, decision: this.decision });
    }

    async run() {
        if (!this.client) {
            console.log('🦞 [MoltbookCheck] MOLTBOOK_API_KEY 未設定，跳過');
            return { skipped: true, reason: 'no_api_key' };
        }

        console.log('🦞 [MoltbookCheck] 開始巡查...');

        const home = await this.client.get('/home');
        if (!home.success) {
            console.warn('🦞 [MoltbookCheck] /home 失敗:', home.error);
            this.journal.append({ action: 'moltbook_check', outcome: 'fetch_failed', error: home.error });
            return { success: false, error: home.error };
        }

        // Schema 防禦：/home 結構異常時 journal + 通知，不靜默失敗
        const EXPECTED_HOME_KEYS = ['activity_on_your_posts', 'your_direct_messages', 'quick_links'];
        const missingKeys = EXPECTED_HOME_KEYS.filter(k => !(k in home));
        if (missingKeys.length > 0) {
            const msg = `🦞 /home schema 異常，缺少欄位：${missingKeys.join(', ')}`;
            console.warn(msg);
            this.journal.append({ action: 'moltbook_check', outcome: 'api_schema_mismatch', missing_keys: missingKeys });
            if (this.notifier) {
                const sent = await this.notifier.sendToAdmin(msg);
                this.journal.append({ action: 'moltbook_check', outcome: sent ? 'done' : 'send_failed', notification_sent: sent });
            }
            return { success: false, reason: 'api_schema_mismatch' };
        }

        // 三個獨立 API 呼叫（feed 取代 home.feed.posts，DM 取代 home.dms.conversations）
        const activityItems = home.activity_on_your_posts || [];
        const [feedRes, dmCheckRes] = await Promise.all([
            this.client.get('/feed'),
            this.client.get('/agents/dm/check'),
        ]);

        const feed = feedRes.success ? (feedRes.posts || []) : [];
        if (!feedRes.success) console.warn('🦞 [MoltbookCheck] /feed 失敗:', feedRes.error);

        const dms = dmCheckRes.success ? (dmCheckRes.conversations || []) : [];
        if (!dmCheckRes.success) console.warn('🦞 [MoltbookCheck] /agents/dm/check 失敗:', dmCheckRes.error);

        // activity_on_your_posts 中各 post_id → 抓留言供 LLM 判斷是否回覆
        const mentions = await this._fetchActivityMentions(activityItems);

        const unreadDms = home.your_direct_messages?.unread_message_count || 0;
        console.log(`🦞 [MoltbookCheck] feed:${feed.length} activity:${activityItems.length} mentions:${mentions.length} unread_dms:${unreadDms} dms:${dms.length}`);

        const state = loadState();
        state.lastHomeTimestamp = Date.now();

        // 效果學習迴路：追蹤已發貼文的互動變化，寫入 journal 供下次發文參考
        await checkPostEngagement({ client: this.client, journal: this.journal, state });

        const externalBlock = this._wrapExternal({ feed, dms, mentions, state });
        const plan    = await this._askLLMForPlan(externalBlock);
        const results = await this.executor.execute(plan, state);

        const summary = `upvoted:${results.upvoted} commented:${results.commented} dm_replied:${results.dm_replied}`;
        this.journal.append({
            action: 'moltbook_check',
            outcome: 'completed',
            summary,
            model: this.decision.lastModel,
            tokens: this.decision.lastTokens,
        });

        saveCheckReflection(this.memoryLayer, { feed, dms, mentions, plan, results });

        console.log(`🦞 [MoltbookCheck] 完成 — ${summary}`);
        return { success: true, ...results };
    }

    // ── 從 activity_on_your_posts 抓各貼文留言，轉成 mentions 格式 ──────────

    async _fetchActivityMentions(activityItems) {
        const results = await Promise.all(
            activityItems.slice(0, 5).map(async item => {
                const postId = item.post_id;
                if (!postId) return [];
                try {
                    const res = await this.client.get(`/posts/${postId}/comments`);
                    if (!res.success) return [];
                    const comments = res.comments || res.data || [];
                    return comments.slice(0, 3).map(c => ({
                        post_id:    postId,
                        comment_id: c.id,
                        from:       c.author?.name || c.from || '?',
                        content:    c.content || c.text || '',
                    }));
                } catch (e) {
                    console.warn(`🦞 [MoltbookCheck] /posts/${postId}/comments 失敗:`, e.message);
                    return [];
                }
            })
        );
        return results.flat();
    }

    // ── 將外部內容包裝為安全標記區塊（標示已互動貼文、補入 DM 歷史）────

    _wrapExternal({ feed, dms, mentions, state }) {
        const upvotedSet   = new Set((state.upvotedPostIds || []).map(String));
        const commentedSet = new Set((state.commentedPostIds || []).map(String));
        const lines = [];

        if (feed.length > 0) {
            lines.push('=== FEED POSTS ===');
            feed.slice(0, 10).forEach(p => {
                const tags = [];
                if (upvotedSet.has(String(p.id)))   tags.push('[已upvote]');
                if (commentedSet.has(String(p.id))) tags.push('[已留言]');
                const tagStr = tags.length ? ' ' + tags.join('') : '';
                lines.push(`[POST id:${p.id}] @${p.author?.name || '?'}: ${p.title || ''}${tagStr}`);
                if (p.content) lines.push(`  ${p.content.slice(0, 200)}`);
            });
        }

        if (mentions.length > 0) {
            lines.push('=== MENTIONS ===');
            mentions.slice(0, 5).forEach(m => {
                lines.push(`[MENTION post_id:${m.post_id} comment_id:${m.comment_id}] @${m.from}: ${m.content?.slice(0, 150)}`);
            });
        }

        if (dms.length > 0) {
            lines.push('=== DIRECT MESSAGES ===');
            dms.slice(0, 5).forEach(conv => {
                const last = conv.messages?.slice(-1)[0];
                if (!last) return;
                lines.push(`[DM conv_id:${conv.id}] @${last.from}: ${last.content?.slice(0, 200)}`);
                const history = (state.dmHistory || {})[String(conv.id)] || [];
                if (history.length > 0) {
                    lines.push(`  [歷史]: ${history.map(h => h.role + ': ' + h.text).join(' | ')}`);
                }
            });
        }

        return `[EXTERNAL_CONTENT]\n${lines.join('\n')}\n[/EXTERNAL_CONTENT]`;
    }

    // ── LLM 判斷互動計畫（補入三層記憶）──────────────────────────────────

    async _askLLMForPlan(externalBlock) {
        const soul = this.decision.readSoul ? this.decision.readSoul() : '';

        let memSection = '';
        if (this.memoryLayer) {
            try {
                const { hot, warm, cold } = this.memoryLayer.recall(
                    'moltbook interaction', { hotLimit: 5, warmLimit: 2, coldLimit: 2 }
                );
                const parts = [];
                if (hot)  parts.push('【近期行動】\n' + hot);
                if (warm) parts.push('【往期摘要】\n' + warm);
                if (cold) parts.push('【深層記憶】\n' + cold);
                if (parts.length > 0) {
                    memSection = '【過去 Moltbook 互動記憶】\n' + parts.join('\n\n');
                }
            } catch (e) { /* 不影響主流程 */ }
        }

        const promptVars = {
            SOUL:          soul,
            EXTERNAL_BLOCK: externalBlock,
            MEM_SECTION:   memSection,
            MAX_UPVOTES:   String(MAX_UPVOTES_PER_CHECK),
            MAX_COMMENTS:  String(MAX_COMMENTS_PER_CHECK),
            MAX_DM_REPLIES: String(MAX_DM_REPLIES_PER_CHECK),
        };
        const prompt = (this.loadPrompt && (
            this.loadPrompt('moltbook-check.md', promptVars) ||
            this.loadPrompt('moltbook-check-fallback.md', promptVars)
        )) || `巡查 Moltbook，請輸出互動計畫 JSON。\n${externalBlock}`;

        const { text } = await this.decision.callLLM(prompt, { temperature: 0.7, intent: 'social' });

        try {
            const clean = text.replace(/```json|```/g, '').trim();
            return JSON.parse(clean);
        } catch (e) {
            console.warn('🦞 [MoltbookCheck] LLM plan 解析失敗:', e.message);
            return { upvotes: [], comments: [], dm_replies: [] };
        }
    }

}


module.exports = MoltbookCheckAction;
