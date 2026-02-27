/**
 * @module reflect-patch
 * @role Self-reflection Phase 2 — 根據診斷結果產生 patch 並送審
 * @when-to-modify 調整 patch 格式、skill_create/core_patch 處理邏輯、或驗證流程時
 */
const fs = require('fs');
const path = require('path');

class ReflectPatch {
    constructor({ journal, notifier, decision, skills, config, memory, PatchManager, ResponseParser, InputFile }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
        this.skills = skills;
        this.config = config;
        this.memory = memory;
        this.PatchManager = PatchManager;
        this.ResponseParser = ResponseParser;
        this.InputFile = InputFile;
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
            this.journal.append({ action: 'self_reflection', phase: 'extraction', outcome: 'section_not_found', target: targetFile + ':' + targetSection, reflection_file: diagFile });
            return;
        }

        const evolutionSkill = this.skills.skillLoader.loadSkill("EVOLUTION") || "Output a JSON Array.";
        const patchPrompt = [
            '【輸出格式強制規則】你的輸出將被程式直接 JSON.parse()。',
            '第一個字元必須是 [，最後一個字元必須是 ]。',
            '不要輸出任何說明文字或 markdown 格式符號。',
            '違反此規則會導致 patch 被完全丟棄，等同於這次 reflection 白做。',
            '',
            evolutionSkill,
            '', '## DIAGNOSIS（Phase 1 的分析結果）',
            '問題：' + diag.diagnosis,
            '改進方向：' + (diag.approach || ''),
            '', '## TARGET CODE（' + targetFile + '，相關區段）', '', codeSnippet,
            '', '## RECENT EXPERIENCE (journal)', '', journalContext,
            '', 'Based on the diagnosis above, output ONLY a JSON Array with ONE focused patch.',
            'The "search" field must EXACTLY match a substring in the target code above.',
            'Include "file" field with the target file path (e.g. "src/brain.js").',
            'Include "affected_files" listing other src/ files that call the modified function/method.',
            'Keep the patch small and focused. ONE change only.',
            'If you have no confident patch to propose, output exactly: []',
        ].join('\n');

        console.log('🧬 [Reflection] Phase 2: 生成 patch（' + codeSnippet.length + ' chars context）...');
        const raw = await this.decision.callLLM(patchPrompt, { intent: 'code_edit', maxOutputTokens: 4096, temperature: 0.2 });
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
        const msgText = '🧩 **新技能已建立**: ' + skillName + '\n' + (proposal.description || '') + '\n原因: ' + (proposal.reason || '');
        const sentSC = await this.notifier.sendToAdmin(msgText);
        console.log('[SelfReflection/skill_create] sendToAdmin:', sentSC ? '✅ OK' : '❌ FAILED');
        this.journal.append({
            action: 'self_reflection', mode: 'skill_create',
            skill_name: skillName, description: proposal.description,
            outcome: sentSC ? 'skill_created' : 'skill_created_send_failed',
            reflection_file: reflectionFile,
            model: this.decision.lastModel,
            tokens: this.decision.lastTokens
        });
        return { success: sentSC, action: 'self_reflection', outcome: sentSC ? 'skill_created' : 'skill_created_send_failed' };
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
            global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: proposal.description };
            const truncLine = s => s.length > 80 ? s.substring(0, 80) + '...' : s;
            const searchPreview = proposal.search.split('\n').slice(0, 2).map(truncLine).map(l => '- ' + l).join('\n');
            const replacePreview = proposal.replace.split('\n').slice(0, 2).map(truncLine).map(l => '+ ' + l).join('\n');
            const diffBlock = '```\n' + searchPreview + '\n' + replacePreview + '\n```';
            const msgText = '💡 **核心進化提案** (' + proposalType + ')\n目標：' + targetName + '\n內容：' + (proposal.description || '') + '\n' + diffBlock;
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
            this.journal.append({
                action: 'self_reflection', mode: 'core_patch',
                proposal: proposalType, target: targetName,
                description: proposal.description,
                outcome: sentCP ? 'proposed' : 'proposed_send_failed',
                reflection_file: reflectionFile,
                model: this.decision.lastModel,
                tokens: this.decision.lastTokens
            });
            return { success: sentCP, action: 'self_reflection', outcome: sentCP ? 'proposed' : 'proposed_send_failed', target: targetName };
        } else {
            this.journal.append({
                action: 'self_reflection', mode: 'core_patch',
                proposal: proposalType, outcome: 'verification_failed',
                reflection_file: reflectionFile
            });
            return { success: false, action: 'self_reflection', outcome: 'verification_failed', target: proposal.file || '' };
        }
    }
}

module.exports = ReflectPatch;
