/**
 * ⚡ TaskController — 閉環回饋版 + 汙染追蹤
 * 構造注入：{ chronos, brain, skills, pendingTasks }
 * 虛擬指令（golem-*）委派至 VirtualCmdHandler
 */
const { v4: uuidv4 } = require('uuid');
const SecurityManager    = require('./security');
const { dbg }            = require('./parsers');
const Executor           = require('./executor');
const VirtualCmdHandler  = require('./virtual-cmd-handler');

class TaskController {
    constructor(deps = {}) {
        this.security  = new SecurityManager();
        this._virtual  = new VirtualCmdHandler({ chronos: deps.chronos, skills: deps.skills, brain: deps.brain });
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

            // 虛擬指令（golem-schedule / golem-skill / golem-check）
            if (step.cmd.startsWith('golem-schedule') || step.cmd.startsWith('golem-skill') || step.cmd.startsWith('golem-check')) {
                reportBuffer.push(await this._virtual.run(step.cmd, ctx));
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
        const MAX_OUTPUT_PER_STEP   = 3000;
        const outputs = [];

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (!step.cmd) step.cmd = step.command || step.shell || step.action || '';
            if (!step.cmd) {
                outputs.push({ cmd: '(unknown)', ok: false, output: '無法辨識指令格式: ' + JSON.stringify(step).substring(0, 100), truncated: false });
                loopState.consecutiveFails++;
                if (loopState.consecutiveFails >= MAX_CONSECUTIVE_FAILS) return { halted: false, paused: false, failedTooMuch: true, outputs };
                continue;
            }

            // 虛擬指令
            if (step.cmd.startsWith('golem-schedule') || step.cmd.startsWith('golem-skill') || step.cmd.startsWith('golem-check')) {
                const virtualResult = await this._virtual.run(step.cmd, ctx);
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
                outputs.push({ cmd: step.cmd, ok: false, output: '⛔ 指令被系統攔截: ' + risk.reason, truncated: false });
                return { halted: true, paused: false, failedTooMuch: false, outputs };
            }

            if (risk.level === 'DANGER') {
                const approvalId = require('crypto').randomUUID();
                this._pendingTasks.set(approvalId, { type: 'REACT_DANGER_RESUME', steps: steps.slice(i), loopState, tainted });
                const taintNote  = tainted ? '\n⚠️ tainted context' : '';
                const dangerMsg  = '🔥 請求確認\n指令：' + step.cmd + '\n風險：' + risk.reason + taintNote;
                await ctx.reply(dangerMsg, { reply_markup: { inline_keyboard: [[
                    { text: '✅ 批准', callback_data: 'APPROVE:' + approvalId },
                    { text: '🛡️ 駁回', callback_data: 'DENY:' + approvalId }
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
                const raw    = await this.internalExecutor.run(step.cmd);
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
}

module.exports = TaskController;
