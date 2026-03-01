/**
 * @module reflect-patch
 * @role Self-reflection Phase 2 — 根據診斷結果產生 patch 並送審
 * @when-to-modify 調整 patch 格式、skill_create/core_patch 處理邏輯、或驗證流程時
 *
 * 執行端（自動部署 / Telegram 送審）委派至 reflect-patch-executor.js（PatchExecutor）。
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const PatchExecutor = require('./reflect-patch-executor');

class ReflectPatch {
    constructor({ journal, notifier, decision, skills, config, memory, PatchManager, ResponseParser, InputFile, PendingPatches, googleServices, loadPrompt }) {
        this.journal        = journal;
        this.notifier       = notifier;
        this.decision       = decision;
        this.skills         = skills;
        this.config         = config;
        this.memory         = memory;
        this.PatchManager   = PatchManager;
        this.ResponseParser = ResponseParser;
        this.InputFile      = InputFile;
        this.PendingPatches = PendingPatches;
        this.googleServices = googleServices || null;
        this.loadPrompt     = loadPrompt || null;
        this.executor = new PatchExecutor({ journal, notifier, decision, config, InputFile, PendingPatches, googleServices });
    }

    /**
     * Phase 2 patch 生成與驗證
     * @param {object} diag - Phase 1 診斷結果
     * @param {string} diagFile - Phase 1 reflection 檔案路徑
     * @param {string} journalContext - 格式化日誌字串
     * @param {object|null} triggerCtx - Telegram context（手動觸發時）
     */
    async run(diag, diagFile, journalContext, triggerCtx) {
        const targetFile  = diag.target_file || 'src/autonomy/actions.js';
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
        const raw            = (await this.decision.callLLM(patchPrompt, { intent: 'code_edit', temperature: 0.2 })).text;
        const reflectionFile = this.decision.saveReflection('self_reflection', raw);

        let proposals = this.ResponseParser.extractJson(raw);
        if (!Array.isArray(proposals) || proposals.length === 0) {
            this.journal.append({ action: 'self_reflection', outcome: 'no_proposals', reflection_file: reflectionFile });
            if (!triggerCtx) {
                const failMsg = '🧬 [self_reflection] Phase 2 無法產出有效 patch\n診斷: ' + diag.diagnosis + '\n目標: ' + targetFile + '\n(LLM 輸出已存至 ' + reflectionFile + ')';
                const sent = await this.notifier.sendToAdmin(failMsg);
                console.log('[Reflection] no_proposals 通知:', sent === true ? 'OK' : 'FAILED');
            }
            return { success: false, action: 'self_reflection', outcome: 'no_proposals', target: targetFile };
        }

        const proposal = proposals[0];
        const mode = proposal.mode || ((proposal.search || proposal.target_node) ? 'core_patch' : 'unknown');

        // 模式一：技能擴展
        if (mode === 'skill_create') {
            const scResult = await this._handleSkillCreate(proposal, reflectionFile);
            return scResult || { success: false, action: 'self_reflection', outcome: 'skill_create_failed', target: targetFile };
        }

        // 模式二：核心進化
        if (mode === 'core_patch' || ((proposal.search || proposal.target_node) && proposal.replace !== undefined)) {
            const cpResult = await this._handleCorePatch(proposal, reflectionFile, triggerCtx);
            return cpResult || { success: false, action: 'self_reflection', outcome: 'core_patch_failed', target: targetFile };
        }

        this.journal.append({ action: 'self_reflection', mode: mode, outcome: 'unknown_mode', reflection_file: reflectionFile });
        return { success: false, action: 'self_reflection', outcome: 'unknown_mode', target: targetFile };
    }

    async _handleSkillCreate(proposal, reflectionFile) {
        const skillName = proposal.skill_name;
        const content   = proposal.content;
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
        if (this.googleServices?._auth?.isAuthenticated()) {
            try {
                await this.googleServices.createTask({
                    title: `[反思待辦] 新技能：${skillName}`,
                    notes: (proposal.description || '').substring(0, 500),
                });
            } catch (e) { console.warn('[Reflect] Tasks 寫入失敗:', e.message); }
        }
        const msgText = '🧩 **新技能已建立**: ' + skillName + '\n' + (proposal.description || '') + '\n原因: ' + (proposal.reason || '');
        const sentSC  = await this.notifier.sendToAdmin(msgText);
        console.log('[SelfReflection/skill_create] sendToAdmin:', sentSC === true ? '✅ OK' : '❌ FAILED');
        this.journal.append({
            action: 'self_reflection', mode: 'skill_create',
            skill_name: skillName, description: proposal.description,
            outcome: sentSC === true ? 'skill_created' : sentSC === 'queued' ? 'queued' : 'skill_created_send_failed',
            reflection_file: reflectionFile,
            model: this.decision.lastModel,
            tokens: this.decision.lastTokens,
            ...(sentSC !== true && sentSC !== 'queued' && sentSC && sentSC.error ? { error: sentSC.error } : {})
        });
        return { success: sentSC === true, action: 'self_reflection', outcome: sentSC === true ? 'skill_created' : sentSC === 'queued' ? 'queued' : 'skill_created_send_failed' };
    }

    async _handleCorePatch(proposal, reflectionFile, triggerCtx) {
        const hasSearch     = typeof proposal.search === 'string';
        const hasTargetNode = typeof proposal.target_node === 'string' && !!proposal.target_node;
        if ((!hasSearch && !hasTargetNode) || typeof proposal.replace !== 'string') {
            this.journal.append({ action: 'self_reflection', mode: 'core_patch', outcome: 'invalid_patch', reflection_file: reflectionFile });
            return;
        }
        const proposalType = proposal.type || 'unknown';
        this.memory.recordProposal(proposalType);

        const validFiles = ['index.js', 'skills.js'];
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
        let verifyResult;
        if (targetName === 'skills.js') {
            try { require(path.resolve(testFile)); verifyResult = { ok: true }; } catch (e) { verifyResult = { ok: false, error: e.message }; }
        } else {
            verifyResult = this.PatchManager.verify(testFile);
        }

        if (!verifyResult.ok) {
            this.journal.append({
                action: 'self_reflection', mode: 'core_patch',
                proposal: proposalType, outcome: 'verification_failed',
                error: verifyResult.error || 'unknown',
                reflection_file: reflectionFile
            });
            return { success: false, action: 'self_reflection', outcome: 'verification_failed', target: proposal.file || '' };
        }

        const confidence = typeof proposal.confidence === 'number' ? proposal.confidence : 0;
        if (confidence >= 0.85 && (proposal.risk_level || 'medium') === 'low') {
            const autoResult = await this.executor.autoDeploy(proposal, testFile, targetPath, targetName, proposalType, reflectionFile);
            if (autoResult) return autoResult;
            // null → 意外例外，降級為送審
        }

        return this.executor.sendForReview(proposal, testFile, targetPath, targetName, proposalType, reflectionFile, triggerCtx);
    }
}

module.exports = ReflectPatch;
