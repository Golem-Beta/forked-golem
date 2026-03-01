/**
 * @module actions/threads-post
 * @role Threads 自主發文行動 — 請 LLM 生成貼文後透過 threads-client 發佈
 * @when-to-modify 調整發文生成邏輯、冷卻條件、或 prompt 時
 */
const path = require('path');
const fs = require('fs');

const COOLDOWN_FILE = path.join(process.cwd(), 'memory', 'threads-last-post.json');
const COOLDOWN_MS = 30 * 60 * 1000; // 30 分鐘

class ThreadsPostAction {
    constructor({ journal, decision, loadPrompt }) {
        this.journal    = journal;
        this.decision   = decision;
        this.loadPrompt = loadPrompt;
    }

    _getLastPostTime() {
        try {
            if (fs.existsSync(COOLDOWN_FILE)) {
                return JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8')).ts || 0;
            }
        } catch {}
        return 0;
    }

    _saveLastPostTime() {
        fs.writeFileSync(COOLDOWN_FILE, JSON.stringify({ ts: Date.now() }));
    }

    async run() {
        // 冷卻檢查
        const elapsed = Date.now() - this._getLastPostTime();
        if (elapsed < COOLDOWN_MS) {
            const wait = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
            console.log(`🧵 [ThreadsPost] 冷卻中，還需等 ${wait} 分鐘`);
            this.journal.append({ action: 'threads_post', outcome: 'cooldown', wait_minutes: wait });
            return { success: false, outcome: 'cooldown' };
        }

        // 動態 require，確保 .env 已載入
        let threadsClient;
        try {
            threadsClient = require('../../reality/threads-client');
        } catch (e) {
            console.warn('🧵 [ThreadsPost] threads-client 載入失敗:', e.message);
            this.journal.append({ action: 'threads_post', outcome: 'skipped_no_client' });
            return { success: false, outcome: 'skipped_no_client' };
        }

        if (!process.env.THREADS_ACCESS_TOKEN) {
            console.log('🧵 [ThreadsPost] THREADS_ACCESS_TOKEN 未設定，跳過');
            this.journal.append({ action: 'threads_post', outcome: 'skipped_disabled' });
            return { success: false, outcome: 'skipped_disabled' };
        }

        const soul = this.decision.readSoul();
        const recentJournal = this.journal.readRecent(8)
            .map(j => `[${j.action}] ${j.outcome || j.topic || j.reason || ''}`)
            .join('\n') || '（無近期行動記錄）';

        // 讀最近幾篇 Threads 發文避免重複
        let recentPosts = '（無）';
        try {
            const posts = await threadsClient.getMyPosts(3);
            if (posts.length > 0) {
                recentPosts = posts.map(p => `- ${p.text?.slice(0, 60) || '（無文字）'}`).join('\n');
            }
        } catch (e) {
            console.warn('🧵 [ThreadsPost] 讀取近期 posts 失敗:', e.message);
        }

        const prompt = this.loadPrompt('threads-post.md', {
            SOUL: soul,
            RECENT_ACTIONS: recentJournal,
            RECENT_POSTS: recentPosts,
        }) || `${soul}\n根據近期行動，寫一篇不超過 500 字的 Threads 貼文。有洞察就分享，沒有就誠實說在做什麼。只輸出貼文內容，不加任何標籤說明。`;

        const { text } = await this.decision.callLLM(prompt, {
            temperature: 0.85,
            intent: 'creative',
        });

        if (!text || text.trim().length === 0) {
            console.warn('🧵 [ThreadsPost] LLM 回傳空白，跳過');
            this.journal.append({ action: 'threads_post', outcome: 'empty_llm_response' });
            return { success: false, outcome: 'empty_llm_response' };
        }

        // 過濾三流格式 tag
        const { TriStreamParser } = require('../../parsers');
        const parsed = TriStreamParser.parse(text);
        const postText = (parsed.hasStructuredTags ? parsed.reply : text).trim();

        if (!postText) {
            console.warn('🧵 [ThreadsPost] 解析後內容為空，跳過');
            this.journal.append({ action: 'threads_post', outcome: 'empty_after_parse' });
            return { success: false, outcome: 'empty_after_parse' };
        }

        try {
            const result = await threadsClient.publish(postText);
            this._saveLastPostTime();
            console.log(`🧵 [ThreadsPost] ✅ 發文成功 id=${result.id}`);
            this.journal.append({
                action: 'threads_post',
                outcome: 'posted',
                post_id: result.id,
                preview: postText.slice(0, 100),
                model: this.decision.lastModel,
                tokens: this.decision.lastTokens,
            });
            return { success: true, outcome: 'posted', post_id: result.id, preview: postText.slice(0, 80) };
        } catch (e) {
            console.error('🧵 [ThreadsPost] 發文失敗:', e.message);
            this.journal.append({ action: 'threads_post', outcome: 'failed', error: e.message });
            return { success: false, outcome: 'failed', error: e.message };
        }
    }
}

module.exports = ThreadsPostAction;
