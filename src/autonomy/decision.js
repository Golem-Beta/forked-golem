/**
 * @module decision
 * @role DecisionEngine — 核心決策邏輯：可選行動過濾、prompt 組裝、LLM 呼叫
 * @when-to-modify 調整決策邏輯、行動過濾規則、或 makeDecision prompt 時
 *
 * 輔助工具方法（設定讀取、靈魂文件、時間脈絡、檔案工具）委派至 DecisionUtils。
 * 行動可用性過濾委派至 ActionFilter。
 */
const DecisionUtils   = require('./decision-utils');
const ActionFilter    = require('./action-filter');
const ContextPressure = require('./context-pressure');
const DecisionContext = require('./decision-context');
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
        this._context = new DecisionContext({
            journalMgr: journal, brain, memory: memory || null, notifier, pressure: this._pressure,
        });
    }

    // === 委派至 DecisionUtils（介面保持不變）===

    loadAutonomyConfig() { return this.utils.loadAutonomyConfig(); }
    readSoul() { return this.utils.readSoul(); }
    getTimeContext(now) { return this.utils.getTimeContext(now); }
    getProjectFileList(pathsOnly = false) { return this.utils.getProjectFileList(pathsOnly); }
    extractCodeSection(f, targetNode = null) { return this.utils.extractCodeSection(f, targetNode); }
    saveReflection(a, c) { return this.utils.saveReflection(a, c); }
    getAvailableActions() { return this._actionFilter.getAvailableActions({ journal: this.journal, notifier: this.notifier, cfg: this.loadAutonomyConfig() }); }

    /**
     * Autonomy 專用 LLM 呼叫（不帶 chatHistory / skills）
     */
    async callLLM(prompt, opts = {}) {
        const intent = opts.intent || 'utility';
        const intentDef = INTENT_REQUIREMENTS[intent];
        const defaultMaxTokens = intentDef ? intentDef.defaultMaxTokens : 1024;
        try {
            const result = await this.brain.router.complete({
                intent,
                messages:        [{ role: 'user', content: prompt }],
                maxTokens:       opts.maxOutputTokens || defaultMaxTokens,
                temperature:     opts.temperature || 0.8,
                tools:           opts.tools,
                excludeProvider: opts.excludeProvider || null,
            });
            this._lastLLMMeta = result.meta;
            this._lastTokens = result.usage;
            if (!result.text || result.text.trim() === '') {
                throw new Error('LLM response is empty');
            }
            return {
                text: result.text,
                grounding: result.grounding || null,
            };
        } catch (error) {
            try {
                this.journal.append({ action: 'llm_error', outcome: error.message, intent });
            } catch (_) {}
            throw error;
        }
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

        const {
            journalSummary, memorySection, diversitySection, statsSection,
            warmSection, coldSection, journalSearchSection, quietQueueSection, pressureSection,
            synthesisSection, hnSection, codebaseSummary, internalState, reflectionHistorySection,
        } = await this._context.build(cfg, soul, journal, available);

        const actionList = available.map((a, i) =>
            (i + 1) + '. ' + a.id + ' — ' + a.desc + (a.note ? ' (' + a.note + ')' : '')
        ).join('\n');
        const validActionStr = available.map(a => a.id).join(', ');

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
            PRESSURE_SECTION: pressureSection,
            SYNTHESIS_SECTION: synthesisSection,
            HN_SECTION: hnSection,
            CODEBASE_SUMMARY: codebaseSummary,
            INTERNAL_STATE: internalState,
            REFLECTION_HISTORY_SECTION: reflectionHistorySection
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
            let decision;
            try {
                decision = JSON.parse(cleaned);
            } catch (parseError) {
                console.warn('⚠️ [Decision] JSON 解析失敗，嘗試提取第一個合法 JSON:', parseError.message);
                const jsonMatch = cleaned.match(/\{([\s\S]*?)\}/);
                if (jsonMatch && jsonMatch[0]) {
                    decision = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('無法從 LLM 回應中提取任何 JSON 物件');
                }
            }

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
