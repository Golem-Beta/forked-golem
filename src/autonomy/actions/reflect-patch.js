/**
 * @module reflect-patch
 * @role Self-reflection 部署層 — 驗證 Team 產出的 patch 並決定 autoDeploy 或送審
 * @when-to-modify 調整靜態安全規則、驗證流程、autoDeploy 條件、或 skill_create 處理時
 *
 * Patch 生成由 team/roles/implementer.js 負責。
 * 語義審查由 team/roles/reviewer.js 負責。
 * 執行端（自動部署 / Telegram 送審）委派至 reflect-patch-executor.js（PatchExecutor）。
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const PatchExecutor = require('./reflect-patch-executor');
const BaseAction    = require('./base-action');

// ── 靜態安全規則（硬編碼防火牆，不可被 prompt 或 config 覆蓋）──────────────
const _PROTECTED_TARGET_KEYWORDS = ['autoDeploy', 'risk_level', 'confidence', 'AUTODEPLOY'];
const _PROTECTED_REPLACE_PATTERNS = [
    /\bautoDeploy\b/,
    /\bconfidence\b\s*(?:>=|<=|===|!==|>|<)/,
    /\brisk_level\b/,
    /AUTODEPLOY_MIN_CONFIDENCE|AUTODEPLOY_MAX_RISK/,
];
const _RISK_ORDER = { low: 1, medium: 2, high: 3 };

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
     * 部署入口：接受 Team 產出的 proposal + reviewResult，執行驗證後部署
     * @param {object} opts
     * @param {object} opts.proposal       - Implementer 產出的 patch proposal
     * @param {string} opts.codeSnippet    - 提取的程式碼區段（LLM 自驗用）
     * @param {string} opts.reflectionFile - Implementer 儲存的 LLM 輸出路徑
     * @param {object} opts.reviewResult   - Reviewer 的審查結果（verdict/summary/issues）
     * @param {string} opts.diagnosis      - 診斷摘要（journal 用）
     * @param {string} opts.journalContext - 格式化日誌字串
     * @param {object|null} opts.triggerCtx - Telegram context（手動觸發時）
     */
    async deployProposal({ proposal, codeSnippet, reflectionFile, reviewResult, diagnosis, journalContext, triggerCtx }) {
        const mode = proposal.mode || ((proposal.target_node || proposal.search) ? 'core_patch' : 'unknown');

        if (mode === 'skill_create') {
            const r = await this._handleSkillCreate(proposal, reflectionFile);
            return r || { success: false, action: 'self_reflection', outcome: 'skill_create_failed' };
        }

        if (mode === 'core_patch' || (proposal.target_node && proposal.replace !== undefined)) {
            const r = await this._handleCorePatch(proposal, reflectionFile, triggerCtx, codeSnippet, reviewResult);
            return r || { success: false, action: 'self_reflection', outcome: 'core_patch_failed' };
        }

        this.journal.append({ action: 'self_reflection', mode, outcome: 'unknown_mode', reflection_file: reflectionFile });
        return { success: false, action: 'self_reflection', outcome: 'unknown_mode' };
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
        const msgText = `🧩 **新技能已建立**: ${skillName}\n${proposal.description || ''}\n原因: ${proposal.reason || ''}`;
        const sent    = await this.notifier.sendToAdmin(msgText);
        console.log('[SelfReflection/skill_create] sendToAdmin:', sent === true ? '✅ OK' : '❌ FAILED');
        this.journal.append({
            action: 'self_reflection', mode: 'skill_create',
            skill_name: skillName, description: proposal.description,
            outcome: this._sentOutcome(sent, 'skill_created'),
            reflection_file: reflectionFile,
            model: this.decision.lastModel, tokens: this.decision.lastTokens,
            ...this._sentErrorField(sent)
        });
        return { success: sent === true, action: 'self_reflection', outcome: this._sentOutcome(sent, 'skill_created') };
    }

    async _handleCorePatch(proposal, reflectionFile, triggerCtx, codeSnippet, reviewResult) {
        const hasTargetNode = typeof proposal.target_node === 'string' && !!proposal.target_node;
        if (!hasTargetNode || typeof proposal.replace !== 'string') {
            this.journal.append({ action: 'self_reflection', mode: 'core_patch', outcome: 'invalid_patch', reflection_file: reflectionFile });
            return;
        }
        const proposalType = proposal.type || 'unknown';
        this.memory.recordProposal(proposalType);

        // target_node 索引驗證：確認節點真實存在並解析檔案路徑
        if (hasTargetNode) {
            try {
                const CodebaseIndexer = require('../../codebase-indexer');
                let idx = null;
                try { idx = CodebaseIndexer.load(); } catch (_) {}
                if (idx && CodebaseIndexer.isStale(idx)) {
                    try {
                        console.log('[Reflection] 索引過期，重建中...');
                        idx = CodebaseIndexer.rebuild();
                    } catch (rebuildErr) {
                        console.warn('[Reflection] 索引重建失敗，使用舊索引:', rebuildErr.message);
                    }
                }
                if (idx) {
                    const found = CodebaseIndexer.lookup(idx, proposal.target_node);
                    if (!found) {
                        this.journal.append({
                            action: 'self_reflection', mode: 'core_patch',
                            outcome: 'target_node_not_found', target_node: proposal.target_node,
                            reason: proposal.target_node.includes('.')
                                ? '索引重建後仍找不到，節點可能不存在或已更名'
                                : '名稱格式錯誤：缺少 ClassName. prefix',
                            hint: 'target_node 應使用 ClassName.methodName 格式，且必須出現在可用節點清單中',
                            reflection_file: reflectionFile,
                        });
                        console.warn(`🧬 [Reflection] target_node "${proposal.target_node}" 不在索引，跳過`);
                        return { success: false, action: 'self_reflection', outcome: 'target_node_not_found', target: proposal.target_node };
                    }
                    proposal.file = found.file;
                }
            } catch (e) {
                console.warn('[Reflection] 索引驗證失敗，繼續:', e.message);
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
                error: verifyResult.error || 'unknown', reflection_file: reflectionFile,
            });
            return { success: false, action: 'self_reflection', outcome: 'verification_failed', target: proposal.file || '' };
        }

        // reviewResult 路由（來自 Team Reviewer，已在 reflect.js 過濾 reject）
        if (reviewResult?.verdict === 'needs_human') {
            console.log('[SelfReflection] Reviewer needs_human，強制送審');
            return this.executor.sendForReview(
                proposal, testFile, targetPath, targetName, proposalType, reflectionFile, triggerCtx, reviewResult
            );
        }

        // 靜態安全規則（硬編碼防火牆）
        const staticBlock = _checkStaticSafetyRules(proposal);
        if (!staticBlock) {
            const confidence = typeof proposal.confidence === 'number' ? proposal.confidence : 0;
            const minConf    = this.config.AUTODEPLOY_MIN_CONFIDENCE || 0.85;
            const maxRisk    = this.config.AUTODEPLOY_MAX_RISK || 'low';
            const riskVal    = _RISK_ORDER[proposal.risk_level || 'medium'] || 2;
            const maxRiskVal = _RISK_ORDER[maxRisk] || 0;
            if (confidence >= minConf && riskVal <= maxRiskVal) {
                const autoResult = await this.executor.autoDeploy(proposal, testFile, targetPath, targetName, proposalType, reflectionFile);
                if (autoResult) return autoResult;
            }
        } else {
            console.warn('[SelfReflection] 靜態安全規則阻擋 autoDeploy:', staticBlock.reason);
        }

        return this.executor.sendForReview(proposal, testFile, targetPath, targetName, proposalType, reflectionFile, triggerCtx);
    }
}

module.exports = ReflectPatch;
