'use strict';
/**
 * @module maintenance/index
 * @role 自動掃描 maintenance/ 目錄，載入所有 MaintenanceAction 子類
 * 新增 action 只需：
 *   1. 在此目錄新建 xxx.js，繼承 MaintenanceAction，實作 run()
 *   2. 在 autonomy.json actions 加入對應 key + desc
 *   ActionRunner 會自動發現並注冊，無需手動修改任何其他檔案
 */
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['index.js', 'base.js']);

class MaintenanceRunner {
    constructor(deps) {
        this._deps = deps;
        this._actions = {};
        this._load();
    }

    _load() {
        const dir = __dirname;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !SKIP.has(f));
        for (const file of files) {
            try {
                const Cls = require(path.join(dir, file));
                const instance = new Cls(this._deps);
                this._actions[instance.actionName] = instance;
            } catch (e) {
                console.warn(`[MaintenanceRunner] 載入 ${file} 失敗:`, e.message);
            }
        }
        console.log(`🔧 [MaintenanceRunner] 載入 ${Object.keys(this._actions).length} 個 maintenance actions: ${Object.keys(this._actions).join(', ')}`);
    }

    /** 檢查某個 action name 是否屬於 maintenance */
    has(actionName) {
        return actionName in this._actions;
    }

    /** 執行 maintenance action */
    async run(actionName) {
        const action = this._actions[actionName];
        if (!action) throw new Error(`[MaintenanceRunner] 未知 action: ${actionName}`);
        return action.run();
    }
}

module.exports = MaintenanceRunner;
