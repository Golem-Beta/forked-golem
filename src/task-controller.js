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
    async runStepBatch(ctx, steps, loopState, tainted = false) {
        const MAX_CONSECUTIVE_FAILS = 3;
        const MAX_OUTPUT_PER_STEP = 3000;
        const outputs = [];

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (!step.cmd) step.cmd = step.command || step.shell || step.action || '';
            if (!step.cmd) {
                outputs.push({ cmd: '(unknown)', ok: false, output: '\u7121\u6cd5\u8fa8\u8b58\u6307\u4ee4\u683c\u5f0f: ' + JSON.stringify(step).substring(0, 100), truncated: false });
                loopState.consecutiveFails++;
                if (loopState.consecutiveFails >= MAX_CONSECUTIVE_FAILS) return { halted: false, paused: false, failedTooMuch: true, outputs };
                continue;
            }

            if (step.cmd.startsWith('golem-schedule') || step.cmd.startsWith('golem-skill') || step.cmd.startsWith('golem-check')) {
                const virtualResult = await this._runVirtualCmd(step.cmd, ctx);
                outputs.push({ cmd: step.cmd, ok: true, output: virtualResult, truncated: false });
                loopState.executedCmds.add(step.cmd);
                loopState.stepLog.push({ cmd: step.cmd, ok: true, outputSummary: virtualResult.substring(0, 80) });
                loopState.stepCount++;
                loopState.consecutiveFails = 0;
                continue;
            }

            const risk = this.security.assess(step.cmd, tainted);
            dbg('Security', '[' + risk.level + '] ' + step.cmd.substring(0, 60) + (tainted ? ' (tainted)' : ''));

            if (risk.level === 'BLOCKED') {
                outputs.push({ cmd: step.cmd, ok: false, output: '\u26d4 \u6307\u4ee4\u88ab\u7cfb\u7d71\u6514\u622a: ' + risk.reason, truncated: false });
                return { halted: true, paused: false, failedTooMuch: false, outputs };
            }

            if (risk.level === 'DANGER') {
                const approvalId = require('crypto').randomUUID();
                this._pendingTasks.set(approvalId, { type: 'REACT_DANGER_RESUME', steps: steps.slice(i), loopState, tainted });
                const taintNote = tainted ? '\n\u26a0\ufe0f tainted context' : '';
                const dangerMsg = '\ud83d\udd25 \u8acb\u6c42\u78ba\u8a8d\n\u6307\u4ee4\uff1a' + step.cmd + '\n\u98a8\u96aa\uff1a' + risk.reason + taintNote;
                await ctx.reply(dangerMsg, { reply_markup: { inline_keyboard: [[
                    { text: '\u2705 \u6279\u51c6', callback_data: 'APPROVE:' + approvalId },
                    { text: '\ud83d\udee1\ufe0f \u99b4\u56de', callback_data: 'DENY:' + approvalId }
                ]]}});
                return { halted: false, paused: true, failedTooMuch: false, outputs };
            }

            if (risk.level === 'WARNING') {
                loopState.skippedCmds.push(step.cmd);
                dbg('Security', '[WARNING-SKIP] ' + step.cmd);
                continue;
            }

            try {
                if (!this.internalExecutor) this.internalExecutor = new Executor();
                const raw = await this.internalExecutor.run(step.cmd);
                const output = raw.trim() || '(No stdout)';
                const truncated = output.length > MAX_OUTPUT_PER_STEP;
                outputs.push({ cmd: step.cmd, ok: true, output: output.substring(0, MAX_OUTPUT_PER_STEP), truncated });
                loopState.executedCmds.add(step.cmd);
                loopState.stepLog.push({ cmd: step.cmd, ok: true, outputSummary: output.substring(0, 80).replace(/\n/g, ' ') });
                loopState.stepCount++;
                loopState.consecutiveFails = 0;
            } catch (err) {
                outputs.push({ cmd: step.cmd, ok: false, output: err.message, truncated: false });
                loopState.stepLog.push({ cmd: step.cmd, ok: false, outputSummary: err.message.substring(0, 80) });
                loopState.stepCount++;
                loopState.consecutiveFails++;
                if (loopState.consecutiveFails >= MAX_CONSECUTIVE_FAILS) return { halted: false, paused: false, failedTooMuch: true, outputs };
            }
        }
        return { halted: false, paused: false, failedTooMuch: false, outputs };
    }

    async _runVirtualCmd(cmd, ctx) {
        if (cmd.startsWith('golem-schedule')) {
            const parts = cmd.match(/^golem-schedule\s+(\w+)\s*(.*)/);
            if (!parts) return '\u2753 golem-schedule add <min> <msg> | list | cancel <id>';
            const [, subCmd, rest] = parts;
            if (subCmd === 'add') {
                const addMatch = rest.match(/^(\d+)\s+(.+)/);
                if (!addMatch) return '\u2753 golem-schedule add <min> <content>';
                return this._chronos ? this._chronos.add(addMatch[1], addMatch[2]) : '(chronos unavailable)';
            } else if (subCmd === 'list') return this._chronos ? this._chronos.list() : '(chronos unavailable)';
            else if (subCmd === 'cancel') return this._chronos ? this._chronos.cancel(rest.trim()) : '(chronos unavailable)';
            return '\u2753 golem-schedule add <min> <msg> | list | cancel <id>';
        }
        if (cmd.startsWith('golem-skill')) {
            const parts = cmd.split(/\s+/);
            const subCmd = parts[1];
            if (subCmd === 'list' && this._skills) return '\ud83d\udce6 Skills:\n' + this._skills.skillLoader.listSkills();
            if (subCmd === 'load' && parts[2] && this._skills && this._brain) {
                const content = this._skills.skillLoader.loadSkill(parts[2]);
                if (content) { await this._brain.sendMessage('[inject] ' + parts[2] + ':\n' + content, true); return '\u2705 ' + parts[2] + ' loaded'; }
                return '\u274c not found: ' + parts[2];
            }
            if (subCmd === 'reload' && this._skills) { this._skills.skillLoader.reload(); return '\u2705 reloaded'; }
            return '\u2753 golem-skill list | load <name> | reload';
        }
        if (cmd.startsWith('golem-check')) {
            const toolName = cmd.split(' ')[1];
            if (!toolName) return '\u26a0\ufe0f [ToolCheck] missing arg';
            const { ToolScanner } = require('./tools');
            return '\ud83d\udd0d [ToolCheck] ' + ToolScanner.check(toolName);
        }
        return '(unknown virtual cmd)';
    }

}

module.exports = TaskController;
