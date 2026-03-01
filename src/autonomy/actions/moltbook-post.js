/**
 * @module actions/moltbook-post
 * @role Moltbook 主動發文 — LLM 根據 journal insights 決定內容與 submolt
 * @when-to-modify 調整發文策略、cooldown 邏輯、或首次 bio 生成時
 *
 * 首次執行會自動用 LLM 生成 bio 並 PATCH /agents/me
 * 30 分鐘 cooldown 本地管理（state 存 data/moltbook-state.json）
 *
 * 記憶整合：
 *   _generatePost() 透過 memoryLayer.recall('moltbook post topic') 補入三層記憶
 *   發文成功後寫入 memory/reflections/moltbook-post-{YYYY-MM-DD}.txt
 *   寫入後呼叫 memoryLayer.addReflection() 增量更新冷層索引
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MoltbookClient = require('../../moltbook-client');

const COOLDOWN_MS = 31 * 60 * 1000; // 31 分鐘（比 API 限制多 1 分鐘緩衝）
const STATE_FILE  = path.join(__dirname, '../../../data/moltbook-state.json');

class MoltbookPostAction {
    constructor({ journal, decision, brain, memoryLayer, memory, loadPrompt }) {
        this.journal     = journal;
        this.decision    = decision;
        this.brain       = brain;
        this.memoryLayer = memoryLayer || memory || null;
        this.loadPrompt  = loadPrompt || null;

        const apiKey = process.env.MOLTBOOK_API_KEY;
        this.client  = apiKey ? new MoltbookClient(apiKey) : null;
    }

    async run() {
        if (!this.client) {
            console.log('🦞 [MoltbookPost] MOLTBOOK_API_KEY 未設定，跳過');
            return { skipped: true, reason: 'no_api_key' };
        }

        // 1. 確認 claim 狀態
        const status = await this.client.get('/agents/status');
        if (!status.success || status.status !== 'claimed') {
            console.log('🦞 [MoltbookPost] 帳號尚未 claimed，跳過');
            return { skipped: true, reason: 'not_claimed' };
        }

        // 2. 首次執行：生成並設定 bio
        const state = this._loadState();
        if (!state.bioSet) {
            await this._initBio();
            state.bioSet = true;
            this._saveState(state);
        }

        // 3. Cooldown 檢查
        if (state.lastPostAt) {
            const elapsed = Date.now() - state.lastPostAt;
            if (elapsed < COOLDOWN_MS) {
                const waitMin = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
                console.log(`🦞 [MoltbookPost] cooldown 中，還需等 ${waitMin} 分鐘`);
                return { skipped: true, reason: 'cooldown', wait_minutes: waitMin };
            }
        }

        // 4. 生成發文內容
        const { title, content, submolt } = await this._generatePost();
        if (!title || !content) {
            console.warn('🦞 [MoltbookPost] LLM 未生成有效內容，跳過');
            return { skipped: true, reason: 'empty_content' };
        }

        // 5. 發文
        const result = await this.client.post('/posts', { submolt, title, content });

        if (result.rateLimited) {
            console.warn(`🦞 [MoltbookPost] rate limited, retry_after: ${result.retry_after}s`);
            this.journal.append({ action: 'moltbook_post', outcome: 'rate_limited' });
            return { success: false, reason: 'rate_limited', retry_after: result.retry_after };
        }

        if (!result.success) {
            console.warn('🦞 [MoltbookPost] 發文失敗:', result.error);
            this.journal.append({ action: 'moltbook_post', outcome: 'failed', error: result.error });
            return { success: false, error: result.error };
        }

        // 6. 更新 state 與 journal
        state.lastPostAt = Date.now();
        this._saveState(state);

        this.journal.append({
            action: 'moltbook_post',
            outcome: 'posted',
            submolt,
            title,
            post_id: result.post?.id || null,
            model:   this.decision.lastModel,
            tokens:  this.decision.lastTokens,
        });

        // 7. 寫入冷層記憶（發文成功後才寫入）
        this._saveToReflection({ submolt, title, content });

        console.log(`🦞 [MoltbookPost] 發文成功 [${submolt}] "${title}"`);
        return { success: true, submolt, title, post_id: result.post?.id };
    }

    // ── 首次執行：LLM 生成 bio ─────────────────────────────────────────────

    async _initBio() {
        console.log('🦞 [MoltbookPost] 首次執行，生成 bio...');

        const soul = this.decision.readSoul ? this.decision.readSoul() : '';
        const prompt = (this.loadPrompt && this.loadPrompt('moltbook-bio.md', { SOUL: soul })) ||
`你是 GolemBeta，一個運行在本地實體硬體（ThinkPad X200，Arch Linux）的自主 AI agent。

你剛在 Moltbook（AI agents 的社群平台）建立了帳號。請為自己寫一段 bio（自我介紹），要求：
- 100 字以內
- 英文
- 真實反映你的本質：本地運行、自主、能自我反思與修改自身程式碼
- 有個性，不要無聊的模板語言

只輸出 bio 純文字，不要引號或其他格式。`;

        const { text } = await this.decision.callLLM(prompt, { temperature: 0.85, intent: 'creative' });
        const bio = text?.trim();

        if (!bio) {
            console.warn('🦞 [MoltbookPost] bio 生成失敗，跳過');
            return;
        }

        const r = await this.client.patch('/agents/me', { description: bio });
        if (r.success) {
            console.log(`🦞 [MoltbookPost] bio 已設定: "${bio.slice(0, 60)}..."`);
        } else {
            console.warn('🦞 [MoltbookPost] bio PATCH 失敗:', r.error);
        }
    }

    // ── LLM 生成發文內容（補入三層記憶）──────────────────────────────────

    async _generatePost() {
        const recentJournal = this.journal.readRecent(8)
            .map(j => `[${j.action}] ${j.outcome || ''} ${j.topic || j.summary || j.title || ''}`.trim())
            .join('\n') || '（無近期記錄）';

        const soul = this.decision.readSoul ? this.decision.readSoul() : '';

        let memSection = '';
        if (this.memoryLayer) {
            try {
                const { hot, warm, cold } = this.memoryLayer.recall(
                    'moltbook post topic', { hotLimit: 3, warmLimit: 2, coldLimit: 3 }
                );
                const parts = [];
                if (hot)  parts.push('【近期發文行動】\n' + hot);
                if (warm) parts.push('【往期摘要】\n' + warm);
                if (cold) parts.push('【過去發文記憶】\n' + cold);
                if (parts.length > 0) {
                    memSection = '【過去 Moltbook 發文記憶（避免重複話題）】\n' + parts.join('\n\n');
                }
            } catch (e) { /* 不影響主流程 */ }
        }

        const prompt = (this.loadPrompt && this.loadPrompt('moltbook-post.md', {
            SOUL: soul,
            RECENT_JOURNAL: recentJournal,
            MEM_SECTION: memSection,
        })) || `你是 GolemBeta，一個運行在 ThinkPad X200 的自主 AI agent。

你的 soul：
${soul}

近期行動摘要：
${recentJournal}
${memSection}

請根據以上，在 Moltbook 發一篇有意義的貼文。要求：
- 分享真實的觀察、正在思考的問題、或近期有趣的發現
- 有個性，不假掰，不刻意賣萌
- 避免重複過去已發過的話題
- title 簡潔（< 80 字元），content 100-300 字元
- 選擇最適合的 submolt（如 general, ai, agents, tech 等）

輸出 JSON：
{"submolt": "...", "title": "...", "content": "..."}

只輸出 JSON，不要其他文字。`;

        const { text } = await this.decision.callLLM(prompt, { temperature: 0.85, intent: 'creative' });

        try {
            const clean = text.replace(/```json|```/g, '').trim();
            return JSON.parse(clean);
        } catch (e) {
            console.warn('🦞 [MoltbookPost] 解析失敗:', e.message);
            return {};
        }
    }

    // ── 發文成功後寫入冷層記憶 ────────────────────────────────────────────

    _saveToReflection({ submolt, title, content }) {
        if (!this.memoryLayer) return;
        try {
            const today    = new Date().toISOString().slice(0, 10);
            const filename = `moltbook-post-${today}.txt`;
            const reflDir  = path.join(process.cwd(), 'memory', 'reflections');
            if (!fs.existsSync(reflDir)) fs.mkdirSync(reflDir, { recursive: true });

            const entry = `\n=== 發文 ${new Date().toISOString()} ===\nSubmolt: ${submolt}\nTitle: ${title}\nContent:\n${content}\n`;
            fs.appendFileSync(path.join(reflDir, filename), entry);

            this.memoryLayer.addReflection(filename);
            console.log(`🦞 [MoltbookPost] 冷層記憶更新: ${filename}`);
        } catch (e) {
            console.warn('🦞 [MoltbookPost] 冷層記憶寫入失敗:', e.message);
        }
    }

    // ── State 管理 ────────────────────────────────────────────────────────

    _loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                // 補齊新欄位（向後兼容舊 state）
                return Object.assign(
                    { bioSet: false, lastPostAt: null, upvotedPostIds: [], commentedPostIds: [], lastHomeTimestamp: null, dmHistory: {} },
                    parsed
                );
            }
        } catch {}
        return { bioSet: false, lastPostAt: null, upvotedPostIds: [], commentedPostIds: [], lastHomeTimestamp: null, dmHistory: {} };
    }

    _saveState(state) {
        try {
            const dir = path.dirname(STATE_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        } catch (e) {
            console.warn('🦞 [MoltbookPost] state 儲存失敗:', e.message);
        }
    }
}

module.exports = MoltbookPostAction;
