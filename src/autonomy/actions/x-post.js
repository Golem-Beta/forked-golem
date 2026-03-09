/**
 * @module actions/x-post
 * @role X (Twitter) 自主發文行動 — 請 LLM 生成貼文內容後透過 XPublisher 發佈
 * @when-to-modify 調整貼文生成邏輯、prompt 選用、或發文條件時
 */

const fs   = require('fs');
const path = require('path');

const RECENT_POSTS_FILE = path.join(process.cwd(), 'memory', 'x-recent-posts.json');
const MAX_RECENT = 3;

function _loadRecentPosts() {
    try {
        if (fs.existsSync(RECENT_POSTS_FILE)) {
            return JSON.parse(fs.readFileSync(RECENT_POSTS_FILE, 'utf8')) || [];
        }
    } catch {}
    return [];
}

function _saveRecentPost(text) {
    const posts = _loadRecentPosts();
    posts.unshift({ text: text.slice(0, 100), ts: Date.now() });
    if (posts.length > MAX_RECENT) posts.length = MAX_RECENT;
    try { fs.writeFileSync(RECENT_POSTS_FILE, JSON.stringify(posts, null, 2)); } catch {}
}

class XPostAction {
    constructor({ journal, decision, loadPrompt, xPublisher }) {
        this.journal    = journal;
        this.decision   = decision;
        this.loadPrompt = loadPrompt;
        this.xPublisher = xPublisher || null;
    }

    async performXPost() {
        if (!this.xPublisher || !this.xPublisher.isEnabled) {
            console.log('🐦 [XPost] XPublisher 未啟用，跳過');
            this.journal.append({ action: 'x_post', outcome: 'skipped_disabled' });
            return { success: false, outcome: 'skipped_disabled' };
        }

        const soul = this.decision.readSoul();
        const recentJournal = this.journal.readRecent(5)
            .map(j => `[${j.action}] ${j.outcome || j.topic || ''}`)
            .join('\n') || '（無近期行動記錄）';

        const recentPosts = _loadRecentPosts()
            .map(p => `- ${p.text}`)
            .join('\n') || '（無）';

        const prompt = this.loadPrompt('x-post.md', {
            SOUL: soul,
            RECENT_ACTIONS: recentJournal,
            RECENT_POSTS: recentPosts,
            DAILY_COUNT: String(this.xPublisher.getDailyCount()),
        }) || `${soul}\n根據近期行動，寫一篇不超過 280 字元的 X 貼文。只輸出貼文內容。`;

        const { text } = await this.decision.callLLM(prompt, {
            temperature: 0.9,
            intent: 'creative',
        });

        if (!text || text.trim().length === 0) {
            console.warn('🐦 [XPost] LLM 回傳空白，跳過');
            this.journal.append({ action: 'x_post', outcome: 'empty_llm_response' });
            return { success: false, outcome: 'empty_llm_response' };
        }

        // 過濾三流格式（LLM 偶爾帶 tag）
        const { TriStreamParser } = require('../../parsers');
        const parsed = TriStreamParser.parse(text);
        const tweetText = (parsed.hasStructuredTags ? parsed.reply : text).trim();

        if (!tweetText) {
            console.warn('🐦 [XPost] 解析後內容為空，跳過');
            this.journal.append({ action: 'x_post', outcome: 'empty_after_parse' });
            return { success: false, outcome: 'empty_after_parse' };
        }

        const result = await this.xPublisher.post(tweetText);

        this.journal.append({
            action: 'x_post',
            outcome: result.ok ? 'posted' : 'failed',
            tweetId: result.tweetId || null,
            error:   result.error  || null,
            preview: tweetText.substring(0, 100),
            model:   this.decision.lastModel,
            tokens:  this.decision.lastTokens,
        });

        if (result.ok) {
            _saveRecentPost(tweetText);
        }

        return {
            success: result.ok,
            outcome: result.ok ? 'posted' : 'failed',
            tweetId: result.tweetId,
            preview: tweetText.substring(0, 80),
        };
    }
}

module.exports = XPostAction;
