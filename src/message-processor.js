/**
 * @module message-processor
 * @role 訊息 LLM 管線 — input enrichment、LLM 呼叫、三流解析、HallucinationGuard、reactLoop
 * @when-to-modify 調整 RAG 注入邏輯、coherence 修正、HallucinationGuard 策略時
 *
 * 由 MessageHandler 在 Titan Queue flush 後呼叫。
 * 接受 ctx + tainted flag，負責 L119-L279 的 try/catch 主流程。
 */
'use strict';

const { TriStreamParser, ResponseParser, dbg } = require('./parsers');
const { loadPrompt, loadFeedbackPrompt } = require('./prompt-loader');
const { OpticNerve } = require('./context');

class MessageProcessor {
    constructor({ brain, skills, modelRouter, reactLoop, autonomy }) {
        this.brain       = brain;
        this.skills      = skills;
        this.modelRouter = modelRouter;
        this.reactLoop   = reactLoop;
        this.autonomy    = autonomy;
    }

    async process(ctx, tainted) {
        let steps = [];
        try {
            let finalInput = ctx.text;

            finalInput = await this._enrichInput(ctx, finalInput);
            if (finalInput === null) return; // abort（vision/attachment 無內容）

            const raw = await this.brain.sendMessage(finalInput);
            dbg('Raw', raw);

            const { steps: parsedSteps, chatPart } = await this._processLLMResponse(raw, ctx);
            steps = parsedSteps;

            if (chatPart) await ctx.reply(chatPart);

            if (steps.length > 0) {
                steps = await this._filterHallucinations(steps, ctx);
            }

            if (steps.length > 0) {
                await this.reactLoop.run(ctx, steps, tainted, this.autonomy);
            } else if (!chatPart) {
                await ctx.reply(raw);
            }
        } catch (e) { console.error(e); await ctx.reply(`❌ 錯誤: ${e.message}`); }

        try {
            if (ctx.isAdmin && ctx.text && this.autonomy) {
                if (steps.length === 0) {
                    this.autonomy.appendJournal({
                        action: 'conversation',
                        preview: ctx.text.substring(0, 80)
                    });
                }
            }
        } catch (_) { /* 靜默失敗 */ }
    }

    // ── Input Enrichment ──────────────────────────────────────────────────────

    async _enrichInput(ctx, initialInput) {
        let finalInput = initialInput;

        const replyCtx = ctx.replyText;
        if (replyCtx) {
            finalInput = loadPrompt('reply-context.md', {
                REPLY_TEXT: replyCtx.substring(0, 2000),
                USER_TEXT: ctx.text
            }) || `[引用] ${replyCtx.substring(0, 2000)}\n[回覆] ${ctx.text}`;
            console.log(`📎 [Reply] 注入被引用訊息 (${replyCtx.length} chars)`);
        }

        const attachment = await ctx.getAttachment();
        if (attachment) {
            await ctx.reply("👁️ 正在透過 OpticNerve 分析檔案，請稍候...");
            const analysis = await OpticNerve.analyze(attachment.url, attachment.mimeType, this.modelRouter);
            finalInput = loadPrompt('vision-injection.md', {
                MIME_TYPE: attachment.mimeType,
                ANALYSIS: analysis,
                USER_TEXT: ctx.text || '(無文字)'
            }) || `[視覺分析] ${analysis}\n使用者：${ctx.text || '(無文字)'}`;
            console.log("👁️ [Vision] 分析報告已注入 Prompt");
        }

        if (!finalInput && !attachment) return null;

        try {
            const queryForMemory = ctx.text || "image context";
            const memories = await this.brain.recall(queryForMemory);
            if (memories.length > 0) {
                const memoryText = memories.map(m => `• ${m.text}`).join('\n');
                finalInput = loadPrompt('rag-injection.md', {
                    MEMORIES: memoryText,
                    USER_INPUT: finalInput
                }) || `[記憶] ${memoryText}\n[訊息] ${finalInput}`;
                console.log(`🧠 [RAG] 已注入 ${memories.length} 條記憶`);
            }
        } catch (e) { console.warn("記憶檢索失敗 (跳過):", e.message); }

        const matchedSkills = this.skills.skillLoader.matchByKeywords(finalInput);
        if (matchedSkills.length > 0) {
            for (const skillName of matchedSkills) {
                const content = this.skills.skillLoader.loadSkill(skillName);
                if (content) {
                    await this.brain.sendMessage(`[系統注入] 偵測到相關技能 ${skillName}，已自動載入:\n${content}`, true);
                    dbg('SkillRouter', `自動注入: ${skillName}`);
                }
            }
        }

        return finalInput;
    }

    // ── LLM + TriStreamParser + Coherence 自我修正 ───────────────────────────

    async _processLLMResponse(raw, ctx) {
        const parsed = TriStreamParser.parse(raw);

        if (parsed.memory) {
            await this.brain.memorize(parsed.memory, { type: 'fact', timestamp: Date.now() });
        }

        let steps    = parsed.actions;
        let chatPart = parsed.reply;
        dbg('ActionFlow', `steps.length=${steps.length} hasStructuredTags=${parsed.hasStructuredTags} steps=${JSON.stringify(steps)}`);

        if (steps.length === 0 && parsed.hasStructuredTags) {
            const shellPrefixes = ['ls', 'cd', 'cat', 'echo', 'pwd', 'mkdir', 'rm', 'cp', 'mv',
                'git', 'node', 'npm', 'python', 'pip', 'curl', 'wget', 'find', 'grep',
                'chmod', 'chown', 'tail', 'head', 'df', 'free', 'ps', 'kill', 'pkill',
                'whoami', 'uname', 'date', 'golem-check', 'lsof', 'top', 'which',
                'touch', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'docker', 'ffmpeg',
                'fastfetch', 'neofetch', 'htop', 'systemctl', 'journalctl'];
            const impliedCmds = [...(parsed.reply || '').matchAll(/`([^`]+)`/g)]
                .map(m => m[1].trim())
                .filter(cmd => {
                    if (cmd.length < 2 || cmd.length > 200) return false;
                    if (/^[\u4e00-\u9fff]/.test(cmd)) return false;
                    const base = cmd.split(/\s+/)[0].toLowerCase();
                    return shellPrefixes.includes(base);
                });

            if (impliedCmds.length > 0) {
                dbg('Coherence', `偵測到 REPLY/ACTION 不一致: REPLY 提到 [${impliedCmds.join(', ')}] 但 ACTION_PLAN 為空`);
                await ctx.reply("⚠️ 偵測到回應格式異常（行動計劃為空但回覆中提到指令），正在自我修正...");
                await ctx.sendTyping();
                const impliedCmdsStr = impliedCmds.map(c => '`' + c + '`').join(', ');
                const correctionPrompt = loadFeedbackPrompt('COHERENCE_CORRECTION', {
                    IMPLIED_CMDS: impliedCmdsStr,
                    FIRST_CMD: impliedCmds[0]
                }) || `[Format Correction] 把 ${impliedCmdsStr} 放進 ACTION_PLAN JSON Array。`;
                try {
                    const retryRaw    = await this.brain.sendMessage(correctionPrompt);
                    dbg('Retry', retryRaw.substring(0, 400));
                    const retryParsed = TriStreamParser.parse(retryRaw);
                    if (retryParsed.actions.length > 0) {
                        console.log(`✅ [Coherence] 自我修正成功，取得 ${retryParsed.actions.length} 個行動`);
                        steps = retryParsed.actions;
                        if (retryParsed.reply) chatPart = retryParsed.reply;
                    } else {
                        console.warn("⚠️ [Coherence] 自我修正失敗，ACTION_PLAN 仍為空");
                        await ctx.reply(`⚠️ 自我修正未成功。如果你需要我執行指令，可以直接說「執行 ${impliedCmds[0]}」。`);
                    }
                } catch (retryErr) {
                    console.error("❌ [Coherence] 重試失敗:", retryErr.message);
                    await ctx.reply("❌ 自我修正時發生錯誤，請重新下達指令。");
                }
            }
        } else if (steps.length === 0 && !parsed.hasStructuredTags) {
            steps = ResponseParser.extractJson(raw);
            if (steps.length > 0) dbg('Fallback', `No tri-stream tags, extractJson got ${steps.length} cmds`);
        }

        return { steps, chatPart };
    }

    // ── HallucinationGuard ────────────────────────────────────────────────────

    async _filterHallucinations(steps, ctx) {
        try {
            const userMsg = (ctx._text || "").substring(0, 300);
            const cmds = steps.map((s, i) => i + ": " + s.cmd).join("\n");
            const guardPrompt = [
                "User message: \"" + userMsg.replace(/"/g, "\x27") + "\"",
                "AI generated these commands:", cmds, "",
                "Which commands did the user EXPLICITLY request or clearly imply?",
                "Commands the AI invented on its own (not requested) should be dropped.",
                "Reply ONLY a JSON object: {\"keep\":[indices],\"drop\":[indices]}",
                "Example: {\"keep\":[0],\"drop\":[1,2]}"
            ].join("\n");
            const guardResult = await this.modelRouter.complete({ intent: "utility", messages: [{ role: "user", content: guardPrompt }], maxTokens: 100, temperature: 0 });
            const guardJson = (guardResult || "").replace(/```json|```/g, "").trim();
            try {
                const verdict = JSON.parse(guardJson);
                const dropSet = new Set(verdict.drop || []);
                if (dropSet.size > 0) {
                    const dropped = steps.filter((_, i) => dropSet.has(i));
                    steps = steps.filter((_, i) => !dropSet.has(i));
                    console.log("\ud83d\udee1\ufe0f [HallucinationGuard] 過濾 " + dropped.length + " 個幻覺指令: " + dropped.map(s => s.cmd).join(", "));
                }
            } catch (parseErr) {
                dbg("HallucinationGuard", "JSON parse failed, executing all:", parseErr.message);
            }
        } catch (guardErr) {
            console.warn("\u26a0\ufe0f [HallucinationGuard] 判斷失敗，照常執行:", guardErr.message);
        }
        return steps;
    }
}

module.exports = MessageProcessor;
