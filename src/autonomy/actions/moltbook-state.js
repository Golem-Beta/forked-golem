'use strict';
/**
 * @module actions/moltbook-state
 * @role Moltbook 持久化工具 — state 讀寫、冷層記憶寫入
 * @when-to-modify 新增 state 欄位、調整預設值、更改路徑、或修改冷層記憶格式時
 *
 * 被 moltbook-post.js 與 moltbook-check.js 共用，消除重複實作。
 */

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../../data/moltbook-state.json');

// 所有欄位的預設值（新欄位在此宣告，向後兼容舊 state）
const DEFAULT_STATE = {
    bioSet:             false,
    lastPostAt:         null,
    upvotedPostIds:     [],
    commentedPostIds:   [],
    lastHomeTimestamp:  null,
    dmHistory:          {},
    postStats:          {},
};

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            return Object.assign({}, DEFAULT_STATE, parsed);
        }
    } catch {}
    return Object.assign({}, DEFAULT_STATE);
}

function saveState(state) {
    try {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.warn('🦞 [MoltbookState] state 儲存失敗:', e.message);
    }
}

/**
 * 將 item 加入陣列末端，超過 maxLen 時截斷最舊的。
 * @param {string[]} arr
 * @param {string} item
 * @param {number} maxLen
 * @returns {string[]}
 */
function appendCapped(arr, item, maxLen) {
    const list = arr ? [...arr] : [];
    if (!list.includes(item)) list.push(item);
    return list.length > maxLen ? list.slice(-maxLen) : list;
}

/**
 * 巡查完成後寫入冷層記憶（語義摘要，非操作記錄）
 * @param {object|null} memoryLayer - ExperienceMemoryLayer instance
 * @param {{ feed, dms, mentions, plan, results }} data
 */
function saveCheckReflection(memoryLayer, { feed, dms, mentions, plan, results }) {
    if (!memoryLayer) return;
    if (feed.length === 0 && dms.length === 0 && mentions.length === 0) return;
    try {
        const today    = new Date().toISOString().slice(0, 10);
        const filename = `moltbook-check-${today}.txt`;
        const reflDir  = path.join(process.cwd(), 'memory', 'reflections');
        if (!fs.existsSync(reflDir)) fs.mkdirSync(reflDir, { recursive: true });

        const lines = [`\n=== 巡查 ${new Date().toISOString()} ===`];
        lines.push(`互動統計: upvoted:${results.upvoted} commented:${results.commented} dm_replied:${results.dm_replied}`);

        if (feed.length > 0) {
            lines.push('Feed 話題（前5）:');
            feed.slice(0, 5).forEach(p => {
                lines.push(`  - @${p.author?.name || '?'}: ${p.title || p.content?.slice(0, 80) || ''}`);
            });
        }
        if ((plan.comments || []).length > 0) {
            lines.push('已留言:');
            for (const c of plan.comments) {
                lines.push(`  - post_id:${c.post_id}: "${c.content?.slice(0, 120)}"`);
            }
        }
        if ((plan.dm_replies || []).length > 0) {
            lines.push('DM 回覆:');
            for (const dm of plan.dm_replies) {
                lines.push(`  - conv_id:${dm.conv_id}: "${dm.content?.slice(0, 80)}"`);
            }
        }
        if (mentions.length > 0) {
            lines.push(`Mentions: ${mentions.length} 則（有人提及 Beta）`);
        }

        fs.appendFileSync(path.join(reflDir, filename), lines.join('\n') + '\n');
        memoryLayer.addReflection(filename);
        console.log(`🦞 [MoltbookCheck] 冷層記憶更新: ${filename}`);
    } catch (e) {
        console.warn('🦞 [MoltbookCheck] 冷層記憶寫入失敗:', e.message);
    }
}

module.exports = { loadState, saveState, appendCapped, saveCheckReflection };
