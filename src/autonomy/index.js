/**
 * 🧬 AutonomyManager — Coordinator
 *
 * 組合 JournalManager, Notifier, DecisionEngine, ActionRunner。
 * 負責 lifecycle（start, schedule, manifestFreeWill）和外部介面代理。
 * 
 * 依賴注入：同原版，由 index.js 傳入。
 */
const fs = require('fs');
const path = require('path');

const JournalManager = require('./journal');
const Notifier = require('./notify');
const DecisionEngine = require('./decision');
const ActionRunner = require('./actions');

class AutonomyManager {
    /**
     * @param {object} deps - 全部依賴注入
     */
    constructor(deps) {
        // 組裝子物件
        this.journal = new JournalManager();

        this.notifier = new Notifier({
            tgBot: deps.tgBot,
            dcClient: deps.dcClient,
            config: deps.CONFIG,
            brain: deps.brain,
            TriStreamParser: deps.TriStreamParser,
        });

        this.decision = new DecisionEngine({
            journal: this.journal,
            brain: deps.brain,
            config: deps.CONFIG,
            loadPrompt: deps.loadPrompt,
            notifier: this.notifier,  // 讓 decision 能讀 quietQueue
        });

        this.actions = new ActionRunner({
            journal: this.journal,
            notifier: this.notifier,
            decision: this.decision,
            brain: deps.brain,
            config: deps.CONFIG,
            memory: deps.memory,
            skills: deps.skills,
            loadPrompt: deps.loadPrompt,
            PatchManager: deps.PatchManager,
            ResponseParser: deps.ResponseParser,
            InputFile: deps.InputFile,
        });

        // Coordinator 自身狀態
        this.chronos = deps.chronos;
        this.CONFIG = deps.CONFIG;
        this._timer = null;
        this.nextWakeTime = null;
        this.quietMode = false;
    }

    // === Lifecycle ===

    start() {
        if (!this.CONFIG.TG_TOKEN && !this.CONFIG.DC_TOKEN) return;
        const memDir = path.join(process.cwd(), 'memory');
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        this.chronos.rebuild();
        this.scheduleNextAwakening();
    }

    scheduleNextAwakening() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        try {
            const cfg = this.decision.loadAutonomyConfig().awakening || {};
            const range = cfg.maxHours - cfg.minHours;
            const waitMs = (cfg.minHours + Math.random() * range) * 3600000;
            const nextWakeTime = new Date(Date.now() + waitMs);
            this.nextWakeTime = nextWakeTime;
            const hour = nextWakeTime.getHours();
            const quietHours = cfg.quietHours || cfg.sleepHours || [];
            const isQuiet = quietHours.includes(hour);
            if (isQuiet) {
                console.log('🌙 [LifeCycle] 下次醒來在靜音時段 (' + hour + ':00)，不發社交訊息');
            }
            console.log('♻️ [LifeCycle] 下次醒來: ' + (waitMs / 60000).toFixed(1) + ' 分鐘後' + (isQuiet ? ' (靜音模式)' : ''));
            this._timer = setTimeout(() => {
                this.quietMode = isQuiet;
                this.notifier.setQuietMode(isQuiet);  // 同步到 Notifier
                this.manifestFreeWill();
                this.scheduleNextAwakening();
            }, waitMs);
        } catch (e) {
            console.error('🛡️ [LifeCycle] scheduleNextAwakening 異常:', e.message);
            this._timer = setTimeout(() => { this.scheduleNextAwakening(); }, 2 * 3600000);
        }
    }

    async manifestFreeWill() {
        this.nextWakeTime = null;
        try {
            const _heapBefore = process.memoryUsage();
            console.log(`🧠 [Heap] 醒來: RSS=${(_heapBefore.rss/1024/1024).toFixed(0)}MB, Heap=${(_heapBefore.heapUsed/1024/1024).toFixed(0)}MB/${(_heapBefore.heapTotal/1024/1024).toFixed(0)}MB`);

            let decision = await this.decision.makeDecision();

            if (!decision) {
                console.warn('😴 [Decision] 決策失敗 → 強制 rest');
                decision = { action: 'rest', reason: 'fallback: 決策失敗，強制休息保護配額' };
            }

            if (decision.action !== 'rest') {
                console.log('⏳ [Autonomy] 決策完成，等待 5 秒後執行行動...');
                await new Promise(r => setTimeout(r, 5000));
            }

            const actionEmoji = {
                'self_reflection': '🧬', 'github_explore': '🔍',
                'spontaneous_chat': '💬', 'web_research': '🌐',
                'digest': '📝', 'rest': '😴'
            };
            console.log((actionEmoji[decision.action] || '❓') + ' Golem 決定: ' + decision.action + ' — ' + decision.reason);

            switch (decision.action) {
                case 'self_reflection':
                    await this.actions.performSelfReflection();
                    break;
                case 'github_explore':
                    await this.actions.performGitHubExplore();
                    break;
                case 'spontaneous_chat':
                    if (this.quietMode) {
                        console.log('🌙 [Autonomy] 靜音時段，跳過社交 → 改做 GitHub 探索');
                        this.journal.append({ action: 'spontaneous_chat', outcome: 'skipped_quiet_mode' });
                        await this.actions.performGitHubExplore();
                    } else {
                        await this.actions.performSpontaneousChat();
                    }
                    break;
                case 'web_research':
                    await this.actions.performWebResearch(decision.reason);
                    break;
                case 'morning_digest':
                    await this.actions.performMorningDigest();
                    break;
                case 'digest':
                    await this.actions.performDigest();
                    break;
                case 'rest':
                    console.log('😴 [Autonomy] Golem 選擇繼續休息。');
                    this.journal.append({
                        action: 'rest',
                        reason: decision.reason,
                        outcome: '選擇不行動，繼續休息'
                    });
                    break;
                default:
                    console.warn('⚠️ [Autonomy] 未知行動:', decision.action);
            }
        } catch (e) {
            console.error('[錯誤] 自由意志執行失敗:', e.message || e);
            this.journal.append({ action: 'error', error: e.message });
        }
    }

    // === 外部介面代理（保持向後相容）===

    /** @deprecated 用 this.journal.append() */
    appendJournal(entry) { return this.journal.append(entry); }
    /** @deprecated 用 this.journal.readRecent() */
    readRecentJournal(n) { return this.journal.readRecent(n); }
    /** @deprecated 用 this.journal.search() */
    searchJournal(query, limit) { return this.journal.search(query, limit); }
    /** @deprecated 用 this.journal.buildStats() */
    buildJournalStats() { return this.journal.buildStats(); }
    /** @deprecated 用 this.notifier.sendNotification() */
    sendNotification(msg) { return this.notifier.sendNotification(msg); }

    /** 老哥回應回流 — 轉發給 ActionRunner */
    onAdminReply(text) { return this.actions.onAdminReply(text); }
}

module.exports = AutonomyManager;
