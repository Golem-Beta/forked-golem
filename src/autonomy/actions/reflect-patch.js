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
const BaseAction = require('./base-action');

// ── 靜態安全規則（硬編碼防火牆，不可被 prompt 或 config 覆蓋）──────────────
const _PROTECTED_TARGET_KEYWORDS = ['autoDeploy', 'risk_level', 'confidence', 'AUTODEPLOY'];
const _PROTECTED_REPLACE_PATTERNS = [
    /\bautoDeploy\b/,                          // autoDeploy 函式本身
    /\bconfidence\b\s*(?:>=|<=|===|!==|>|<)/, // confidence 比較運算
    /\brisk_level\b/,                          // risk_level 任何出現均擋（含賦值）
    /AUTODEPLOY_MIN_CONFIDENCE|AUTODEPLOY_MAX_RISK/, // config key 直接引用
];
const _RISK_ORDER = { low: 1, medium: 2, high: 3 };

/**
 * 回傳 { reason } 表示被靜態規則阻擋；回傳 null 表示通過。
 * @param {object} proposal
 */
function _checkStaticSafetyRules(proposal) {
    const targetNode = proposal.target_node || '';
    for (const kw of _PROTECTED_TARGET_KEYWORDS) {
        if (targetNode.toLowerCase().includes(kw.toLowerCase()))
            return { reason: `target_node 含受保護關鍵字 "${kw}"` };
    }
    const replace = proposal.replace || '';
    for (const pat of _PROTECTED_REPLACE_PATTERNS) {
        if (pat.test(replace))
            return { reason: `replace 含受保護邏輯 (${pat.source})` };
    }
    return null;
}

class ReflectPatch extends BaseAction {
    constructor({ journal, notifier, decision, skills, config, memory, PatchManager, ResponseParser, InputFile, PendingPatches, googleServices, loadPrompt }) {
        super({ journal, notifier, decision, loadPrompt });
        this.skills         = skills;
        this.config         = config;
        this.memory         = memory;
        this.PatchManager   = PatchManager;
        this.ResponseParser = ResponseParser;
        this.InputFile      = InputFile;
        this.PendingPatches = PendingPatches;
        this.googleServices = googleServices || null;
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
        const targetNode  = diag.target_node || null;
        const codeSnippet = this.decision.extractCodeSection(targetFile, targetNode);

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
            const cpResult = await this._handleCorePatch(proposal, reflectionFile, triggerCtx, codeSnippet);
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
            outcome: this._sentOutcome(sentSC, 'skill_created'),
            reflection_file: reflectionFile,
            model: this.decision.lastModel,
            tokens: this.decision.lastTokens,
            ...this._sentErrorField(sentSC)
        });
        return { success: sentSC === true, action: 'self_reflection', outcome: this._sentOutcome(sentSC, 'skill_created') };
    }

    async _handleCorePatch(proposal, reflectionFile, triggerCtx, codeSnippet) {
        const hasSearch     = typeof proposal.search === 'string';
        const hasTargetNode = typeof proposal.target_node === 'string' && !!proposal.target_node;
        if ((!hasSearch && !hasTargetNode) || typeof proposal.replace !== 'string') {
            this.journal.append({ action: 'self_reflection', mode: 'core_patch', outcome: 'invalid_patch', reflection_file: reflectionFile });
            return;
        }
        const proposalType = proposal.type || 'unknown';
        this.memory.recordProposal(proposalType);

        // target_node 索引驗證：若索引存在，用索引解析並覆蓋 LLM 提供的 file 路徑
        if (hasTargetNode) {
            try {
                const CodebaseIndexer = require('../../codebase-indexer');
                let idx = null;
                try { idx = CodebaseIndexer.load(); } catch (e) { /* 索引不存在 → 略過驗證 */ }
                if (idx) {
                    const found = CodebaseIndexer.lookup(idx, proposal.target_node);
                    if (!found) {
                        this.journal.append({
                            action: 'self_reflection', mode: 'core_patch',
                            outcome: 'target_node_not_found',
                            target_node: proposal.target_node,
                            reflection_file: reflectionFile,
                        });
                        console.warn(`🧬 [Reflection] target_node "${proposal.target_node}" 不在索引，跳過`);
                        return { success: false, action: 'self_reflection', outcome: 'target_node_not_found', target: proposal.target_node };
                    }
                    proposal.file = found.file; // 索引解析路徑，覆蓋 LLM 可能填錯的 file
                }
            } catch (e) {
                console.warn('[Reflection] 索引驗證失敗，繼續原有流程:', e.message);
            }
        }

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

        // ── LLM 自驗（輕量快速審查：語法完整性、節點類型匹配）───────────────────
        const llmReview = await this._llmSelfReview(proposal, codeSnippet);
        if (llmReview && !llmReview.pass) {
            console.warn('[SelfReflection] LLM 自驗否決 patch:', llmReview.reason);
            this.journal.append({
                action: 'self_reflection', mode: 'core_patch',
                proposal: proposalType, outcome: 'llm_review_failed',
                llm_review: { pass: false, reason: llmReview.reason },
                reflection_file: reflectionFile,
            });
            return { success: false, action: 'self_reflection', outcome: 'llm_review_failed', target: proposal.file || '' };
        }

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

        // ── ReviewerAgent 語義審查（語法驗證通過後、autoDeploy 決策前）──────────
        const ReviewerAgent = require('./reviewer-agent');
        const reviewer = new ReviewerAgent({ decision: this.decision });
        const originalCode = proposal.search
            || (proposal.target_node ? `// [AST target: ${proposal.target_node}]` : '');
        let reviewResult;
        try {
            reviewResult = await reviewer.review(originalCode, proposal.replace || '', proposal);
        } catch (e) {
            console.warn('[Reflection] ReviewerAgent 例外，降級為 needs_human:', e.message);
            reviewResult = {
                verdict: 'needs_human', summary: 'ReviewerAgent 例外: ' + e.message,
                removed_logic: [], intentional_removals: [], risks: [e.message],
            };
        }

        if (reviewResult.verdict === 'reject') {
            console.warn('[SelfReflection] ReviewerAgent 拒絕 patch:', reviewResult.summary);
            try { fs.unlinkSync(testFile); } catch (_) {}
            this.journal.append({
                action: 'self_reflection', mode: 'core_patch',
                proposal: proposalType, outcome: 'reviewer_rejected',
                reviewer_summary: reviewResult.summary,
                risks: reviewResult.risks,
                reflection_file: reflectionFile,
            });
            return { success: false, action: 'self_reflection', outcome: 'reviewer_rejected', target: proposal.file || '' };
        }

        if (reviewResult.verdict === 'needs_human') {
            console.log('[SelfReflection] ReviewerAgent 要求人工確認:', reviewResult.summary);
            // 強制走 sendForReview，附上 reviewer 結果供人工判斷，跳過 autoDeploy
            return this.executor.sendForReview(
                proposal, testFile, targetPath, targetName, proposalType, reflectionFile, triggerCtx, reviewResult
            );
        }
        // verdict: approve → 繼續靜態安全規則 + autoDeploy 決策

        // 靜態安全規則：硬編碼防火牆，優先於 config 設定
        const staticBlock = _checkStaticSafetyRules(proposal);
        if (staticBlock) {
            console.warn('[SelfReflection] 靜態安全規則阻擋 autoDeploy:', staticBlock.reason);
        } else {
            const confidence = typeof proposal.confidence === 'number' ? proposal.confidence : 0;
            const minConf    = this.config.AUTODEPLOY_MIN_CONFIDENCE || 0.85;
            const maxRisk    = this.config.AUTODEPLOY_MAX_RISK || 'low';
            const riskVal    = _RISK_ORDER[proposal.risk_level || 'medium'] || 2;
            const maxRiskVal = _RISK_ORDER[maxRisk] || 0; // 'never' → undefined → 0，永遠不通過
            if (confidence >= minConf && riskVal <= maxRiskVal) {
                const autoResult = await this.executor.autoDeploy(proposal, testFile, targetPath, targetName, proposalType, reflectionFile);
                if (autoResult) return autoResult;
                // null → 意外例外，降級為送審
            }
        }

        return this.executor.sendForReview(proposal, testFile, targetPath, targetName, proposalType, reflectionFile, triggerCtx);
    }

    /**
     * LLM 自驗：讓 LLM 快速確認 patch 的語法完整性與節點類型匹配。
     * 失敗時不阻塞主流程（回傳 { pass: true, warning }）。
     * @param {object} proposal - patch proposal（含 target_node、replace）
     * @param {string|null} codeSnippet - 產生 patch 時提供給 LLM 的程式碼片段
     * @returns {{ pass: boolean, reason?: string, warning?: string }}
     */
    async _llmSelfReview(proposal, codeSnippet) {
        try {
            const reviewPrompt = this.loadPrompt('self-reflection-review.md', {
                CODE_SNIPPET:    codeSnippet || '(未提供)',
                TARGET_NODE:     proposal.target_node || '(未知)',
                REPLACE_CONTENT: proposal.replace || '',
            });
            if (!reviewPrompt) {
                console.warn('[Reflection] self-reflection-review.md 載入失敗，跳過自驗');
                return { pass: true, warning: 'prompt 載入失敗' };
            }
            const raw = (await this.decision.callLLM(reviewPrompt, { intent: 'code_review', temperature: 0 })).text;
            const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleaned);
            if (typeof result.pass !== 'boolean') throw new Error('pass 欄位非 boolean');
            console.log(`[Reflection] LLM 自驗：${result.pass ? '✅ 通過' : '❌ 否決 — ' + result.reason}`);
            return result;
        } catch (e) {
            console.warn('[Reflection] LLM 自驗失敗（不阻塞主流程）:', e.message);
            return { pass: true, warning: e.message };
        }
    }
}

module.exports = ReflectPatch;
