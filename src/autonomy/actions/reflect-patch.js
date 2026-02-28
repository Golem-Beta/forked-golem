/**
 * @module reflect-patch
 * @role Self-reflection Phase 2 — 根據診斷結果產生 patch 並送審
 * @when-to-modify 調整 patch 格式、skill_create/core_patch 處理邏輯、或驗證流程時
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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

class ReflectPatch {
    constructor({ journal, notifier, decision, skills, config, memory, PatchManager, ResponseParser, InputFile, PendingPatches, googleServices, loadPrompt }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
        this.skills = skills;
        this.config = config;
        this.memory = memory;
        this.PatchManager = PatchManager;
        this.ResponseParser = ResponseParser;
        this.InputFile = InputFile;
        this.PendingPatches = PendingPatches;
        this.googleServices = googleServices || null;
        this.loadPrompt = loadPrompt || null;
    }

    /**
     * Phase 2 patch 生成與驗證
     * @param {object} diag - Phase 1 診斷結果
     * @param {string} diagFile - Phase 1 reflection 檔案路徑
     * @param {string} journalContext - 格式化日誌字串
     * @param {object|null} triggerCtx - Telegram context（手動觸發時）
     */
    async run(diag, diagFile, journalContext, triggerCtx) {
        const targetFile = diag.target_file || 'src/autonomy/actions.js';
        const codeSnippet = this.decision.extractCodeSection(targetFile);

        if (!codeSnippet || codeSnippet.length < 10) {
            console.warn('🧬 [Reflection] 無法提取目標程式碼區段');
            this.journal.append({ action: 'self_reflection', phase: 'extraction', outcome: 'section_not_found', target: targetFile, reflection_file: diagFile });
            return;
        }

        const evolutionSkill = this.skills.skillLoader.loadSkill("EVOLUTION") || "Output a JSON Array.";
        const patchPrompt = this.loadPrompt('self-reflection-patch.md', {
            EVOLUTION_SKILL: evolutionSkill,
            DIAGNOSIS:       diag.diagnosis,
            APPROACH:        diag.approach || '',
            TARGET_FILE:     targetFile,
            CODE_SNIPPET:    codeSnippet,
            JOURNAL_CONTEXT: journalContext,
        });
        if (!patchPrompt) throw new Error('self-reflection-patch.md 載入失敗');

        console.log('🧬 [Reflection] Phase 2: 生成 patch（' + codeSnippet.length + ' chars context）...');
        const raw = (await this.decision.callLLM(patchPrompt, { intent: 'code_edit', temperature: 0.2 })).text;
        const reflectionFile = this.decision.saveReflection('self_reflection', raw);

        let proposals = this.ResponseParser.extractJson(raw);
        if (!Array.isArray(proposals) || proposals.length === 0) {
            this.journal.append({ action: 'self_reflection', outcome: 'no_proposals', reflection_file: reflectionFile });
            if (!triggerCtx) {
                const failMsg = '🧬 [self_reflection] Phase 2 無法產出有效 patch\n診斷: ' + diag.diagnosis + '\n目標: ' + targetFile + '\n(LLM 輸出已存至 ' + reflectionFile + ')';
                const sent = await this.notifier.sendToAdmin(failMsg);
                console.log('[Reflection] no_proposals 通知:', sent ? 'OK' : 'FAILED');
            }
            return { success: false, action: 'self_reflection', outcome: 'no_proposals', target: targetFile };
        }

        const proposal = proposals[0];
        const mode = proposal.mode || (proposal.search ? 'core_patch' : 'unknown');

        // 模式一：技能擴展
        if (mode === 'skill_create') {
            const scResult = await this._handleSkillCreate(proposal, reflectionFile);
            return scResult || { success: false, action: 'self_reflection', outcome: 'skill_create_failed', target: targetFile };
        }

        // 模式二：核心進化
        if (mode === 'core_patch' || (proposal.search && proposal.replace !== undefined)) {
            const cpResult = await this._handleCorePatch(proposal, reflectionFile, triggerCtx);
            return cpResult || { success: false, action: 'self_reflection', outcome: 'core_patch_failed', target: targetFile };
        }

        this.journal.append({ action: 'self_reflection', mode: mode, outcome: 'unknown_mode', reflection_file: reflectionFile });
        return { success: false, action: 'self_reflection', outcome: 'unknown_mode', target: targetFile };
    }

    async _handleSkillCreate(proposal, reflectionFile) {
        const skillName = proposal.skill_name;
        const content = proposal.content;
        if (!skillName || !content) {
            this.journal.append({ action: 'self_reflection', mode: 'skill_create', outcome: 'invalid_proposal', reflection_file: reflectionFile });
            return;
        }
        const skillPath = path.join(process.cwd(), 'skills.d', skillName + '.md');
        if (fs.existsSync(skillPath)) {
            this.journal.append({ action: 'self_reflection', mode: 'skill_create', outcome: 'skill_already_exists', skill_name: skillName, reflection_file: reflectionFile });
            return { success: false, action: 'self_reflection', outcome: 'skill_already_exists' };
        }
        fs.writeFileSync(skillPath, content);
        // Tasks 閉環：記錄新技能建立
        if (this.googleServices?._auth?.isAuthenticated()) {
            try {
                await this.googleServices.createTask({
                    title: `[反思待辦] 新技能：${skillName}`,
                    notes: (proposal.description || '').substring(0, 500),
                });
            } catch (e) { console.warn('[Reflect] Tasks 寫入失敗:', e.message); }
        }
        const msgText = '🧩 **新技能已建立**: ' + skillName + '\n' + (proposal.description || '') + '\n原因: ' + (proposal.reason || '');
        const sentSC = await this.notifier.sendToAdmin(msgText);
        console.log('[SelfReflection/skill_create] sendToAdmin:', sentSC ? '✅ OK' : '❌ FAILED');
        this.journal.append({
            action: 'self_reflection', mode: 'skill_create',
            skill_name: skillName, description: proposal.description,
            outcome: sentSC === true ? 'skill_created' : sentSC === 'queued' ? 'queued' : 'skill_created_send_failed',
            reflection_file: reflectionFile,
            model: this.decision.lastModel,
            tokens: this.decision.lastTokens
        });
        return { success: sentSC === true, action: 'self_reflection', outcome: sentSC === true ? 'skill_created' : sentSC === 'queued' ? 'queued' : 'skill_created_send_failed' };
    }

    async _handleCorePatch(proposal, reflectionFile, triggerCtx) {
        if (typeof proposal.search !== 'string' || typeof proposal.replace !== 'string') {
            this.journal.append({ action: 'self_reflection', mode: 'core_patch', outcome: 'invalid_patch', reflection_file: reflectionFile });
            return;
        }
        const proposalType = proposal.type || 'unknown';
        this.memory.recordProposal(proposalType);

        const validFiles = ['index.js', 'skills.js'];
        // 加入 src/ 下所有已知模組
        const srcDir = path.join(process.cwd(), 'src');
        if (fs.existsSync(srcDir)) {
            const scanDir = (dir, prefix) => {
                for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                    const rel = prefix ? prefix + '/' + e.name : e.name;
                    if (e.isDirectory()) scanDir(path.join(dir, e.name), rel);
                    else if (e.name.endsWith('.js')) validFiles.push('src/' + rel);
                }
            };
            scanDir(srcDir, '');
        }

        const targetName = validFiles.includes(proposal.file) ? proposal.file : 'src/autonomy/actions.js';
        const targetPath = path.join(process.cwd(), targetName);

        const testFile = this.PatchManager.createTestClone(targetPath, [proposal]);
        let isVerified = false;
        if (targetName === 'skills.js') {
            try { require(path.resolve(testFile)); isVerified = true; } catch (e) { console.error(e); }
        } else {
            isVerified = this.PatchManager.verify(testFile);
        }

        if (isVerified) {
            const confidence = typeof proposal.confidence === 'number' ? proposal.confidence : 0;
            const riskLevel = proposal.risk_level || 'medium';
            const expectedOutcome = proposal.expected_outcome || '';
            // 高信心低風險：自動部署
            if (confidence >= 0.85 && riskLevel === 'low') {
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
                    // Tasks 閉環：記錄自動部署
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
                    console.log('[SelfReflection/auto_deploy] sendToAdmin:', sentAuto ? '✅ OK' : '❌ FAILED');
                    this.journal.append({
                        action: 'self_reflection', mode: 'core_patch',
                        proposal: proposalType, target: targetName,
                        description: proposal.description,
                        outcome: 'auto_deployed',
                        confidence, risk_level: riskLevel, expected_outcome: expectedOutcome,
                        reflection_file: reflectionFile,
                        model: this.decision.lastModel,
                        tokens: this.decision.lastTokens
                    });
                    return { success: true, action: 'self_reflection', outcome: 'auto_deployed', target: targetName };
                } catch (autoErr) {
                    console.error('[SelfReflection/auto_deploy] 自動部署失敗，降級為送審:', autoErr.message);
                }
            }
            const truncLine = s => s.length > 80 ? s.substring(0, 80) + '...' : s;
            const searchPreview = proposal.search.split('\n').slice(0, 2).map(truncLine).map(l => '- ' + l).join('\n');
            const replacePreview = proposal.replace.split('\n').slice(0, 2).map(truncLine).map(l => '+ ' + l).join('\n');
            global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: proposal.description };
            // 持久化到磁碟
            if (this.PendingPatches) {
                const pendingId = this.PendingPatches.add({
                    testFile,
                    target: targetPath,
                    name: targetName,
                    description: proposal.description || '',
                    proposalType,
                    diffPreview: searchPreview + '\n' + replacePreview,
                });
                global.pendingPatch.pendingId = pendingId;
            }
            const diffBlock = '```\n' + searchPreview + '\n' + replacePreview + '\n```';
            const infoParts = [];
            if (proposal.risk_level) infoParts.push('風險: ' + proposal.risk_level);
            if (typeof proposal.confidence === 'number') infoParts.push('信心: ' + (proposal.confidence * 100).toFixed(0) + '%');
            if (proposal.expected_outcome) infoParts.push('預期: ' + proposal.expected_outcome);
            const infoLine = infoParts.length > 0 ? '\n' + infoParts.join(' | ') : '';
            const msgText = '💡 **核心進化提案** (' + proposalType + ')\n目標：' + targetName + '\n內容：' + (proposal.description || '') + '\n' + diffBlock + infoLine;
            const options = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };
            let sentCP = false;
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
            }
            console.log('[SelfReflection/core_patch] send:', sentCP ? '✅ OK' : '❌ FAILED');
            // Tasks 閉環：提案待審核提醒
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
                tokens: this.decision.lastTokens
            });
            if (global.pendingPatch) global.pendingPatch.proposedTs = proposedTs;
            return { success: sentCP === true, action: 'self_reflection', outcome: sentCP === true ? 'proposed' : sentCP === 'queued' ? 'queued' : 'proposed_send_failed', target: targetName };
        } else {
            this.journal.append({
                action: 'self_reflection', mode: 'core_patch',
                proposal: proposalType, outcome: 'verification_failed',
                reflection_file: reflectionFile
            });
            return { success: false, action: 'self_reflection', outcome: 'verification_failed', target: proposal.file || '' };
            return { success: false, action: 'self_reflection', outcome: 'verification_failed', target: proposal.file || '' };
        }
    }
}

module.exports = ReflectPatch;
