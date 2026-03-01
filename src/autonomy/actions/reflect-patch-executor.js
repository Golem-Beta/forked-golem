/**
 * @module reflect-patch-executor
 * @role Self-reflection Phase 2 執行端 — 自動部署與 Telegram 送審
 * @when-to-modify 調整部署流程、Telegram 通知格式、或 Tasks 閉環邏輯時
 *
 * 被 reflect-patch.js 透過 this.executor 呼叫。
 * 持有所有「通知/IO」相關 deps（notifier、journal、config、googleServices 等），
 * 讓 reflect-patch.js 專注於「生成 + 驗證 + 選路」。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');

async function runSmokeGate() {
    return new Promise((resolve) => {
        const child = spawn('node', ['test-smoke.js'], { cwd: process.cwd(), stdio: 'pipe' });
        let output = '';
        child.stdout.on('data', d => { output += d.toString(); });
        child.stderr.on('data', d => { output += d.toString(); });
        child.on('close', code => resolve({ ok: code === 0, output }));
        child.on('error', err => resolve({ ok: false, output: err.message }));
    });
}

class PatchExecutor {
    constructor({ journal, notifier, decision, config, InputFile, PendingPatches, googleServices }) {
        this.journal        = journal;
        this.notifier       = notifier;
        this.decision       = decision;
        this.config         = config;
        this.InputFile      = InputFile;
        this.PendingPatches = PendingPatches;
        this.googleServices = googleServices || null;
    }

    // ── 自動部署（高信心低風險路徑）─────────────────────────────────────────
    // 成功/smoke_gate_failed 回傳 ActionResult；意外例外回傳 null（呼叫端降級為送審）

    async autoDeploy(proposal, testFile, targetPath, targetName, proposalType, reflectionFile) {
        const confidence      = typeof proposal.confidence === 'number' ? proposal.confidence : 0;
        const riskLevel       = proposal.risk_level || 'medium';
        const expectedOutcome = proposal.expected_outcome || '';
        try {
            const smoke = await runSmokeGate();
            if (!smoke.ok) {
                try { fs.unlinkSync(testFile); } catch (_) {}
                const tail = smoke.output.slice(-600);
                await this.notifier.sendToAdmin('❌ 自動部署中止（Smoke gate 未通過）\n目標：' + targetName + '\n```\n' + tail + '\n```');
                this.journal.append({ action: 'self_reflection', outcome: 'smoke_gate_failed', target: targetName, reflection_file: reflectionFile });
                return { success: false, action: 'self_reflection', outcome: 'smoke_gate_failed', target: targetName };
            }
            fs.copyFileSync(targetPath, targetPath + '.bak-' + Date.now());
            fs.writeFileSync(targetPath, fs.readFileSync(testFile));
            fs.unlinkSync(testFile);
            if (this.googleServices?._auth?.isAuthenticated()) {
                try {
                    await this.googleServices.createTask({
                        title: `[反思待辦] 已部署：${targetName}`,
                        notes: (proposal.description || '').substring(0, 500),
                    });
                } catch (e) { console.warn('[Reflect] Tasks 寫入失敗:', e.message); }
            }
            const autoMsg = '🤖 **核心進化已自動部署** (' + proposalType + ')\n目標：' + targetName + '\n內容：' + (proposal.description || '') + '\n信心: ' + (confidence * 100).toFixed(0) + '% | 風險: ' + riskLevel + '\n預期: ' + expectedOutcome;
            const sentAuto = await this.notifier.sendToAdmin(autoMsg);
            console.log('[SelfReflection/auto_deploy] sendToAdmin:', sentAuto === true ? '✅ OK' : '❌ FAILED');
            this.journal.append({
                action: 'self_reflection', mode: 'core_patch',
                proposal: proposalType, target: targetName,
                description: proposal.description,
                outcome: 'auto_deployed',
                confidence, risk_level: riskLevel, expected_outcome: expectedOutcome,
                reflection_file: reflectionFile,
                model: this.decision.lastModel,
                tokens: this.decision.lastTokens,
            });
            return { success: true, action: 'self_reflection', outcome: 'auto_deployed', target: targetName };
        } catch (autoErr) {
            console.error('[SelfReflection/auto_deploy] 自動部署失敗，降級為送審:', autoErr.message);
            return null;
        }
    }

    // ── 送審（建 diff preview、存 PendingPatches、發 Telegram inline button）

    async sendForReview(proposal, testFile, targetPath, targetName, proposalType, reflectionFile, triggerCtx) {
        const confidence  = typeof proposal.confidence === 'number' ? proposal.confidence : 0;
        const truncLine   = s => s.length > 80 ? s.substring(0, 80) + '...' : s;
        const searchPreview = proposal.target_node
            ? `- [AST: ${proposal.target_node}]`
            : proposal.search.split('\n').slice(0, 2).map(truncLine).map(l => '- ' + l).join('\n');
        const replacePreview = proposal.replace.split('\n').slice(0, 2).map(truncLine).map(l => '+ ' + l).join('\n');

        global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: proposal.description };
        if (this.PendingPatches) {
            const pendingId = this.PendingPatches.add({
                testFile, target: targetPath, name: targetName,
                description: proposal.description || '', proposalType,
                diffPreview: searchPreview + '\n' + replacePreview,
            });
            global.pendingPatch.pendingId = pendingId;
        }

        const diffBlock = '```\n' + searchPreview + '\n' + replacePreview + '\n```';
        const infoParts = [];
        if (proposal.risk_level) infoParts.push('風險: ' + proposal.risk_level);
        if (typeof proposal.confidence === 'number') infoParts.push('信心: ' + (confidence * 100).toFixed(0) + '%');
        if (proposal.expected_outcome) infoParts.push('預期: ' + proposal.expected_outcome);
        const infoLine  = infoParts.length > 0 ? '\n' + infoParts.join(' | ') : '';
        const msgText   = '💡 **核心進化提案** (' + proposalType + ')\n目標：' + targetName + '\n內容：' + (proposal.description || '') + '\n' + diffBlock + infoLine;
        const options   = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };

        let sentCP = false;
        let sentCPError = null;
        try {
            if (triggerCtx) {
                await triggerCtx.reply(msgText, options);
                await triggerCtx.sendDocument(testFile);
                sentCP = true;
            } else if (this.config.ADMIN_IDS && this.config.ADMIN_IDS[0]) {
                const { tgBot } = this.notifier;
                if (tgBot) {
                    await tgBot.api.sendMessage(this.config.ADMIN_IDS[0], msgText, options);
                    await tgBot.api.sendDocument(this.config.ADMIN_IDS[0], new this.InputFile(testFile));
                    sentCP = true;
                }
            }
        } catch (sendErr) {
            console.error('[SelfReflection/core_patch] send FAILED:', sendErr.message);
            sentCPError = sendErr.message;
        }
        console.log('[SelfReflection/core_patch] send:', sentCP ? '✅ OK' : '❌ FAILED');

        if (this.googleServices?._auth?.isAuthenticated()) {
            try {
                await this.googleServices.createTask({
                    title: `[反思待辦] 待審核 patch：${targetName}`,
                    notes: ((proposal.description || '') + '\n類型: ' + proposalType).substring(0, 500),
                });
            } catch (e) { console.warn('[Reflect] Tasks 寫入失敗:', e.message); }
        }

        const metaFields = {};
        if (typeof proposal.confidence === 'number') metaFields.confidence = proposal.confidence;
        if (proposal.risk_level) metaFields.risk_level = proposal.risk_level;
        if (proposal.expected_outcome) metaFields.expected_outcome = proposal.expected_outcome;
        const proposedTs = new Date().toISOString();
        this.journal.append({
            action: 'self_reflection', mode: 'core_patch',
            proposal: proposalType, target: targetName,
            description: proposal.description,
            ts: proposedTs,
            outcome: sentCP === true ? 'proposed' : sentCP === 'queued' ? 'queued' : 'proposed_send_failed',
            ...metaFields,
            reflection_file: reflectionFile,
            model: this.decision.lastModel,
            tokens: this.decision.lastTokens,
            ...(sentCP !== true && sentCP !== 'queued' && sentCPError ? { error: sentCPError } : {})
        });
        if (global.pendingPatch) global.pendingPatch.proposedTs = proposedTs;
        return { success: sentCP === true, action: 'self_reflection', outcome: sentCP === true ? 'proposed' : sentCP === 'queued' ? 'queued' : 'proposed_send_failed', target: targetName };
    }
}

module.exports = PatchExecutor;
