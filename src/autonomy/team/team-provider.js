'use strict';
/**
 * @module team/team-provider
 * @role 查詢可用 LLM provider 清單，提供 pick() 方法供 Team 角色互斥選擇
 * @when-to-modify 調整 provider 選擇策略（intent 預設值、排除邏輯）時
 */

class TeamProvider {
    /**
     * @param {object} modelRouter - ModelRouter 實例（需有 getAvailableProviders 方法）
     */
    constructor(modelRouter) {
        this._router = modelRouter;
    }

    /**
     * 取得指定 intent 下可用的 provider 名稱清單（依健康分數排序）
     * @param {string} [intent='analysis']
     * @returns {string[]}
     */
    getAvailable(intent = 'analysis') {
        return this._router.getAvailableProviders(intent);
    }

    /**
     * 從可用池中排除指定 provider 後，回傳最佳候選
     * 若排除後無候選，記錄警告並回傳 null
     * @param {object} [opts]
     * @param {string[]} [opts.exclude=[]] - 要排除的 provider 名稱
     * @param {string}   [opts.intent='analysis']
     * @returns {string|null}
     */
    pick({ exclude = [], intent = 'analysis' } = {}) {
        const available = this.getAvailable(intent);
        const filtered = available.filter(p => !exclude.includes(p));
        if (filtered.length === 0 && available.length > 0) {
            console.warn(`[TeamProvider] pick() 排除 [${exclude.join(',')}] 後無候選，回傳 null`);
            return null;
        }
        return filtered[0] ?? null;
    }
}

module.exports = TeamProvider;
