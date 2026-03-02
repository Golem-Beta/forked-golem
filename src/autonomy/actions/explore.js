/**
 * @module explore
 * @role 探索行動 facade — 代理至 web-research.js + github-explore.js
 * @when-to-modify 新增探索類行動時；個別流程請修改對應子模組
 *
 * 子模組：
 *   web-research.js    — performWebResearch（選題 → Grounding 搜尋 → 匯報）
 *   github-explore.js  — performGitHubExplore（GitHub API → README → LLM 分析 → 匯報）
 */
const WebResearchAction = require('./web-research');
const GitHubExploreAction = require('./github-explore');

class ExploreAction {
    constructor(deps) {
        this._webResearch = new WebResearchAction(deps);
        this._githubExplore = new GitHubExploreAction(deps);
    }

    async performWebResearch(reason) {
        return this._webResearch.performWebResearch(reason);
    }

    async performGitHubExplore() {
        return this._githubExplore.performGitHubExplore();
    }
}

module.exports = ExploreAction;
