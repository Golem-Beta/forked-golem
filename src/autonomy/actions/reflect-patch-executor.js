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

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const BaseAction = require('./base-action');

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

/**
 * 對比兩個檔案，產出 unified diff 字串（截至 3000 字元）
 * 失敗或 diff 指令不存在時回傳 null（呼叫端 fallback 回 2 行 preview）
 */
function buildUnifiedDiff(targetPath, testFile) {
    try {
        const r = spawnSync('diff', ['-u', targetPath, testFile], { encoding: 'utf-8' });
        if (r.error) return null;                    // diff 指令不存在
        if (r.status === 0) return '（無差異）';
        if (r.status === 1) {                        // 正常：有差異
            const d = r.stdout || '';
            return d.length > 3000 ? d.slice(0, 3000) + '\n...(diff 已截斷)' : d;
        }
        return null;                                 // diff 指令錯誤（status 2）
    } catch (_) { return null; }
}

class PatchExecutor extends BaseAction {
    constructor({ journal, notifier, decision, config, InputFile, PendingPatches, googleServices }) {
        super({ journal, notifier, decision });
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
                description: proposal.description || '',
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

    // ── reviewResult 可選第 8 個參數：ReviewerAgent 審查結果（verdict: needs_human 時注入）
    async sendForReview(proposal, testFile, targetPath, targetName, proposalType, reflectionFile, triggerCtx, reviewResult) {
        const confidence = typeof proposal.confidence === 'number' ? proposal.confidence : 0;

        // --- diff preview 建構（優先 unified diff；失敗時 fallback 回 2 行 preview）---
        const truncLine   = s => s.length > 80 ? s.substring(0, 80) + '...' : s;
        const rawDiff     = buildUnifiedDiff(targetPath, testFile);
        let diffBlock, diffPreviewShort;
        if (rawDiff !== null) {
            diffBlock       = '```\n' + rawDiff + '\n```';
            diffPreviewShort = rawDiff.slice(0, 500);
        } else {
            const searchPrev = proposal.target_node
                ? `- [AST: ${proposal.target_node}]`
                : (proposal.search || '').split('\n').slice(0, 2).map(truncLine).map(l => '- ' + l).join('\n');
            const replacePrev = (proposal.replace || '').split('\n').slice(0, 2).map(truncLine).map(l => '+ ' + l).join('\n');
            diffBlock        = '```\n' + searchPrev + '\n' + replacePrev + '\n```';
            diffPreviewShort = searchPrev + '\n' + replacePrev;
        }

        global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: proposal.description || '' };
        if (this.PendingPatches) {
            const pendingId = this.PendingPatches.add({
                testFile, target: targetPath, name: targetName,
                description: proposal.description || '', proposalType,
                diffPreview: diffPreviewShort,
            });
            global.pendingPatch.pendingId = pendingId;
        }

        const infoParts = [];
        if (proposal.risk_level) infoParts.push('風險: ' + proposal.risk_level);
        if (typeof proposal.confidence === 'number') infoParts.push('信心: ' + (confidence * 100).toFixed(0) + '%');
        if (proposal.expected_outcome) infoParts.push('預期: ' + proposal.expected_outcome);
        const infoLine   = infoParts.length > 0 ? '\n' + infoParts.join(' | ') : '';

        // ReviewerAgent 摘要區塊（needs_human 路徑才會有）
        let reviewerLine = '';
        if (reviewResult) {
            reviewerLine = '\n🔍 **Reviewer**: ' + reviewResult.summary;
            if (reviewResult.risks && reviewResult.risks.length > 0) {
                reviewerLine += '\n⚠️ 風險: ' + reviewResult.risks.slice(0, 3).join(' / ');
            }
            if (reviewResult.removed_logic && reviewResult.removed_logic.length > 0) {
                reviewerLine += '\n🗑️ 疑似移除: ' + reviewResult.removed_logic.slice(0, 2).join(', ');
            }
        }

        const msgText    = '💡 **核心進化提案** (' + proposalType + ')\n目標：' + targetName + '\n內容：' + (proposal.description || '') + '\n' + diffBlock + infoLine + reviewerLine;
        const inlineOpts = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };

        let sentCP = false;
        let sentCPError = null;
        try {
            if (triggerCtx && typeof triggerCtx.reply === 'function') {
                // 使用者手動觸發路徑：grammy ctx，直接回覆
                await triggerCtx.reply(msgText, inlineOpts);
                await triggerCtx.sendDocument(testFile);
                sentCP = true;
            } else if (this.config.ADMIN_IDS && this.config.ADMIN_IDS[0]) {
                // 自主觸發路徑：透過 notifier.sendToAdmin，遵守 quiet hours
                const result = await this.notifier.sendToAdmin(msgText, {
                    document: testFile,
                    source: 'patch_review',
                    tgOptions: inlineOpts,
                });
                if (result === true || result === 'queued') {
                    sentCP = result; // true 或 'queued'
                } else {
                    sentCP = false;
                    if (result && result.error) sentCPError = result.error;
                }
            }
        } catch (sendErr) {
            console.error('[SelfReflection/core_patch] send FAILED:', sendErr.message);
            sentCPError = sendErr.message;
        }
        console.log('[SelfReflection/core_patch] send:', sentCP === true ? '✅ OK' : sentCP === 'queued' ? '⏳ queued' : '❌ FAILED');
        // 合成 _sentOutcome/_sentErrorField 可消費的 sentFinal
        const sentFinal = sentCP === true ? true : sentCP === 'queued' ? 'queued' : (sentCPError ? { error: sentCPError } : false);

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
            description: proposal.description || '',
            ts: proposedTs,
            outcome: this._sentOutcome(sentFinal, 'proposed'),
            ...metaFields,
            reflection_file: reflectionFile,
            model: this.decision.lastModel,
            tokens: this.decision.lastTokens,
            ...this._sentErrorField(sentFinal)
        });
        if (global.pendingPatch) global.pendingPatch.proposedTs = proposedTs;
        return { success: sentCP === true, action: 'self_reflection', outcome: this._sentOutcome(sentFinal, 'proposed'), target: targetName };
    }
}

module.exports = PatchExecutor;
