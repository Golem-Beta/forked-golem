/**
 * 🧠 ExperienceMemoryLayer — 三層記憶召回系統
 *
 * hot  層：journal FlexSearch（最近行動記錄）
 * warm 層：synthesis 摘要文件，時間衰減排序
 * cold 層：reflections 全文輕量關鍵字索引，半衰期 7 天衰減
 *
 * 設計原則：任一層拋錯不影響其他層，所有 IO 都有 try/catch
 */
const fs = require('fs');
const path = require('path');

// 停用詞（中文高頻虛詞，不納入關鍵字索引）
const STOP_WORDS = new Set([
    '的', '了', '是', '在', '有', '和', '我', '不', '這', '也',
    '都', '就', '以', '到', '他', '她', '你', '們', '與', '為',
    '一', '個', '上', '中', '下', '對', '要', '會', '可', '能',
    '但', '及', '或', '而', '之', '所', '被', '其', '如', '於'
]);

class ExperienceMemoryLayer {
    /**
     * @param {object} opts
     * @param {import('../autonomy/journal')} opts.journal - JournalManager instance
     */
    constructor({ journal }) {
        this.journal = journal;
        this.synthDir = path.join(process.cwd(), 'memory', 'synthesis');
        this.reflDir = path.join(process.cwd(), 'memory', 'reflections');
        this._coldIndex = new Map();
        this._buildColdIndex();
    }

    // === 冷層索引建立 ===

    _buildColdIndex() {
        try {
            if (!fs.existsSync(this.reflDir)) {
                console.log('🧠 [MemoryLayer] 冷層目錄不存在，跳過索引建立');
                return;
            }
            const files = fs.readdirSync(this.reflDir).filter(f => f.endsWith('.txt'));
            for (const filename of files) {
                try {
                    const fullPath = path.join(this.reflDir, filename);
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const entry = this._buildEntry(filename, content);
                    this._coldIndex.set(filename, entry);
                } catch (e) {
                    // 單檔失敗不影響其他
                }
            }
            console.log('🧠 [MemoryLayer] 冷層索引完成: ' + this._coldIndex.size + ' 份');
        } catch (e) {
            console.warn('🧠 [MemoryLayer] _buildColdIndex 失敗（graceful）:', e.message);
        }
    }

    _buildEntry(filename, content) {
        // 從檔名取日期（格式：YYYY-MM-DD 或 action_type-YYYY-MM-DDTxx）
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : null;

        // 關鍵字提取：全文 split，過濾停用詞和短詞，取前 50 高頻詞
        const wordFreq = {};
        const tokens = content.split(/\W+/).filter(w => w.length >= 2);
        for (const token of tokens) {
            if (!STOP_WORDS.has(token)) {
                wordFreq[token] = (wordFreq[token] || 0) + 1;
            }
        }
        const keywords = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([word]) => word);

        return {
            filename,
            date,
            keywords,
            preview: content.substring(0, 300)
        };
    }

    /**
     * 增量更新冷層索引（saveReflection 後呼叫）
     * @param {string} filename
     */
    addReflection(filename) {
        try {
            const fullPath = path.join(this.reflDir, filename);
            if (!fs.existsSync(fullPath)) return;
            const content = fs.readFileSync(fullPath, 'utf-8');
            const entry = this._buildEntry(filename, content);
            this._coldIndex.set(filename, entry);
        } catch (e) {
            // 增量更新失敗不影響主流程
        }
    }

    // === 時間衰減 ===

    /**
     * 半衰期 7 天衰減
     * @param {number} baseScore
     * @param {string|null} dateStr - YYYY-MM-DD 格式
     */
    _decayScore(baseScore, dateStr) {
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

    // === 主要召回介面 ===

    /**
     * 三層記憶召回
     * @param {string} query
     * @param {object} opts
     * @param {number} opts.hotLimit   - journal 召回數（default 5）
     * @param {number} opts.warmLimit  - synthesis 召回數（default 2）
     * @param {number} opts.coldLimit  - reflections 召回數（default 3）
     * @returns {{ hot: string, warm: string, cold: string }}
     */
    recall(query, opts = {}) {
        const { hotLimit = 5, warmLimit = 2, coldLimit = 3 } = opts;
        let hot = '', warm = '', cold = '';

        if (hotLimit > 0) {
            try { hot = this._recallHot(query, hotLimit); } catch (e) { /* 不影響其他層 */ }
        }
        if (warmLimit > 0) {
            try { warm = this._recallWarm(warmLimit); } catch (e) { /* 不影響其他層 */ }
        }
        if (coldLimit > 0) {
            try { cold = this._recallCold(query, coldLimit); } catch (e) { /* 不影響其他層 */ }
        }

        return { hot, warm, cold };
    }

    // === 熱層（journal FlexSearch）===

    _recallHot(query, limit) {
        if (!this.journal || typeof this.journal.search !== 'function') return '';
        const results = this.journal.search(query, limit);
        if (!results || results.length === 0) return '';
        return results.map(j => {
            const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
            return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.topic || '(無記錄)');
        }).join('\n');
    }

    // === 溫層（synthesis 摘要）===

    _recallWarm(limit) {
        if (!fs.existsSync(this.synthDir)) return '';
        const files = fs.readdirSync(this.synthDir)
            .filter(f => f.endsWith('.md'))
            .sort()  // 按檔名排序（日期前綴）
            .reverse();  // 最新在前

        if (files.length === 0) return '';

        // 衰減排序：提取日期計算分數
        const scored = files.map(f => {
            const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/);
            const dateStr = dateMatch ? dateMatch[1] : null;
            return { f, score: this._decayScore(1.0, dateStr) };
        }).sort((a, b) => b.score - a.score);

        const results = [];
        for (const { f } of scored.slice(0, limit)) {
            try {
                const content = fs.readFileSync(path.join(this.synthDir, f), 'utf-8');
                // 取 ## 摘要 段落，找不到就取前 300 字
                const summaryMatch = content.match(/##\s*摘要[\s\S]*?\n([\s\S]*?)(?=\n##|$)/);
                const excerpt = summaryMatch ? summaryMatch[1].trim() : content.substring(0, 300).trim();
                // 從檔名取標題（去掉日期前綴和副檔名）
                const title = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', '').replace(/_/g, ' ');
                const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/);
                const dateStr = dateMatch ? dateMatch[1] : '?';
                results.push('【' + dateStr + '】' + title + '\n' + excerpt);
            } catch (e) {
                // 單檔讀取失敗不影響其他
            }
        }
        return results.join('\n\n');
    }

    // === 冷層（reflections 關鍵字索引）===

    _recallCold(query, limit) {
        if (this._coldIndex.size === 0) return '';

        // 從 query 提取關鍵詞
        const queryKeywords = query.split(/\W+/)
            .filter(w => w.length >= 2 && !STOP_WORDS.has(w));

        if (queryKeywords.length === 0) {
            // 無有效關鍵詞時，按衰減分數取最新幾份
            const entries = Array.from(this._coldIndex.values());
            const scored = entries.map(e => ({
                e,
                score: this._decayScore(0.5, e.date)
            })).sort((a, b) => b.score - a.score);

            return scored.slice(0, limit).map(({ e }) => {
                return '【' + (e.date || '?') + '】' + e.filename + '\n' + e.preview;
            }).join('\n\n');
        }

        // 計算交集分數
        const scored = [];
        for (const [, entry] of this._coldIndex) {
            const entryKeywordSet = new Set(entry.keywords);
            const matched = queryKeywords.filter(k => entryKeywordSet.has(k)).length;
            if (matched === 0) continue;
            const baseScore = matched / queryKeywords.length;
            const finalScore = this._decayScore(baseScore, entry.date);
            scored.push({ entry, score: finalScore });
        }

        if (scored.length === 0) return '';

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(({ entry: e }) => {
            return '【' + (e.date || '?') + '】' + e.filename + '\n' + e.preview;
        }).join('\n\n');
    }
}

module.exports = ExperienceMemoryLayer;
