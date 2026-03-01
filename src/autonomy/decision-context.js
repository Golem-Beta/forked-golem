/**
 * @module decision-context
 * @role makeDecision 的情境區塊組裝器（journal摘要、記憶召回、BM25、多樣性統計、壓力訊號）
 * @when-to-modify 新增/移除 prompt 情境維度、調整記憶召回策略、修改多樣性統計邏輯時
 *
 * 與 decision.js 的職責分界：
 *   decision.js         — 決策協調（行動過濾、prompt 載入、LLM 呼叫、JSON parse）
 *   decision-context.js — 情境組裝（高頻變更：每次擴充 prompt 維度時修改此檔）
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const SYNTHESIS_DIR        = path.join(__dirname, '../../memory/synthesis');
const EXPLORE_ACTIONS      = new Set(['github_explore', 'web_research']);
const CODEBASE_INDEX_PATH  = path.join(__dirname, '../../data/codebase-index.json');

class DecisionContext {
    /**
     * @param {object} deps
     * @param {object} deps.journalMgr  - JournalManager（用於 .search()、.buildStats()）
     * @param {object} deps.brain       - GolemBrain（用於 .recall()）
     * @param {object} deps.memory      - ExperienceMemoryLayer（三層記憶）
     * @param {object} deps.notifier    - Notifier（用於 _quietQueue）
     * @param {object} deps.pressure    - ContextPressure instance
     */
    constructor({ journalMgr, brain, memory, notifier, pressure }) {
        this.journalMgr = journalMgr;
        this.brain      = brain;
        this.memory     = memory;
        this.notifier   = notifier;
        this._pressure  = pressure;
    }

    /**
     * 組裝 makeDecision 所需的所有情境區塊
     * @param {object} cfg            - autonomy config
     * @param {string} soul           - soul.md 全文
     * @param {Array}  recentEntries  - journal.readRecent() 回傳的近期條目
     * @param {Array}  available      - 可選行動陣列
     * @returns {object} sections — 各 prompt 區塊的字串
     */
    async build(cfg, soul, recentEntries, available) {
        const journalSummary    = this._buildJournalSummary(recentEntries);
        const memorySection     = await this._recallBrainMemory(recentEntries);
        const diversitySection  = this._buildDiversitySection(recentEntries);
        const statsSection      = '【全量 Journal 統計】\n' + this.journalMgr.buildStats();
        const { warmSection, coldSection } = await this._recallThreeLayers(soul, recentEntries);
        const journalSearchSection = this._bm25Search(soul, recentEntries);
        const quietQueueSection    = this._buildQuietQueueSection();
        const pressureSection      = this._pressure.evaluate();

        const hasExplore     = Array.isArray(available) && available.some(a => EXPLORE_ACTIONS.has(a.id));
        const synthesisSection = hasExplore ? this._readLatestSynthesis() : '';

        const hasReflect     = Array.isArray(available) && available.some(a => a.id === 'self_reflection');
        const codebaseSummary = hasReflect ? this._readCodebaseSummary() : '';

        return {
            journalSummary,
            memorySection,
            diversitySection,
            statsSection,
            warmSection,
            coldSection,
            journalSearchSection,
            quietQueueSection,
            pressureSection,
            synthesisSection,
            codebaseSummary,
        };
    }

    // ── 各區塊組裝（private）─────────────────────────────────────────────

    _buildJournalSummary(recentEntries) {
        if (recentEntries.length === 0) return '(無經驗記錄)';
        return recentEntries.map(j => {
            const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
            return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.topic || '(無記錄)');
        }).join('\n');
    }

    async _recallBrainMemory(recentEntries) {
        try {
            const recentTopics = recentEntries
                .filter(j => j.action === 'conversation' && j.preview)
                .slice(-3)
                .map(j => j.preview)
                .join(' ');
            if (recentTopics && this.brain && this.brain.recall) {
                const memories = await this.brain.recall(recentTopics);
                if (memories.length > 0) {
                    const summary = memories.slice(0, 3).map(m => '• ' + m.text.substring(0, 100)).join('\n');
                    return '【老哥最近的互動記憶】\n' + summary;
                }
            }
        } catch (e) { console.warn('[Decision] 記憶召回失敗（不影響決策）:', e.message); }
        return '';
    }

    _buildDiversitySection(recentEntries) {
        if (recentEntries.length === 0) return '';
        const actionCounts = {};
        let consecutiveCount = 0;
        let lastAction = null;
        recentEntries.forEach(j => { actionCounts[j.action] = (actionCounts[j.action] || 0) + 1; });
        for (let i = recentEntries.length - 1; i >= 0; i--) {
            if (lastAction === null) lastAction = recentEntries[i].action;
            if (recentEntries[i].action === lastAction) consecutiveCount++;
            else break;
        }
        const parts = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' x' + v);
        let summary = parts.join(', ');
        if (consecutiveCount >= 2) {
            summary += ' | WARNING: ' + lastAction + ' has run ' + consecutiveCount + ' times in a row';
        }
        return '【行動分佈統計】\n' + summary;
    }

    async _recallThreeLayers(soul, recentEntries) {
        try {
            const recentTopics = recentEntries.slice(-3)
                .map(j => [j.topic, j.action, j.outcome].filter(Boolean).join(' '))
                .join(' ');
            const soulGoals = soul.match(/(?:目標|方向|當前|長期|終極|短期|下一階段|研究|探索|改進)[：:]\s*(.+)/g);
            const soulKeywords = soulGoals ? soulGoals.map(g => g.replace(/^[^：:]+[：:]\s*/, '')).join(' ') : '';
            const memQuery = (recentTopics + ' ' + soulKeywords).trim();
            if (this.memory && memQuery) {
                const { warm, cold } = this.memory.recall(memQuery, { hotLimit: 0, warmLimit: 2, coldLimit: 3 });
                return {
                    warmSection: warm ? '【近期歸納洞察】\n' + warm : '',
                    coldSection: cold ? '【相關探索分析】\n' + cold : '',
                };
            }
        } catch (e) { /* 三層記憶召回失敗不影響決策 */ }
        return { warmSection: '', coldSection: '' };
    }

    _bm25Search(soul, recentEntries) {
        try {
            const recentTopics = recentEntries.slice(-3)
                .map(j => [j.topic, j.action, j.outcome].filter(Boolean).join(' '))
                .join(' ');
            const soulGoals = soul.match(/(?:目標|方向|當前|長期|終極|短期|下一階段|研究|探索|改進)[：:]\s*(.+)/g);
            const soulKeywords = soulGoals ? soulGoals.map(g => g.replace(/^[^：:]+[：:]\s*/, '')).join(' ') : '';
            const combinedQuery = (recentTopics + ' ' + soulKeywords).trim();
            if (!combinedQuery) return '';
            const related = this.journalMgr.search(combinedQuery, 5);
            const recentTs = new Set(recentEntries.map(j => j.ts));
            const unique = related.filter(r => !recentTs.has(r.ts));
            if (unique.length === 0) return '';
            return '【歷史相關經驗（BM25 召回）】\n' + unique.map(j => {
                const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.topic || '');
            }).join('\n');
        } catch (e) { /* 搜尋失敗不影響決策 */ }
        return '';
    }

    _readCodebaseSummary() {
        try {
            const CodebaseIndexer = require('../../src/codebase-indexer');
            const idx = CodebaseIndexer.load();
            return '【Codebase 索引摘要】\n' + CodebaseIndexer.generateSummary(idx);
        } catch (e) {
            return ''; // 索引不可用時靜默略過
        }
    }

    _readLatestSynthesis() {
        try {
            const files = fs.readdirSync(SYNTHESIS_DIR)
                .filter(f => f.endsWith('.md'))
                .map(f => ({ name: f, mtime: fs.statSync(path.join(SYNTHESIS_DIR, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, 2);
            if (files.length === 0) return '';
            const snippets = files.map(f => {
                const raw = fs.readFileSync(path.join(SYNTHESIS_DIR, f.name), 'utf8');
                return raw.substring(0, 500);
            });
            return '【近期思考歸納】\n' + snippets.join('\n\n---\n\n');
        } catch (e) {
            return '';
        }
    }

    _buildQuietQueueSection() {
        const quietQueue = this.notifier ? this.notifier._quietQueue : [];
        if (!quietQueue || quietQueue.length === 0) return '';
        return '【靜默時段暫存】（靜默時段完成但尚未匯報給主人的行動）\n' +
            quietQueue.map(q => '[' + q.ts + '] ' + q.text.substring(0, 200)).join('\n');
    }
}

module.exports = DecisionContext;
