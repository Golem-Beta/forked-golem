/**
 * DeployActions — Patch 部署、丟棄、清單
 * 依賴：memory, autonomy, pendingPatches, brain
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

class DeployActions {
    constructor({ memory, autonomy, pendingPatches, brain }) {
        this.memory = memory;
        this.autonomy = autonomy;
        this.pendingPatches = pendingPatches;
        this.brain = brain;
    }

    async runSmokeGate() {
        return new Promise((resolve) => {
            const child = spawn('node', ['test-smoke.js'], { cwd: process.cwd(), stdio: 'pipe' });
            let output = '';
            child.stdout.on('data', d => { output += d.toString(); });
            child.stderr.on('data', d => { output += d.toString(); });
            child.on('close', code => resolve({ ok: code === 0, output }));
            child.on('error', err => resolve({ ok: false, output: err.message }));
        });
    }

    async deploy(ctx) {
        if (!global.pendingPatch) return;
        try {
            const { path: patchPath, target: targetPath, name: targetName } = global.pendingPatch;
            const smoke = await this.runSmokeGate();
            if (!smoke.ok) {
                try { fs.unlinkSync(patchPath); } catch (_) {}
                if (global.pendingPatch && global.pendingPatch.pendingId) {
                    this.pendingPatches.resolve(global.pendingPatch.pendingId, 'smoke_failed');
                }
                global.pendingPatch = null;
                await ctx.reply(`❌ 部署中止：Smoke test 未通過\n\`\`\`\n${smoke.output.slice(-600)}\n\`\`\``);
                return;
            }
            fs.copyFileSync(targetPath, `${targetName}.bak-${Date.now()}`);
            fs.writeFileSync(targetPath, fs.readFileSync(patchPath));
            fs.unlinkSync(patchPath);
            const patchDesc = global.pendingPatch.description || '(no description)';
            if (global.pendingPatch.pendingId) {
                this.pendingPatches.resolve(global.pendingPatch.pendingId, 'deployed');
            }
            const patchSnapshot = { ...global.pendingPatch };
            global.pendingPatch = null;
            this.memory.recordSuccess();
            this.autonomy.appendJournal({ action: 'self_reflection_feedback', outcome: 'deployed', target: targetName, description: patchDesc });
            try {
                execSync(`git -C "${process.cwd()}" add "${targetPath}"`);
                execSync(`git -C "${process.cwd()}" commit -m "feat(self_reflection): ${patchDesc.substring(0, 60)}"`);
                execSync(`git -C "${process.cwd()}" push`, { timeout: 15000 });
                console.log('[Deploy] git commit+push OK');
            } catch (gitErr) {
                console.error('[Deploy] git failed:', gitErr.message);
            }
            try {
                const synthResult = await this._generateSynthesis(patchSnapshot);
                if (synthResult) {
                    const synthDir = path.join(process.cwd(), 'memory', 'synthesis');
                    if (!fs.existsSync(synthDir)) fs.mkdirSync(synthDir, { recursive: true });
                    const synthFilename = 'self-reflection-' + new Date().toISOString().replace(/[:.]/g, '-') + '.md';
                    fs.writeFileSync(path.join(synthDir, synthFilename), synthResult);
                    const reflPath = this.autonomy.decision.saveReflection('self-reflection-deploy', synthResult);
                    if (reflPath) {
                        this.autonomy.memoryLayer.addReflection(path.basename(reflPath));
                    }
                    console.log('[Deploy] synthesis 已存入 memory/synthesis/' + synthFilename);
                }
            } catch (synthErr) {
                console.error('[Deploy] synthesis 回寫失敗（不影響部署）:', synthErr.message);
            }
            await ctx.reply(`🚀 ${targetName} 升級成功！正在重啟...`);
            setTimeout(() => process.exit(0), 1500);
        } catch (e) { await ctx.reply(`❌ 部署失敗: ${e.message}`); }
    }

    async _generateSynthesis(patch) {
        if (!patch) return null;
        let soul = '';
        try { soul = fs.readFileSync(path.join(process.cwd(), 'soul.md'), 'utf-8'); } catch (e) { }
        const prompt = [
            '你是 Golem，剛剛成功部署了一個自我改進的 patch。',
            '請用 Markdown 寫一份簡短的「成果歸納」文件，記錄這次改進的本質。',
            '', '【部署描述】', patch.description || '(無描述)',
            '【修改目標】', patch.name || patch.target || '(未知)',
            '', '【靈魂文件摘要】', soul.substring(0, 300),
            '', '【要求】',
            '- 第一行是 # 標題（簡述這次改進的核心）',
            '- 說明：改了什麼、為什麼、解決了什麼問題',
            '- 最後加 ## 摘要 段落（2-3 句話）',
            '- 用繁體中文，200 字以內，不要廢話',
        ].join('\n');
        const result = await this.brain.router.complete({
            intent: 'utility',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 512,
            temperature: 0.7,
        });
        return result && result.text ? result.text : null;
    }

    async drop(ctx) {
        if (!global.pendingPatch) return;
        try { fs.unlinkSync(global.pendingPatch.path); } catch (e) { }
        const patchDesc = global.pendingPatch ? global.pendingPatch.description || '(no description)' : '?';
        if (global.pendingPatch && global.pendingPatch.pendingId) {
            this.pendingPatches.resolve(global.pendingPatch.pendingId, 'dropped');
        }
        global.pendingPatch = null;
        this.memory.recordRejection();
        this.autonomy.appendJournal({ action: 'self_reflection_feedback', outcome: 'dropped', description: patchDesc });
        await ctx.reply("🗑️ 提案已丟棄");
    }

    async listPatches(ctx) {
        const pending = this.pendingPatches.listPending();
        if (pending.length === 0) {
            await ctx.reply('✅ 目前沒有待審提案');
            return;
        }
        await ctx.reply(`📋 待審提案共 ${pending.length} 個，逐一發送：`);
        for (const p of pending) {
            const age = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 60000);
            const ageStr = age < 60 ? `${age} 分鐘前` : age < 1440 ? `${Math.floor(age / 60)} 小時前` : `${Math.floor(age / 1440)} 天前`;
            const msgText = `💡 **核心進化提案** (${p.proposalType})\n目標：${p.name}\n內容：${p.description}\n建立：${ageStr}\n\`\`\`\n${p.diffPreview}\n\`\`\``;
            const options = {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🚀 部署', callback_data: `PATCH_DEPLOY:${p.id}` },
                        { text: '🗑️ 丟棄', callback_data: `PATCH_DROP:${p.id}` }
                    ]]
                }
            };
            await ctx.reply(msgText, options);
            this.pendingPatches.updateNotified(p.id);
        }
    }
}

module.exports = DeployActions;
