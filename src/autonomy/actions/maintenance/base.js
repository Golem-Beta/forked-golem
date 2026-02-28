'use strict';
/**
 * @module maintenance/base
 * @role MaintenanceAction 基底類別
 * 所有 maintenance action 繼承此類，實作 run() 即可。
 * run() 必須回傳 { success, summary, ...detail }
 * summary 用於 journal 記錄與 Calendar log。
 */
class MaintenanceAction {
    /**
     * @param {object} deps - ActionRunner deps（journal, notifier, config, ...）
     * @param {string} actionName - autonomy.json 對應的 key
     */
    constructor(deps, actionName) {
        this.deps = deps;
        this.actionName = actionName;
        this.journal = deps.journal;
        this.notifier = deps.notifier;
    }

    /** @abstract */
    async run() {
        throw new Error(`[${this.actionName}] run() not implemented`);
    }

    /** 統一 journal 記錄 */
    _record(outcome, extra = {}) {
        this.journal.append({ action: this.actionName, outcome, ...extra });
    }
}

module.exports = MaintenanceAction;
