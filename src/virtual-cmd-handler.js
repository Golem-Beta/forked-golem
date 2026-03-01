'use strict';
/**
 * @module virtual-cmd-handler
 * @role 處理 golem-* 虛擬指令（schedule / skill / check）
 * @when-to-modify 新增虛擬指令類型時；依賴 chronos / skills / brain，無副作用
 */
const { ToolScanner } = require('./tools');

class VirtualCmdHandler {
    constructor({ chronos, skills, brain } = {}) {
        this._chronos = chronos || null;
        this._skills  = skills  || null;
        this._brain   = brain   || null;
    }

    async run(cmd, ctx) {
        if (cmd.startsWith('golem-schedule')) return this._schedule(cmd);
        if (cmd.startsWith('golem-skill'))    return this._skill(cmd, ctx);
        if (cmd.startsWith('golem-check'))    return this._check(cmd);
        return '(unknown virtual cmd)';
    }

    _schedule(cmd) {
        const parts = cmd.match(/^golem-schedule\s+(\w+)\s*(.*)/);
        if (!parts) return '❓ golem-schedule add <分鐘> <訊息> | list | cancel <id>';
        const [, subCmd, rest] = parts;
        if (subCmd === 'add') {
            const addMatch = rest.match(/^(\d+)\s+(.+)/);
            if (!addMatch) return '❓ golem-schedule add <分鐘> <提醒內容>';
            return this._chronos ? this._chronos.add(addMatch[1], addMatch[2]) : '(chronos unavailable)';
        }
        if (subCmd === 'list')   return this._chronos ? this._chronos.list()              : '(chronos unavailable)';
        if (subCmd === 'cancel') return this._chronos ? this._chronos.cancel(rest.trim()) : '(chronos unavailable)';
        return '❓ golem-schedule add <分鐘> <訊息> | list | cancel <id>';
    }

    async _skill(cmd, ctx) {
        const parts  = cmd.split(/\s+/);
        const subCmd = parts[1];
        if (subCmd === 'list' && this._skills) {
            return `📦 [技能目錄]\n${this._skills.skillLoader.listSkills()}`;
        }
        if (subCmd === 'load' && parts[2] && this._skills && this._brain) {
            const content = this._skills.skillLoader.loadSkill(parts[2]);
            if (content) {
                await this._brain.sendMessage(`[系統注入] 已載入技能 ${parts[2]}:\n${content}`, true);
                return `✅ 技能 ${parts[2]} 已載入並注入當前對話`;
            }
            return `❌ 找不到技能: ${parts[2]}。使用 golem-skill list 查看可用技能。`;
        }
        if (subCmd === 'reload' && this._skills) {
            this._skills.skillLoader.reload();
            return '✅ 技能索引已重新掃描';
        }
        return '❓ golem-skill list | load <名稱> | reload';
    }

    _check(cmd) {
        const toolName = cmd.split(' ')[1];
        if (!toolName) return '⚠️ [ToolCheck] 缺少參數。用法: golem-check <tool>';
        return `🔍 [ToolCheck] ${ToolScanner.check(toolName)}`;
    }
}

module.exports = VirtualCmdHandler;
