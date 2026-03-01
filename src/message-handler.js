/**
 * MessageHandler — 統一訊息處理（含 Titan Queue、三流解析、指令路由）
 * 依賴：brain, skills, autonomy, controller, deployActions, googleCmds, reactLoop, memory,
 *       modelRouter, pendingTasks, BOOT_TIME
 */
const fs = require('fs');
const path = require('path');
const MessageBuffer = require('./message-buffer');
const NodeRouter = require('./node-router');
const { TriStreamParser, ResponseParser, dbg } = require('./parsers');
const { loadPrompt, loadFeedbackPrompt } = require('./prompt-loader');
const { Introspection, PatchManager } = require('./upgrader');
const { OpticNerve } = require('./context');

class MessageHandler {
    constructor({ brain, skills, autonomy, controller, deployActions, googleCmds, reactLoop, memory, modelRouter, pendingTasks, BOOT_TIME }) {
        this.brain = brain;
        this.skills = skills;
        this.autonomy = autonomy;
        this.controller = controller;
        this.deployActions = deployActions;
        this.googleCmds = googleCmds;
        this.reactLoop = reactLoop;
        this.memory = memory;
        this.modelRouter = modelRouter;
        this.pendingTasks = pendingTasks;
        this.BOOT_TIME = BOOT_TIME;

        this.titanQueue = new MessageBuffer({
            debounceMs: 1500,
            onFlush: async (ctx, mergedText, hasMedia) => {
                await this._handleMessageCore(ctx, mergedText, hasMedia);
            }
        });
    }

    _isStaleMessage(ctx) {
        const msgTime = ctx.messageTime;
        if (!msgTime) return false;
        return msgTime < this.BOOT_TIME;
    }

    handleMessage(ctx) {
        if (this._isStaleMessage(ctx)) {
            const ageSec = ((Date.now() - ctx.messageTime) / 1000).toFixed(0);
            console.log(`⏭️ [FloodGuard] 丟棄過期訊息 (${ctx.platform}, age: ${ageSec}s)`);
            return;
        }

        let hasMedia = false;
        if (ctx.platform === 'telegram') {
            const msg = ctx.event.message || ctx.event.msg;
            hasMedia = !!(msg && (msg.photo || msg.document));
        } else if (ctx.platform === 'discord') {
            hasMedia = !!(ctx.event.attachments && ctx.event.attachments.size > 0);
        }

        if (!ctx.text && !hasMedia) return;
        this.titanQueue.push(ctx, hasMedia);
    }

    async _handleMessageCore(ctx, mergedText, hasMedia) {
        if (mergedText !== undefined) {
            Object.defineProperty(ctx, 'text', {
                get() { return mergedText; },
                configurable: true
            });
        }

        if (!ctx.text && !hasMedia) return;
        if (!ctx.isAdmin) return;

        if (ctx.text && this.autonomy.onAdminReply) this.autonomy.onAdminReply(ctx.text);
        if (await NodeRouter.handle(ctx, this.brain)) return;
        if (ctx.text && (ctx.text === '/list_patches' || ctx.text === '/lp')) return this.deployActions.listPatches(ctx);
        if (ctx.text === '/gmail') return this.googleCmds.gmail(ctx);
        if (ctx.text.startsWith('/calendar')) return this.googleCmds.calendar(ctx);
        if (ctx.text === '/tasks') return this.googleCmds.tasks(ctx);
        if (ctx.text.startsWith('/drive')) return this.googleCmds.drive(ctx);
        if (global.pendingPatch && ['ok', 'deploy', 'y', '部署'].includes(ctx.text.toLowerCase())) return this.deployActions.deploy(ctx);
        if (global.pendingPatch && ['no', 'drop', 'n', '丟棄'].includes(ctx.text.toLowerCase())) return this.deployActions.drop(ctx);
        if (global.pendingPatch) {
            const { name, description } = global.pendingPatch;
            await ctx.reply(`🔔 **待部署提案**\n目標：\`${name}\`\n內容：${description}\n請輸入 \`部署\` 或 \`丟棄\`。`);
        }

        if (ctx.text.startsWith('/patch') || ctx.text.includes('優化代碼')) {
            const req = ctx.text.replace('/patch', '').trim() || "優化代碼";
            await ctx.reply(`🧬 收到進化請求: ${req}`);
            const currentCode = Introspection.readSelf();
            const prompt = loadFeedbackPrompt('HOTFIX', { REQUEST: req, SOURCE_CODE: currentCode.slice(0, 15000) }) || `熱修復：${req}\n源碼前15000字\n輸出 JSON Array`;
            const raw = await this.brain.sendMessage(prompt);
            const patches = ResponseParser.extractJson(raw);
            if (patches.length > 0) {
                const patch = patches[0];
                const targetName = patch.file === 'skills.js' ? 'skills.js' : 'index.js';
                const targetPath = targetName === 'skills.js'
                    ? path.join(process.cwd(), 'skills.js')
                    : path.join(process.cwd(), 'index.js');
                const testFile = PatchManager.createTestClone(targetPath, patches);
                let isVerified = false;
                if (targetName === 'skills.js') { try { require(path.resolve(testFile)); isVerified = true; } catch (e) { console.error(e); } }
                else { isVerified = PatchManager.verify(testFile); }
                if (isVerified) {
                    const smoke = await this.deployActions.runSmokeGate();
                    if (!smoke.ok) {
                        try { fs.unlinkSync(testFile); } catch (_) {}
                        await ctx.reply(`❌ 提案中止：Smoke test 未通過\n\`\`\`\n${smoke.output.slice(-600)}\n\`\`\``);
                        return;
                    }
                    global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
                    await ctx.reply(`💡 提案就緒 (目標: ${targetName})。`, { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } });
                    await ctx.sendDocument(testFile);
                }
            }
            return;
        }

        await ctx.sendTyping();
        let steps = [];
        try {
            let finalInput = ctx.text;
            let tainted = false;

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

            if (!finalInput && !attachment) return;

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

            const raw = await this.brain.sendMessage(finalInput);
            dbg('Raw', raw);

            const parsed = TriStreamParser.parse(raw);

            if (parsed.memory) {
                await this.brain.memorize(parsed.memory, { type: 'fact', timestamp: Date.now() });
            }

            steps = parsed.actions;
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
                        const retryRaw = await this.brain.sendMessage(correctionPrompt);
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

            if (chatPart) await ctx.reply(chatPart);

            if (steps.length > 0) {
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
}

module.exports = MessageHandler;
