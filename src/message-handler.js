/**
 * MessageHandler — Titan Queue 建立、routing、/patch 指令
 * 依賴：brain, skills, autonomy, controller, deployActions, googleCmds, reactLoop, memory,
 *       modelRouter, pendingTasks, BOOT_TIME
 *
 * LLM 管線（enrichment → LLM → parse → guard → execute）委派至 MessageProcessor。
 */
const fs = require('fs');
const path = require('path');
const MessageBuffer = require('./message-buffer');
const NodeRouter = require('./node-router');
const { ResponseParser } = require('./parsers');
const { loadFeedbackPrompt } = require('./prompt-loader');
const { Introspection, PatchManager } = require('./upgrader');
const MessageProcessor = require('./message-processor');

class MessageHandler {
    constructor({ brain, skills, autonomy, controller, deployActions, googleCmds, reactLoop, memory, modelRouter, pendingTasks, BOOT_TIME }) {
        this.brain         = brain;
        this.skills        = skills;
        this.autonomy      = autonomy;
        this.controller    = controller;
        this.deployActions = deployActions;
        this.googleCmds    = googleCmds;
        this.reactLoop     = reactLoop;
        this.memory        = memory;
        this.modelRouter   = modelRouter;
        this.pendingTasks  = pendingTasks;
        this.BOOT_TIME     = BOOT_TIME;

        this.processor = new MessageProcessor({ brain, skills, modelRouter, reactLoop, autonomy });

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
            return this._handlePatchCommand(ctx);
        }

        await ctx.sendTyping();
        await this.processor.process(ctx, false);
    }

    async _handlePatchCommand(ctx) {
        const req = ctx.text.replace('/patch', '').trim() || "優化代碼";
        await ctx.reply(`🧬 收到進化請求: ${req}`);
        const currentCode = Introspection.readSelf();
        const prompt = loadFeedbackPrompt('HOTFIX', { REQUEST: req, SOURCE_CODE: currentCode.slice(0, 15000) }) || `熱修復：${req}\n源碼前15000字\n輸出 JSON Array`;
        const raw = await this.brain.sendMessage(prompt);
        const patches = ResponseParser.extractJson(raw);
        if (patches.length > 0) {
            const patch      = patches[0];
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
    }
}

module.exports = MessageHandler;
