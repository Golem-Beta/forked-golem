/**
 * @module autonomy/actions/moltbook-engagement
 * @role Moltbook 效果學習 — 追蹤已發貼文的 upvote/comment 變化，寫入 journal 供熱層召回
 * @note 純函式模組，無狀態，由 MoltbookCheckAction 在每次巡查時呼叫
 *
 * 設計：
 *   從 journal 找 moltbook_post 記錄取 post_id，呼叫 GET /posts/:id 比對變化
 *   顯著互動（upvote +2 以上或新留言）寫 journal { action: 'moltbook_engagement' }
 *   這筆 journal 會被三層記憶熱層召回，讓 moltbook_post 下次生成時知道哪類內容有共鳴
 *   postStats 追蹤最多 MAX_TRACK_POSTS 篇（超過截斷最舊的）
 */
'use strict';

const MAX_TRACK_POSTS = 20;

/**
 * 巡查已發貼文的互動變化，更新 state.postStats，顯著變化寫入 journal
 * @param {object} deps
 * @param {object} deps.client   - MoltbookClient instance
 * @param {object} deps.journal  - JournalManager instance
 * @param {object} deps.state    - 已載入的 moltbook-state（直接修改 postStats 欄位）
 */
async function checkPostEngagement({ client, journal, state }) {
    try {
        // 從 journal 找最近發過的 post_id（最多追蹤 MAX_TRACK_POSTS 篇）
        const recentPosts = journal.readRecent(50)
            .filter(j => j.action === 'moltbook_post' && j.post_id)
            .map(j => ({ post_id: String(j.post_id), title: j.title || '' }))
            .slice(0, MAX_TRACK_POSTS);

        if (recentPosts.length === 0) return;

        const prevStats = state.postStats || {};
        const newStats  = {};

        for (const { post_id, title } of recentPosts) {
            const r = await client.get(`/posts/${post_id}`);
            if (!r.success) continue;

            const post     = r.post || {};
            const upvotes  = post.upvotes  || 0;
            const comments = post.comments || post.comment_count || 0;

            const prev          = prevStats[post_id] || { upvotes: 0, comments: 0, lastChecked: null };
            const deltaUpvotes  = upvotes  - prev.upvotes;
            const deltaComments = comments - prev.comments;

            newStats[post_id] = { upvotes, comments, lastChecked: Date.now() };

            // 顯著互動才寫 journal（讓三層記憶熱層可召回，影響下次發文策略）
            if (deltaUpvotes >= 2 || deltaComments > 0) {
                journal.append({
                    action:         'moltbook_engagement',
                    post_id,
                    delta_upvotes:  deltaUpvotes,
                    delta_comments: deltaComments,
                    title,
                });
                console.log(`🦞 [Engagement] 貼文 ${post_id} 有互動: +${deltaUpvotes} upvotes, +${deltaComments} comments — "${title}"`);
            }
        }

        // 合併新舊 stats，保留最多 MAX_TRACK_POSTS 篇（按最後檢查時間降序截斷）
        const merged = Object.assign({}, prevStats, newStats);
        const sortedKeys = Object.keys(merged)
            .sort((a, b) => (merged[b].lastChecked || 0) - (merged[a].lastChecked || 0))
            .slice(0, MAX_TRACK_POSTS);
        state.postStats = Object.fromEntries(sortedKeys.map(k => [k, merged[k]]));

    } catch (e) {
        console.warn('🦞 [Engagement] engagement 追蹤失敗:', e.message);
    }
}

module.exports = { checkPostEngagement };
