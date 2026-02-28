/**
 * CallbackHandler — 統一 Callback 處理（TG inline button / Discord interaction）
 * 依賴：deployActions, reactLoop, pendingTasks, brain, controller, autonomy
 */
const { TriStreamParser } = require('./parsers');
const { loadFeedbackPrompt } = require('./prompt-loader');
const { SystemUpgrader } = require('./upgrader');

class CallbackHandler {
    constructor({ deployActions, reactLoop, pendingTasks, brain, controller, autonomy }) {
        this.deployActions = deployActions;
        this.reactLoop = reactLoop;
        this.pendingTasks = pendingTasks;
        this.brain = brain;
        this.controller = controller;
        this.autonomy = autonomy;
    }

    async handle(ctx, actionData) {
        if (!ctx.isAdmin) return;

        const pendingPatches = this.deployActions.pendingPatches;

        if (actionData === 'PATCH_DEPLOY' || actionData.startsWith('PATCH_DEPLOY:')) {
            if (ctx.platform === 'telegram') ctx.event.answerCallbackQuery().catch(() => {});
            const id = actionData.includes(':') ? actionData.split(':')[1] : null;
            if (id) {
                const p = pendingPatches.getById(id);
                if (p) global.pendingPatch = { path: p.testFile, target: p.target, name: p.name, description: p.description, pendingId: p.id };
            }
            return this.deployActions.deploy(ctx);
        }

        if (actionData === 'PATCH_DROP' || actionData.startsWith('PATCH_DROP:')) {
            if (ctx.platform === 'telegram') ctx.event.answerCallbackQuery().catch(() => {});
            const id = actionData.includes(':') ? actionData.split(':')[1] : null;
            if (id) {
                const p = pendingPatches.getById(id);
                if (p) global.pendingPatch = { path: p.testFile, target: p.target, name: p.name, description: p.description, pendingId: p.id };
            }
            return this.deployActions.drop(ctx);
        }

        if (actionData === 'SYSTEM_FORCE_UPDATE') {
            try {
                if (ctx.platform === 'telegram') await ctx.instance.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ctx.chatId, message_id: ctx.event.message.message_id });
                else await ctx.event.update({ components: [] });
            } catch (e) { }
            return SystemUpgrader.performUpdate(ctx);
        }

        if (actionData === 'SYSTEM_UPDATE_CANCEL') return ctx.reply("已取消更新操作。");

        if (actionData.includes(':')) {
            const [action, taskId] = actionData.split(':');
            const task = this.pendingTasks.get(taskId);
            try {
                if (ctx.platform === 'telegram') await ctx.instance.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ctx.chatId, message_id: ctx.event.message.message_id });
                else await ctx.event.update({ components: [] });
            } catch (e) { }

            if (action === 'REACT_CONTINUE') {
                if (!task || task.type !== 'REACT_CONTINUE') return ctx.reply('⚠️ 任務已失效');
                this.pendingTasks.delete(taskId);
                task.loopState.stepCount = 0;
                await ctx.reply('▶️ 繼續執行中...');
                await this.reactLoop.run(ctx, task.steps || [], task.tainted, task.autonomy || this.autonomy, task.loopState);
                return;
            }

            if (action === 'REACT_STOP') {
                if (!task) return ctx.reply('⚠️ 任務已失效');
                this.pendingTasks.delete(taskId);
                this.reactLoop.writeJournal(task.loopState, task.autonomy || this.autonomy);
                const summary = (task.loopState.stepLog || []).map(s => (s.ok ? '✅' : '❌') + ' ' + s.cmd).join('\n') || '(無執行記錄)';
                await ctx.reply('⏹️ 已停止。執行摘要：\n' + summary);
                return;
            }

            if (action === 'APPROVE' && task && task.type === 'REACT_DANGER_RESUME') {
                this.pendingTasks.delete(taskId);
                await ctx.reply('✅ 授權通過，繼續執行...');
                await ctx.sendTyping();
                await this.reactLoop.run(ctx, task.steps, task.tainted, task.autonomy || this.autonomy, task.loopState);
                return;
            }

            if (!task) return ctx.reply('⚠️ 任務已失效');

            if (action === 'DENY') {
                this.pendingTasks.delete(taskId);
                await ctx.reply('🛡️ 操作駁回');
            } else if (action === 'APPROVE') {
                const { steps, nextIndex, tainted } = task;
                this.pendingTasks.delete(taskId);
                await ctx.reply('✅ 授權通過，執行中...');
                await ctx.sendTyping();
                const observation = await this.controller.runSequence(ctx, steps, nextIndex, tainted || false, nextIndex);
                if (observation) {
                    const feedbackPrompt = loadFeedbackPrompt('APPROVED_FEEDBACK', { OBSERVATION: observation }) || `[Approved]\n${observation}\nReport in Traditional Chinese.`;
                    const finalResponse = await this.brain.sendMessage(feedbackPrompt);
                    const r2 = TriStreamParser.parse(finalResponse);
                    if (r2.memory) await this.brain.memorize(r2.memory, { type: 'fact', timestamp: Date.now() });
                    const r2Reply = r2.reply || (r2.hasStructuredTags ? null : finalResponse);
                    if (r2Reply) await ctx.reply(r2Reply);
                }
            }
        }
    }
}

module.exports = CallbackHandler;
