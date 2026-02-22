/**
 * ⚡ NodeRouter — 反射層（快速指令攔截）
 * 依賴注入：使用時傳入 { ctx, brain, CONFIG, HelpManager, SystemUpgrader, skills }
 */
const CONFIG = require('./config');
const { HelpManager } = require('./tools');
const { SystemUpgrader } = require('./upgrader');
const skills = require('./skills');

class NodeRouter {
    static async handle(ctx, brain) {
        const text = ctx.text ? ctx.text.trim() : "";
        if (text.match(/^\/(help|menu|指令|功能)/)) { await ctx.reply(HelpManager.getManual(), { parse_mode: 'Markdown' }); return true; }

        if (text === '/donate' || text === '/support' || text === '贊助') {
            await ctx.reply(`☕ **感謝您的支持心意！**\n\n您的支持是 Golem 持續進化的動力來源。\n您可以透過以下連結請我的創造者喝杯咖啡：\n\n${CONFIG.DONATE_URL}\n\n(Golem 覺得開心 🤖❤️)`);
            return true;
        }

        if (text === '/update' || text === '/reset' || text === '系統更新') {
            await ctx.reply("⚠️ **系統更新警告**\n這將從 GitHub 強制覆蓋本地代碼。\n請確認您的 GitHub 上的程式碼是可運行的。", {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔥 確認更新', callback_data: 'SYSTEM_FORCE_UPDATE' },
                        { text: '❌ 取消', callback_data: 'SYSTEM_UPDATE_CANCEL' }
                    ]]
                }
            });
            return true;
        }

        if (text.startsWith('/callme')) {
            const newName = text.replace('/callme', '').trim();
            if (newName) {
                skills.persona.setName('user', newName);
                await brain.init(true);
                await ctx.reply(`👌 了解，以後叫你 **${newName}**。`, { parse_mode: "Markdown" });
                return true;
            }
        }
        if (text.startsWith('/patch') || text.includes('優化代碼')) return false;
        return false;
    }
}

module.exports = NodeRouter;
