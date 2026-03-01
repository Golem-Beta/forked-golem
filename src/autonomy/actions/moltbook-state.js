'use strict';
/**
 * @module actions/moltbook-state
 * @role Moltbook 狀態持久化 — loadState / saveState / appendCapped
 * @when-to-modify 新增 state 欄位、調整預設值、或更改 state 檔路徑時
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

module.exports = { loadState, saveState, appendCapped };
