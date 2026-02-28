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
 *   google-check.js  — performGoogleCheck
 *   drive-sync.js    — performDriveSync
 *   x-post.js        — performXPost
 */
const SocialAction = require('./social');
const ExploreAction = require('./explore');
const ReflectAction = require('./reflect');
const DigestAction = require('./digest');
const HealthCheckAction = require('./health-check');
const GoogleCheckAction = require('./google-check');
const DriveSyncAction = require('./drive-sync');
const XPostAction = require('./x-post');
const MaintenanceRunner = require('./maintenance/index');

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
        this._googleServices   = deps.googleServices || null;
        this._maintenance      = new MaintenanceRunner(deps);
    }

    // --- social ---
    async performSpontaneousChat()       { return this._social.performSpontaneousChat(); }
    onAdminReply(text)                   { return this._social.onAdminReply(text); }

    // --- explore ---
    async performWebResearch(reason)     { return this._explore.performWebResearch(reason); }

    // --- reflect ---
    async performSelfReflection(ctx) {
        const result = await this._reflect.performSelfReflection(ctx);
        if (result?.outcome && result.outcome !== 'error') {
            await this._logToCalendar('自我反思', result.outcome);
        }
        return result;
    }

    // --- explore ---（覆寫以加入 Calendar logging）
    async performGitHubExplore() {
        const result = await this._explore.performGitHubExplore();
        await this._logToCalendar('GitHub 探索', result?.topic || '探索完成');
        return result;
    }

    // --- digest ---
    async performDigest()                { return this._digest.performDigest(); }
    async performMorningDigest()         { return this._digest.performMorningDigest(); }

    // --- health-check ---
    async performHealthCheck() {
        const result = await this._healthCheck.run();
        await this._logToCalendar('健康巡查', '系統健康檢查完成');
        return result;
    }

    // --- google-check ---
    async performGoogleCheck() {
        const result = await this._googleCheck.run();
        if (result && !result.skipped) {
            const notified = result.gmail?.notified ?? 0;
            const ignored = result.gmail?.ignored ?? 0;
            await this._logToCalendar('Gmail 巡查', `通知:${notified}封, 忽略:${ignored}封`);
        }
        return result;
    }

    // --- drive-sync ---
    async performDriveSync() {
        const result = await this._driveSync.run();
        if (result && !result.skipped) {
            const up = (result.uploaded || []).length;
            const upd = (result.updated || []).length;
            await this._logToCalendar('Drive 同步', up > 0 ? `上傳${up}個, 更新${upd}個` : '無新檔案');
        }
        return result;
    }

    // --- x-post ---
    async performXPost() {
        const result = await this._xPost.performXPost();
        if (result && result.success) {
            await this._logToCalendar('X 發文', result.preview || '發文成功');
        }
        return result;
    }

    // --- calendar logging（非阻塞，失敗靜默）---
    async _logToCalendar(title, description) {
        if (!this._googleServices?._auth?.isAuthenticated()) return;
        try {
            const now = new Date();
            const end = new Date(now.getTime() + 5 * 60 * 1000);
            await this._googleServices.createEvent({
                title: `[Golem] ${title}`,
                start: now.toISOString(),
                end: end.toISOString(),
                description,
            });
        } catch (e) {
            console.warn('[ActionRunner] Calendar 寫入失敗:', e.message);
        }
    }
    // --- maintenance（自動擴展）---
    hasMaintenance(actionName)      { return this._maintenance.has(actionName); }
    async performMaintenance(actionName) {
        const result = await this._maintenance.run(actionName);
        if (result?.summary) {
            await this._logToCalendar(actionName, result.summary);
        }
        return result;
    }
}

module.exports = ActionRunner;
