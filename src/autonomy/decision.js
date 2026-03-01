/**
 * @module decision
 * @role DecisionEngine — 核心決策邏輯：可選行動過濾、prompt 組裝、LLM 呼叫
 * @when-to-modify 調整決策邏輯、行動過濾規則、或 makeDecision prompt 時
 *
 * 輔助工具方法（設定讀取、靈魂文件、時間脈絡、檔案工具）委派至 DecisionUtils。
 * 行動可用性過濾委派至 ActionFilter。
 */
const DecisionUtils = require('./decision-utils');
const ActionFilter = require('./action-filter');
const ContextPressure = require('./context-pressure');
const INTENT_REQUIREMENTS = require('../model-router/intents');

class DecisionEngine {
    /**
     * @param {object} deps
     * @param {import('./journal')} deps.journal - JournalManager instance
     * @param {object} deps.brain - GolemBrain instance
     * @param {object} deps.config - CONFIG 物件
     * @param {Function} deps.loadPrompt - prompt 載入函式
     */
    constructor({ journal, brain, config, loadPrompt, notifier, memory }) {
        this.journal = journal;
        this.brain = brain;
        this.config = config;
        this.loadPrompt = loadPrompt;
        this.notifier = notifier;  // 用於讀取 quietQueue
        this.memory = memory || null;  // ExperienceMemoryLayer（三層記憶召回）
        this.utils = new DecisionUtils();
        this._actionFilter = new ActionFilter();
        this._pressure = new ContextPressure({ journal, notifier });
    }

    // === 委派至 DecisionUtils（介面保持不變）===

    loadAutonomyConfig() { return this.utils.loadAutonomyConfig(); }
    readSoul() { return this.utils.readSoul(); }
    getTimeContext(now) { return this.utils.getTimeContext(now); }
    getProjectFileList() { return this.utils.getProjectFileList(); }
    extractCodeSection(f) { return this.utils.extractCodeSection(f); }
    saveReflection(a, c) { return this.utils.saveReflection(a, c); }
    getAvailableActions() { return this._actionFilter.getAvailableActions({ journal: this.journal, notifier: this.notifier, cfg: this.loadAutonomyConfig() }); }

    /**
     * Autonomy 專用 LLM 呼叫（不帶 chatHistory / skills）
     */
    async callLLM(prompt, opts = {}) {
        const intent = opts.intent || 'utility';
        const intentDef = INTENT_REQUIREMENTS[intent];
        const defaultMaxTokens = intentDef ? intentDef.defaultMaxTokens : 1024;
        const result = await this.brain.router.complete({
            intent,
            messages: [{ role: 'user', content: prompt }],
            maxTokens: opts.maxOutputTokens || defaultMaxTokens,
            temperature: opts.temperature || 0.8,
            tools: opts.tools,
        });
        this._lastLLMMeta = result.meta;
        this._lastTokens = result.usage;
        return {
            text: result.text,
            grounding: result.grounding || null,
        };
    }

    get lastModel() {
        if (!this._lastLLMMeta) return undefined;
        return this._lastLLMMeta.provider + '/' + this._lastLLMMeta.model;
    }

    get lastTokens() {
        return this._lastTokens || null;
    }

    // === 核心決策 ===

    async makeDecision() {
        const cfg = this.loadAutonomyConfig();
        const soul = this.readSoul();
        const journal = this.journal.readRecent(cfg.journal.decisionReadCount);
        const now = new Date();
        const timeCtx = this.getTimeContext(now);
        const timeStr = timeCtx.display;

        const available = this.getAvailableActions();
        const actionIds = available.filter(a => a.id !== 'rest').map(a => a.id);

        if (actionIds.length === 0) {
            console.log('😴 [Decision] 無可選行動，自動 rest');
            return { action: 'rest', reason: '所有行動都已達限制或被封鎖' };
        }

        let journalSummary = '(無經驗記錄)';
        if (journal.length > 0) {
            journalSummary = journal.map(j => {
                const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.topic || '(無記錄)');
            }).join('\n');
        }

        // 閉環：從長期記憶召回最近互動上下文
        let memorySummary = '';
        try {
            const recentTopics = journal
                .filter(j => j.action === 'conversation' && j.preview)
                .slice(-3)
                .map(j => j.preview)
                .join(' ');
            if (recentTopics && this.brain && this.brain.recall) {
                const memories = await this.brain.recall(recentTopics);
                if (memories.length > 0) {
                    memorySummary = memories.slice(0, 3).map(m => '• ' + m.text.substring(0, 100)).join('\n');
                }
            }
        } catch (e) { console.warn('[Decision] 記憶召回失敗（不影響決策）:', e.message); }

        // 行動分佈統計
        const actionCounts = {};
        let consecutiveCount = 0;
        let lastAction = null;
        journal.forEach(j => {
            actionCounts[j.action] = (actionCounts[j.action] || 0) + 1;
        });
        for (let i = journal.length - 1; i >= 0; i--) {
            if (lastAction === null) lastAction = journal[i].action;
            if (journal[i].action === lastAction) consecutiveCount++;
            else break;
        }
        let diversitySummary = '';
        if (journal.length > 0) {
            const parts = Object.entries(actionCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => k + ' x' + v);
            diversitySummary = parts.join(', ');
            if (consecutiveCount >= 2) {
                diversitySummary += ' | WARNING: ' + lastAction + ' has run ' + consecutiveCount + ' times in a row';
            }
        }

        const actionList = available.map((a, i) =>
            (i + 1) + '. ' + a.id + ' — ' + a.desc + (a.note ? ' (' + a.note + ')' : '')
        ).join('\n');
        const validActionStr = available.map(a => a.id).join(', ');

        const diversitySection = diversitySummary ? '【行動分佈統計】\n' + diversitySummary : '';
        const statsSection = '【全量 Journal 統計】\n' + this.journal.buildStats();
        const memorySection = memorySummary ? '【老哥最近的互動記憶】\n' + memorySummary : '';

        // 三層記憶召回（warm + cold）
        let warmSection = '';
        let coldSection = '';
        try {
            const recentTopics3 = journal.slice(-3)
                .map(j => [j.topic, j.action, j.outcome].filter(Boolean).join(' '))
                .join(' ');
            const soulGoals3 = soul.match(/(?:目標|方向|當前|長期|終極|短期|下一階段|研究|探索|改進)[：:]\s*(.+)/g);
            const soulKeywords3 = soulGoals3 ? soulGoals3.map(g => g.replace(/^[^：:]+[：:]\s*/, '')).join(' ') : '';
            const memQuery = (recentTopics3 + ' ' + soulKeywords3).trim();
            if (this.memory && memQuery) {
                const { warm, cold } = this.memory.recall(memQuery, { hotLimit: 0, warmLimit: 2, coldLimit: 3 });
                warmSection = warm ? '【近期歸納洞察】\n' + warm : '';
                coldSection = cold ? '【相關探索分析】\n' + cold : '';
            }
        } catch (e) { /* 三層記憶召回失敗不影響決策 */ }

        // BM25 智慧召回
        let journalSearchSection = '';
        try {
            const recentTopics = journal.slice(-3)
                .map(j => [j.topic, j.action, j.outcome].filter(Boolean).join(' '))
                .join(' ');
            const soulGoals = soul.match(/(?:目標|方向|當前|長期|終極|短期|下一階段|研究|探索|改進)[：:]\s*(.+)/g);
            const soulKeywords = soulGoals ? soulGoals.map(g => g.replace(/^[^：:]+[：:]\s*/, '')).join(' ') : '';
            const combinedQuery = (recentTopics + ' ' + soulKeywords).trim();
            if (combinedQuery) {
                const related = this.journal.search(combinedQuery, 5);
                const recentTs = new Set(journal.map(j => j.ts));
                const unique = related.filter(r => !recentTs.has(r.ts));
                if (unique.length > 0) {
                    journalSearchSection = '【歷史相關經驗（BM25 召回）】\n' + unique.map(j => {
                        const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                        return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.topic || '');
                    }).join('\n');
                }
            }
        } catch (e) { /* 搜尋失敗不影響決策 */ }

        const quietQueue = this.notifier ? this.notifier._quietQueue : [];
        const quietQueueSection = quietQueue.length > 0
            ? '【靜默時段暫存】（靜默時段完成但尚未匯報給主人的行動）\n' +
              quietQueue.map(q => '[' + q.ts + '] ' + q.text.substring(0, 200)).join('\n')
            : '';

        const pressureSection = this._pressure.evaluate();
        if (pressureSection) {
            console.log('🔺 [Decision] 情境壓力訊號:\n' + pressureSection);
        }

        const decisionPrompt = this.loadPrompt('decision.md', {
            SOUL: soul,
            JOURNAL_SUMMARY: journalSummary,
            DIVERSITY_SECTION: diversitySection,
            STATS_SECTION: statsSection,
            JOURNAL_SEARCH_SECTION: journalSearchSection,
            WARM_SECTION: warmSection,
            COLD_SECTION: coldSection,
            MEMORY_SECTION: memorySection,
            TIME_STR: timeStr,
            ACTION_LIST: actionList,
            VALID_ACTIONS: validActionStr,
            QUIET_QUEUE_SECTION: quietQueueSection,
            PRESSURE_SECTION: pressureSection
        }) || '選擇一個行動，用 JSON 回覆 {"action":"rest","reason":"fallback"}';

        try {
            const result = await this.brain.router.complete({
                intent: 'decision',
                messages: [{ role: 'user', content: decisionPrompt }],
                maxTokens: 512,
                temperature: 0.8,
                requireJson: true,
            });

            const text = result.text;
            const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            const decision = JSON.parse(cleaned);

            const validIds = available.map(a => a.id);
            if (!validIds.includes(decision.action)) {
                console.warn('⚠️ [Decision] 選了不可選的 action: ' + decision.action + '，降級為 ' + actionIds[0]);
                decision.action = actionIds[0] || 'rest';
                decision.reason += ' (forced: invalid action)';
            }

            console.log('🎯 [Decision] ' + result.meta.provider + ' 選擇: ' + decision.action + ' — ' + decision.reason);
            try {
                this.journal.append({
                    action: 'decision',
                    chosen: decision.action,
                    reason: decision.reason,
                    pressures: pressureSection
                        ? pressureSection.split('\n').filter(l => l.trim() && !l.startsWith('【')).length
                        : 0,
                });
            } catch (_) {}
            return decision;
        } catch (e) {
            console.warn('⚠️ [Decision] 決策失敗:', e.message);
            return { action: 'rest', reason: 'JSON parse failed: ' + e.message };
        }
    }
}

module.exports = DecisionEngine;
