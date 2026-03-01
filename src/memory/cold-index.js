'use strict';
/**
 * @module memory/cold-index
 * @role 冷層記憶管理 — reflections 關鍵字索引建立、增量更新、衰減召回
 * @when-to-modify 調整關鍵字提取策略、衰減公式、或冷層查詢邏輯時
 *
 * 同時 export decayScore 供 warm 層（index.js）共用
 */
const fs   = require('fs');
const path = require('path');

const STOP_WORDS = new Set([
    '的', '了', '是', '在', '有', '和', '我', '不', '這', '也',
    '都', '就', '以', '到', '他', '她', '你', '們', '與', '為',
    '一', '個', '上', '中', '下', '對', '要', '會', '可', '能',
    '但', '及', '或', '而', '之', '所', '被', '其', '如', '於'
]);

/**
 * 半衰期 7 天衰減（cold + warm 共用）
 * @param {number} baseScore
 * @param {string|null} dateStr - YYYY-MM-DD 格式
 */
function decayScore(baseScore, dateStr) {
    if (!dateStr) return baseScore * 0.5;
    try {
        const ageDays = (Date.now() - new Date(dateStr).getTime()) / 86400000;
        if (ageDays < 0) return baseScore;
        // e^(-ln2/7 * ageDays) = 2^(-ageDays/7)
        return baseScore * Math.pow(2, -ageDays / 7);
    } catch (e) {
        return baseScore * 0.5;
    }
}

class ColdIndex {
    constructor(reflDir) {
        this.reflDir = reflDir;
        this._index  = new Map();
        this._build();
    }

    _build() {
        try {
            if (!fs.existsSync(this.reflDir)) {
                console.log('🧠 [ColdIndex] 冷層目錄不存在，跳過索引建立');
                return;
            }
            const files = fs.readdirSync(this.reflDir).filter(f => f.endsWith('.txt'));
            for (const filename of files) {
                try {
                    const content = fs.readFileSync(path.join(this.reflDir, filename), 'utf-8');
                    this._index.set(filename, this._buildEntry(filename, content));
                } catch (e) { /* 單檔失敗不影響其他 */ }
            }
            console.log('🧠 [ColdIndex] 索引完成: ' + this._index.size + ' 份');
        } catch (e) {
            console.warn('🧠 [ColdIndex] 建立失敗（graceful）:', e.message);
        }
    }

    _buildEntry(filename, content) {
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        const date      = dateMatch ? dateMatch[1] : null;

        const wordFreq = {};
        const tokens   = content.split(/\W+/).filter(w => w.length >= 2);
        for (const token of tokens) {
            if (!STOP_WORDS.has(token)) {
                wordFreq[token] = (wordFreq[token] || 0) + 1;
            }
        }
        const keywords = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([word]) => word);

        return { filename, date, keywords, preview: content.substring(0, 300) };
    }

    /** 增量更新冷層索引（新增 reflection 後呼叫）*/
    add(filename) {
        try {
            const fullPath = path.join(this.reflDir, filename);
            if (!fs.existsSync(fullPath)) return;
            const content = fs.readFileSync(fullPath, 'utf-8');
            this._index.set(filename, this._buildEntry(filename, content));
        } catch (e) { /* 增量更新失敗不影響主流程 */ }
    }

    /**
     * 關鍵字比對 + 衰減召回
     * @param {string} query
     * @param {number} limit
     * @returns {string}
     */
    search(query, limit) {
        if (this._index.size === 0) return '';

        const queryKeywords = query.split(/\W+/)
            .filter(w => w.length >= 2 && !STOP_WORDS.has(w));

        if (queryKeywords.length === 0) {
            return Array.from(this._index.values())
                .map(e => ({ e, score: decayScore(0.5, e.date) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
                .map(({ e }) => '【' + (e.date || '?') + '】' + e.filename + '\n' + e.preview)
                .join('\n\n');
        }

        const scored = [];
        for (const [, entry] of this._index) {
            const entrySet = new Set(entry.keywords);
            const matched  = queryKeywords.filter(k => entrySet.has(k)).length;
            if (matched === 0) continue;
            scored.push({ entry, score: decayScore(matched / queryKeywords.length, entry.date) });
        }
        if (scored.length === 0) return '';

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit)
            .map(({ entry: e }) => '【' + (e.date || '?') + '】' + e.filename + '\n' + e.preview)
            .join('\n\n');
    }
}

module.exports = ColdIndex;
module.exports.decayScore = decayScore;
