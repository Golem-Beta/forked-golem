/**
 * ⚡ NodeRouter — 反射層（快速指令攔截）
 * 依賴注入：使用時傳入 { ctx, brain, CONFIG, HelpManager, SystemUpgrader, skills }
 */
const { HelpManager } = require('./tools');

class NodeRouter {
    static async handle(ctx, brain) {
        const text = ctx.text ? ctx.text.trim() : "";
        if (text.match(/^\/(help|menu|指令|功能)/)) { await ctx.reply(HelpManager.getManual(), { parse_mode: 'Markdown' }); return true; }


        if (text.startsWith('/patch') || text.includes('優化代碼')) return false;
        return false;
    }
}

module.exports = NodeRouter;
