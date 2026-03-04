/**
 * 🧬 AutonomyManager — Coordinator
 *
 * 組合 JournalManager, Notifier, DecisionEngine, ActionRunner。
 * 負責 lifecycle（start, scheduleNextAwakening）和外部介面代理。
 * Action dispatch 委派至 FreeWillRunner（free-will.js）。
 *
 * 依賴注入：同原版，由 index.js 傳入。
 */
const fs = require('fs');
const path = require('path');

const JournalManager = require('./journal');
const Notifier = require('./notify');
const DecisionEngine = require('./decision');
const ActionRunner = require('./actions/index');
const { FailureTracker } = require('./failure-tracker');
const ExperienceMemoryLayer = require('../memory/index');
const XPublisher = require('../x-publisher');
const FreeWillRunner = require('./free-will');
const { ResultHandler } = require('./result-handler');

class AutonomyManager {
    /**
     * @param {object} deps - 全部依賴注入
     */
    constructor(deps) {
        // 組裝子物件
        this.journal = new JournalManager();
        this.memoryLayer = new ExperienceMemoryLayer({ journal: this.journal });

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
            memory: this.memoryLayer, // 三層記憶召回
        });

        this.actions = new ActionRunner({
            journal: this.journal,
            notifier: this.notifier,
            decision: this.decision,
            brain: deps.brain,
            config: deps.CONFIG,
            memory: deps.memory,           // 舊 ExperienceMemory（供 reflect-patch 追蹤 proposal）
            memoryLayer: this.memoryLayer, // 新三層記憶召回
            skills: deps.skills,
            loadPrompt: deps.loadPrompt,
            PatchManager: deps.PatchManager,
            ResponseParser: deps.ResponseParser,
            InputFile: deps.InputFile,
            PendingPatches: deps.PendingPatches,
            googleServices: deps.googleServices, // Google 數位生活基礎設施
            xPublisher: new XPublisher({ config: deps.CONFIG }), // X 自主發文
        });

        // Coordinator 自身狀態
        this.chronos = deps.chronos;
        this.CONFIG = deps.CONFIG;
        this._timer = null;
        this.nextWakeTime = null;
        this.quietMode = false;
        this._failureTracker = new FailureTracker(this.notifier);

        this._resultHandler = new ResultHandler({
            brain: deps.brain,
            failureTracker: this._failureTracker,
            actions: this.actions,
        });

        this._freeWill = new FreeWillRunner({
            decision: this.decision,
            actions: this.actions,
            journal: this.journal,
            resultHandler: this._resultHandler,
            getQuietMode: () => this.quietMode,
        });
    }

    // === Lifecycle ===

    start() {
        if (!this.CONFIG.TG_TOKEN && !this.CONFIG.DC_TOKEN) return;
        const memDir = path.join(process.cwd(), 'memory');
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        this.chronos.rebuild();
        this.scheduleNextAwakening();
        // 啟動時若不在靜默時段且 queue 有內容，10 秒後 drain（等 bot 就緒）
        try {
            const nowHour = new Date().getHours();
            const _cfg = this.decision.loadAutonomyConfig().awakening || {};
            const _quietHours = _cfg.quietHours || _cfg.sleepHours || [];
            if (!_quietHours.includes(nowHour)) {
                setTimeout(() => this._drainAndSend(), 10000);
            }
        } catch (_) {}
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
            this._timer = setTimeout(async () => {
                const wasQuiet = this.quietMode;
                this.quietMode = isQuiet;
                this.notifier.setQuietMode(isQuiet, quietHours);

                // 靜默結束 → 立即 drain queue
                if (wasQuiet && !isQuiet) {
                    await this._drainAndSend();
                }

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
        return this._freeWill.run();
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

    async _drainAndSend() {
        const items = this.notifier.drainQuietQueue();
        if (items.length === 0) return;
        console.log(`📬 [LifeCycle] 靜默結束，發送暫存訊息共 ${items.length} 則`);
        for (const item of items) {
            try {
                await this.notifier.sendToAdmin(item.text);
                await new Promise(r => setTimeout(r, 1500));
            } catch (e) {
                console.error('[LifeCycle] drain 發送失敗:', e.message);
            }
        }
    }

    /** 老哥回應回流 — 轉發給 ActionRunner */
    onAdminReply(text) { return this.actions.onAdminReply(text); }
}

module.exports = AutonomyManager;
