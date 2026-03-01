/**
 * 🧠 ExperienceMemoryLayer — 三層記憶召回系統
 *
 * hot  層：journal FlexSearch（最近行動記錄）
 * warm 層：synthesis 摘要文件，時間衰減排序
 * cold 層：reflections 關鍵字索引（由 cold-index.js 管理）
 *
 * 設計原則：任一層拋錯不影響其他層，所有 IO 都有 try/catch
 */
const fs   = require('fs');
const path = require('path');

const ColdIndex  = require('./cold-index');
const decayScore = ColdIndex.decayScore;

class ExperienceMemoryLayer {
    /**
     * @param {object} opts
     * @param {import('../autonomy/journal')} opts.journal - JournalManager instance
     */
    constructor({ journal }) {
        this.journal  = journal;
        this.synthDir = path.join(process.cwd(), 'memory', 'synthesis');
        this.reflDir  = path.join(process.cwd(), 'memory', 'reflections');
        this._cold    = new ColdIndex(this.reflDir);
    }

    /**
     * 增量更新冷層索引（saveReflection 後呼叫）
     * @param {string} filename
     */
    addReflection(filename) {
        this._cold.add(filename);
    }

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

        if (hotLimit  > 0) { try { hot  = this._recallHot(query, hotLimit);   } catch (e) {} }
        if (warmLimit > 0) { try { warm = this._recallWarm(warmLimit);         } catch (e) {} }
        if (coldLimit > 0) { try { cold = this._cold.search(query, coldLimit); } catch (e) {} }

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
            .sort().reverse();

        if (files.length === 0) return '';

        const scored = files.map(f => {
            const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/);
            return { f, score: decayScore(1.0, dateMatch ? dateMatch[1] : null) };
        }).sort((a, b) => b.score - a.score);

        const results = [];
        for (const { f } of scored.slice(0, limit)) {
            try {
                const content = fs.readFileSync(path.join(this.synthDir, f), 'utf-8');
                const summaryMatch = content.match(/##\s*摘要[\s\S]*?\n([\s\S]*?)(?=\n##|$)/);
                const excerpt  = summaryMatch ? summaryMatch[1].trim() : content.substring(0, 300).trim();
                const title    = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', '').replace(/_/g, ' ');
                const dateStr  = (f.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '?';
                results.push('【' + dateStr + '】' + title + '\n' + excerpt);
            } catch (e) { /* 單檔讀取失敗不影響其他 */ }
        }
        return results.join('\n\n');
    }
}

module.exports = ExperienceMemoryLayer;
