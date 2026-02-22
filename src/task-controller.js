/**
 * ⚡ TaskController — 閉環回饋版 + 汙染追蹤
 * 構造注入：{ chronos, brain, skills, pendingTasks }
 */
const { v4: uuidv4 } = require('uuid');
const SecurityManager = require('./security');
const { dbg } = require('./parsers');
const { ToolScanner } = require('./tools');
const Executor = require('./executor');

class TaskController {
    constructor(deps = {}) {
        this.security = new SecurityManager();
        this._chronos = deps.chronos || null;
        this._brain = deps.brain || null;
        this._skills = deps.skills || null;
        this._pendingTasks = deps.pendingTasks || new Map();
    }

    async runSequence(ctx, steps, startIndex = 0, tainted = false, approvedIndex = -1) {
        let reportBuffer = [];
        for (let i = startIndex; i < steps.length; i++) {
            const step = steps[i];
            if (!step.cmd) {
                step.cmd = step.command || step.shell || step.action || '';
            }
            if (!step.cmd) {
                dbg('TaskCtrl', `Step ${i} 無有效指令欄位，跳過:`, JSON.stringify(step));
                reportBuffer.push(`⚠️ [Step ${i + 1}] 無法辨識指令格式: ${JSON.stringify(step).substring(0, 100)}`);
                continue;
            }

            // ⏰ golem-schedule 虛擬指令
            if (step.cmd.startsWith('golem-schedule')) {
                const parts = step.cmd.match(/^golem-schedule\s+(\w+)\s*(.*)/);
                if (!parts) {
                    reportBuffer.push('❓ 用法: golem-schedule add <分鐘> <訊息> | list | cancel <id>');
                    continue;
                }
                const [, subCmd, rest] = parts;
                if (subCmd === 'add') {
                    const addMatch = rest.match(/^(\d+)\s+(.+)/);
                    if (!addMatch) {
                        reportBuffer.push('❓ 用法: golem-schedule add <分鐘> <提醒內容>');
                    } else if (this._chronos) {
                        reportBuffer.push(this._chronos.add(addMatch[1], addMatch[2]));
                    }
                } else if (subCmd === 'list' && this._chronos) {
                    reportBuffer.push(this._chronos.list());
                } else if (subCmd === 'cancel' && this._chronos) {
                    reportBuffer.push(this._chronos.cancel(rest.trim()));
                } else {
                    reportBuffer.push('❓ 用法: golem-schedule add <分鐘> <訊息> | list | cancel <id>');
                }
                continue;
            }

            // 🔧 golem-skill 虛擬指令
            if (step.cmd.startsWith('golem-skill')) {
                const parts = step.cmd.split(/\s+/);
                const subCmd = parts[1];
                if (subCmd === 'list' && this._skills) {
                    const listing = this._skills.skillLoader.listSkills();
                    reportBuffer.push(`📦 [技能目錄]\n${listing}`);
                } else if (subCmd === 'load' && parts[2] && this._skills && this._brain) {
                    const skillName = parts[2];
                    const content = this._skills.skillLoader.loadSkill(skillName);
                    if (content) {
                        await this._brain.sendMessage(`[系統注入] 已載入技能 ${skillName}:\n${content}`, true);
                        reportBuffer.push(`✅ 技能 ${skillName} 已載入並注入當前對話`);
                    } else {
                        reportBuffer.push(`❌ 找不到技能: ${skillName}。使用 golem-skill list 查看可用技能。`);
                    }
                } else if (subCmd === 'reload' && this._skills) {
                    this._skills.skillLoader.reload();
                    reportBuffer.push('✅ 技能索引已重新掃描');
                } else {
                    reportBuffer.push('❓ 用法: golem-skill list | load <名稱> | reload');
                }
                continue;
            }

            // 🔍 golem-check 虛擬指令
            if (step.cmd.startsWith('golem-check')) {
                const toolName = step.cmd.split(' ')[1];
                if (!toolName) {
                    reportBuffer.push(`⚠️ [ToolCheck] 缺少參數。用法: golem-check <tool>`);
                } else {
                    const result = ToolScanner.check(toolName);
                    reportBuffer.push(`🔍 [ToolCheck] ${result}`);
                }
                continue;
            }

            // 🛡️ 風險評估（已批准的步驟跳過安全檢查，直接執行）
            if (i === approvedIndex) {
                dbg('Security', `[APPROVED-SKIP] ${step.cmd.substring(0, 60)}`);
            } else {
                const risk = this.security.assess(step.cmd, tainted);
                dbg('Security', `[${risk.level}] ${step.cmd.substring(0, 60)}${tainted ? ' (tainted)' : ''}`);

                if (risk.level === 'BLOCKED') {
                    return `⛔ 指令被系統攔截：${step.cmd} (原因: ${risk.reason})`;
                }
                if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                    const approvalId = uuidv4();
                    this._pendingTasks.set(approvalId, { steps, nextIndex: i, ctx, tainted });
                    const taintedNote = tainted ? '\n⚠️ **注意：此指令源自包含外部內容的上下文**' : '';
                    const confirmMsg = `${risk.level === 'DANGER' ? '🔥' : '⚠️'} **請求確認**\n指令：\`${step.cmd}\`\n風險：${risk.reason}${taintedNote}`;
                    await ctx.reply(confirmMsg, {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '✅ 批准', callback_data: `APPROVE:${approvalId}` },
                                { text: '🛡️ 駁回', callback_data: `DENY:${approvalId}` }
                            ]]
                        }
                    });
                    return null;
                }
            }

            try {
                if (!this.internalExecutor) this.internalExecutor = new Executor();
                const output = await this.internalExecutor.run(step.cmd);
                reportBuffer.push(`[Step ${i + 1} Success] cmd: ${step.cmd}\nResult/Output:\n${output.trim() || "(No stdout)"}`);
            } catch (err) {
                reportBuffer.push(`[Step ${i + 1} Failed] cmd: ${step.cmd}\nError:\n${err.message}`);
            }
        }
        return reportBuffer.join('\n\n----------------\n\n');
    }
}

module.exports = TaskController;
