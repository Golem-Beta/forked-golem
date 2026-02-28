/**
 * @module actions/index
 * @role ActionRunner barrel — 保留原始公開 API，代理至各子模組
 * @when-to-modify 新增行動類型、或調整子模組組裝方式時；個別行動邏輯請修改對應子模組
 *
 * 子模組對應：
 *   social.js        — performSpontaneousChat, onAdminReply
 *   explore.js       — performWebResearch, performGitHubExplore
 *   reflect.js       — performSelfReflection（協調 reflect-diag + reflect-patch）
 *   digest.js        — performDigest, performMorningDigest
 *   health-check.js  — performHealthCheck
 */
const SocialAction = require('./social');
const ExploreAction = require('./explore');
const ReflectAction = require('./reflect');
const DigestAction = require('./digest');
const HealthCheckAction = require('./health-check');

class ActionRunner {
    /**
     * @param {object} deps
     * @param {import('../journal')} deps.journal
     * @param {import('../notify')} deps.notifier
     * @param {import('../decision')} deps.decision
     * @param {object} deps.brain
     * @param {object} deps.config
     * @param {object} deps.memory
     * @param {object} deps.skills
     * @param {Function} deps.loadPrompt
     * @param {object} deps.PatchManager
     * @param {object} deps.ResponseParser
     * @param {Function} deps.InputFile
     */
    constructor(deps) {
        this._social       = new SocialAction(deps);
        this._explore      = new ExploreAction(deps);
        this._reflect      = new ReflectAction(deps);
        this._digest       = new DigestAction(deps);
        this._healthCheck  = new HealthCheckAction(deps);
    }

    // --- social ---
    async performSpontaneousChat()       { return this._social.performSpontaneousChat(); }
    onAdminReply(text)                   { return this._social.onAdminReply(text); }

    // --- explore ---
    async performWebResearch(reason)     { return this._explore.performWebResearch(reason); }
    async performGitHubExplore()         { return this._explore.performGitHubExplore(); }

    // --- reflect ---
    async performSelfReflection(ctx)     { return this._reflect.performSelfReflection(ctx); }

    // --- digest ---
    async performDigest()                { return this._digest.performDigest(); }
    async performMorningDigest()         { return this._digest.performMorningDigest(); }

    // --- health-check ---
    async performHealthCheck()           { return this._healthCheck.run(); }
}

module.exports = ActionRunner;
