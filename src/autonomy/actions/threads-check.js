/**
 * @module actions/threads-check
 * @role Threads 回覆巡查 — 讀取自己貼文的回覆，LLM 決定是否回應，執行回覆
 * @when-to-modify 調整回覆策略、LLM prompt、或互動上限時
 */
'use strict';

const CONFIG = require('../../config');

const MAX_REPLIES_PER_CHECK = 3;

class ThreadsCheckAction {
    constructor({ journal, decision, loadPrompt }) {
        this.journal    = journal;
        this.decision   = decision;
        this.loadPrompt = loadPrompt;
    }

    async run() {
        if (!process.env.THREADS_ACCESS_TOKEN) {
            console.log('🧵 [ThreadsCheck] THREADS_ACCESS_TOKEN 未設定，跳過');
            return { skipped: true, reason: 'no_token' };
        }

        let threadsClient;
        try {
            threadsClient = require('../../reality/threads-client');
        } catch (e) {
            console.warn('🧵 [ThreadsCheck] threads-client 載入失敗:', e.message);
            return { skipped: true, reason: 'no_client' };
        }

        console.log('🧵 [ThreadsCheck] 開始巡查回覆...');

        // 取得近期貼文（含 reply_count）
        let myPosts = [];
        try {
            myPosts = await threadsClient.getMyPosts(5);
        } catch (e) {
            console.warn('🧵 [ThreadsCheck] getMyPosts 失敗:', e.message);
            this.journal.append({ action: 'threads_check', outcome: 'fetch_failed', error: e.message });
            return { success: false, error: e.message };
        }

        // 篩選有回覆的貼文
        const postsWithReplies = myPosts.filter(p => (p.reply_count || 0) > 0).slice(0, 3);
        if (postsWithReplies.length === 0) {
            console.log('🧵 [ThreadsCheck] 無貼文有回覆，結束');
            this.journal.append({ action: 'threads_check', outcome: 'no_replies' });
            return { success: true, outcome: 'no_replies', observe: null };
        }

        // 抓各貼文的回覆
        const repliesCtx = [];
        for (const post of postsWithReplies) {
            try {
                const replies = await threadsClient.getReplies(post.id, 3);
                repliesCtx.push({ post, replies });
            } catch (e) {
                console.warn(`🧵 [ThreadsCheck] getReplies(${post.id}) 失敗:`, e.message);
            }
        }

        if (repliesCtx.length === 0) {
            this.journal.append({ action: 'threads_check', outcome: 'fetch_replies_failed' });
            return { success: false, outcome: 'fetch_replies_failed' };
        }

        // 組裝外部內容區塊給 LLM
        const externalLines = [];
        for (const { post, replies } of repliesCtx) {
            externalLines.push(`[POST id:${post.id}] ${post.text?.slice(0, 100) || ''}`);
            for (const r of replies) {
                externalLines.push(`  [REPLY id:${r.id} from:@${r.username || '?'}] ${r.text?.slice(0, 150) || ''}`);
            }
        }
        const externalBlock = `[EXTERNAL_CONTENT]\n${externalLines.join('\n')}\n[/EXTERNAL_CONTENT]`;

        const soul = this.decision.readSoul ? this.decision.readSoul() : '';
        const prompt = (this.loadPrompt && this.loadPrompt('threads-check.md', {
            SOUL: soul,
            EXTERNAL_BLOCK: externalBlock,
            MAX_REPLIES: String(MAX_REPLIES_PER_CHECK),
        })) || `你是 GolemBeta。以下是你 Threads 貼文收到的回覆：\n${externalBlock}\n\n分析這些回覆，輸出 JSON：{"replies": [{"post_id": "...", "text": "..."}]}\n最多 ${MAX_REPLIES_PER_CHECK} 則回覆，沒有值得回應的就輸出空陣列。只輸出 JSON。`;

        const { text } = await this.decision.callLLM(prompt, { temperature: 0.7, intent: 'social' });

        let plan = { replies: [] };
        try {
            const clean = text.replace(/```json|```/g, '').trim();
            plan = JSON.parse(clean);
        } catch (e) {
            console.warn('🧵 [ThreadsCheck] LLM plan 解析失敗:', e.message);
        }

        // 執行回覆
        let replied = 0;
        for (const r of (plan.replies || []).slice(0, MAX_REPLIES_PER_CHECK)) {
            if (!r.post_id || !r.text) continue;
            try {
                await threadsClient.replyToPost(r.post_id, r.text);
                replied++;
                console.log(`🧵 [ThreadsCheck] 回覆 post ${r.post_id} 成功`);
            } catch (e) {
                console.warn(`🧵 [ThreadsCheck] 回覆失敗:`, e.message);
            }
        }

        const observe = replied > 0
            ? `[Threads 互動] 今日回覆了 ${replied} 則 Threads 留言。`
            : `[Threads 互動] 巡查了 ${postsWithReplies.length} 篇有回覆的貼文，本次無適合回應的內容。`;

        this.journal.append({
            action: 'threads_check',
            outcome: 'completed',
            posts_checked: postsWithReplies.length,
            replied,
            model: this.decision.lastModel,
        });

        console.log(`🧵 [ThreadsCheck] 完成 — replied:${replied}`);
        return { success: true, replied, observe };
    }
}

module.exports = ThreadsCheckAction;
