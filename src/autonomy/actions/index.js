/**
 * @module actions/index
 * @role ActionRunner barrel — 保留原始公開 API，代理至各子模組
 * @when-to-modify 新增行動類型、或調整子模組組裝方式時；個別行動邏輯請修改對應子模組
 *
 * 子模組對應：
 *   social.js        — performSpontaneousChat, onAdminReply
 *   explore.js       — performWebResearch, performGitHubExplore
 *   reflect.js       — performSelfReflection（Team 框架：Analyst/Architect/Implementer/Reviewer）
 *   digest.js        — performDigest, performMorningDigest
 *   health-check.js  — performHealthCheck
 *   google-check.js  — performGoogleCheck
 *   drive-sync.js    — performDriveSync
 *   x-post.js        — performXPost
 *   threads-check.js — performThreadsCheck
 *   x-check.js       — performXCheck
 *   moltbook-check.js — performMoltbookCheck
 *   moltbook-post.js  — performMoltbookPost
 */
const SocialAction = require('./social');
const ExploreAction = require('./explore');
const ReflectAction = require('./reflect');
const DigestAction = require('./digest');
const HealthCheckAction = require('./health-check');
const GoogleCheckAction = require('./google-check');
const DriveSyncAction = require('./drive-sync');
const XPostAction = require('./x-post');
const ThreadsCheckAction = require('./threads-check');
const XCheckAction       = require('./x-check');
const MoltbookCheckAction = require('./moltbook-check');
const MoltbookPostAction  = require('./moltbook-post');
const ThreadsPostAction   = require('./threads-post');
const MaintenanceRunner = require('./maintenance/index');
const ModelBenchmarkAction = require('./model-benchmark/index');

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
     * @param {object} [deps.xPublisher] - XPublisher instance（可選，未設定時 performXPost 靜默跳過）
     */
    constructor(deps) {
        this._social           = new SocialAction(deps);
        this._explore          = new ExploreAction(deps);
        this._reflect          = new ReflectAction(deps);
        this._digest           = new DigestAction(deps);
        this._healthCheck      = new HealthCheckAction(deps);
        this._googleCheck      = new GoogleCheckAction(deps);
        this._driveSync        = new DriveSyncAction(deps);
        this._xPost            = new XPostAction(deps);
        this._threadsCheck     = new ThreadsCheckAction(deps);
        this._xCheck           = new XCheckAction(deps);
        this._moltbookCheck    = new MoltbookCheckAction(deps);
        this._modelBenchmark   = new ModelBenchmarkAction(deps);
        this._moltbookPost     = new MoltbookPostAction(deps);
        this._threadsPost      = new ThreadsPostAction(deps);
        this._maintenance      = new MaintenanceRunner(deps);
    }

    // --- social ---
    async performSpontaneousChat()       { return this._social.performSpontaneousChat(); }
    onAdminReply(text)                   { return this._social.onAdminReply(text); }

    // --- explore ---
    async performWebResearch(reason)     { return this._explore.performWebResearch(reason); }
    async performGitHubExplore()         { return this._explore.performGitHubExplore(); }
    async performModelBenchmark(opts)    { return this._modelBenchmark.run(opts); }

    // --- reflect ---
    async performSelfReflection(ctx)     { return this._reflect.performSelfReflection(ctx); }

    // --- digest ---
    async performDigest()                { return this._digest.performDigest(); }
    async performMorningDigest()         { return this._digest.performMorningDigest(); }

    // --- health-check ---
    async performHealthCheck()           { return this._healthCheck.run(); }

    // --- google-check ---
    async performGoogleCheck()           { return this._googleCheck.run(); }

    // --- drive-sync ---
    async performDriveSync()             { return this._driveSync.run(); }

    // --- x-post ---
    async performXPost()                 { return this._xPost.performXPost(); }

    // --- threads ---
    async performThreadsCheck()          { return this._threadsCheck.run(); }

    // --- x-check ---
    async performXCheck()                { return this._xCheck.run(); }

    // --- moltbook ---
    async performMoltbookCheck()         { return this._moltbookCheck.run(); }

    async performThreadsPost()           { return this._threadsPost.run(); }

    async performMoltbookPost()          { return this._moltbookPost.run(); }

    // --- maintenance（自動擴展）---
    hasMaintenance(actionName)           { return this._maintenance.has(actionName); }
    async performMaintenance(actionName) { return this._maintenance.run(actionName); }
}

module.exports = ActionRunner;
