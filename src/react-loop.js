/**
 * ReactLoop — 多步驟指令執行與 LLM 反思
 * 依賴：controller (TaskController), brain (GolemBrain), pendingTasks (Map)
 */
const { loadFeedbackPrompt } = require('./prompt-loader');
const { TriStreamParser } = require('./parsers');

class ReactLoop {
    constructor({ controller, brain, pendingTasks }) {
        this.controller = controller;
        this.brain = brain;
        this.pendingTasks = pendingTasks;
    }

    _buildStepSummary(stepLog) {
        if (!stepLog || stepLog.length === 0) return "(no steps yet)";
        return stepLog.map((s, i) => {
            const sm = s.outputSummary ? " (" + s.outputSummary.replace(/\n/g, " ").substring(0, 60) + ")" : "";
            return "Step " + (i + 1) + ": " + s.cmd + " -> " + (s.ok ? "OK" : "FAILED") + sm;
        }).join("\n");
    }

    _buildObservation(outputs, stepLog, OBS_FULL_WINDOW) {
        const lines = [];
        const oldSteps = stepLog.slice(0, -OBS_FULL_WINDOW);
        if (oldSteps.length > 0) {
            lines.push("[History]");
            for (const s of oldSteps) {
                lines.push("- " + s.cmd + " -> " + (s.ok ? "OK" : "FAILED") + (s.outputSummary ? " (" + s.outputSummary + ")" : ""));
            }
        }
        lines.push("[Latest]");
        for (const o of outputs) {
            lines.push("$ " + o.cmd);
            lines.push(o.output + (o.truncated ? "...(truncated)" : ""));
            lines.push("---");
        }
        return lines.join("\n");
    }

    writeJournal(loopState, autonomy) {
        if (!autonomy) return;
        const successSteps = loopState.stepLog.filter(s => s.ok).length;
        const failedSteps = loopState.stepLog.filter(s => !s.ok).length;
        const summary = loopState.stepLog.slice(0, 10).map(s => s.cmd.substring(0, 30) + (s.ok ? "" : " [F]")).join(" | ");
        autonomy.appendJournal({
            action: "conversation",
            loop_steps: loopState.stepCount,
            loop_success: successSteps,
            loop_failed: failedSteps,
            step_summary: summary || undefined,
            skipped_cmds: loopState.skippedCmds.length > 0 ? loopState.skippedCmds : undefined,
            outcome: loopState.stepCount > 0 ? "loop_completed" : "done",
            duration_ms: Date.now() - loopState.startTs
        });
    }

    async run(ctx, initialSteps, tainted, autonomy, loopState) {
        const MAX_AUTO_STEPS = 10;
        const OBS_FULL_WINDOW = 3;
        if (!loopState) {
            loopState = { stepCount: 0, consecutiveFails: 0, executedCmds: new Set(), stepLog: [], skippedCmds: [], startTs: Date.now() };
        }
        let steps = initialSteps;
        while (true) {
            const batchResult = await this.controller.runStepBatch(ctx, steps, loopState, tainted);
            if (batchResult.halted) break;
            if (batchResult.paused) return;
            if (batchResult.failedTooMuch) {
                await ctx.reply("⚠️ 3 consecutive failures, pausing. Steps done: " + loopState.stepCount);
                break;
            }
            if (loopState.stepCount >= MAX_AUTO_STEPS) {
                const taskId = require("crypto").randomUUID();
                this.pendingTasks.set(taskId, {
                    type: "REACT_CONTINUE", steps: [], loopState, tainted, autonomy,
                    expireAt: Date.now() + 30 * 60 * 1000
                });
                await ctx.reply("⏸️ " + loopState.stepCount + " steps done, continue?", {
                    reply_markup: { inline_keyboard: [[
                        { text: "▶️ Continue", callback_data: "REACT_CONTINUE:" + taskId },
                        { text: "⏹️ Stop",     callback_data: "REACT_STOP:" + taskId }
                    ]]}
                });
                return;
            }
            const observation = this._buildObservation(batchResult.outputs, loopState.stepLog, OBS_FULL_WINDOW);
            const stepSummary = this._buildStepSummary(loopState.stepLog);
            let reactPrompt = loadFeedbackPrompt("REACT_STEP", {
                STEP_COUNT: String(loopState.stepCount), OBSERVATION: observation, STEP_SUMMARY: stepSummary
            });
            if (!reactPrompt) reactPrompt = "[Observation] " + observation + " Reply in Traditional Chinese.";
            const response = await this.brain.sendMessage(reactPrompt);
            const parsed = TriStreamParser.parse(response);
            if (parsed.memory) await this.brain.memorize(parsed.memory, { type: "fact", timestamp: Date.now() });
            const replyText = parsed.reply || (parsed.hasStructuredTags ? null : response);
            if (replyText) await ctx.reply(replyText);
            if (!parsed.actions || parsed.actions.length === 0) break;
            const newSteps = parsed.actions.filter(s => s && s.cmd && !loopState.executedCmds.has(s.cmd));
            if (newSteps.length === 0) break;
            steps = newSteps;
            await ctx.sendTyping();
        }
        this.writeJournal(loopState, autonomy);
        if (loopState.skippedCmds.length > 0) {
            const skippedList = loopState.skippedCmds.map(c => "- " + c).join("\n");
            await ctx.reply("⚠️ WARNING cmds skipped (manual confirm needed):\n" + skippedList);
        }
    }
}

module.exports = ReactLoop;
