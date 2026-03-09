'use strict';
const fs   = require('fs');
const path = require('path');

/**
 * @module team/roles/implementer
 * @role Implementer — 根據 Architect 策略提取程式碼 + 呼叫 LLM 產生 Format A patch
 * @when-to-modify 調整程式碼提取邏輯、patch prompt 載入、或 provider 記錄方式時
 *
 * 重構自 reflect-patch.js 的 LLM 生成部分（run → extractCodeSection + callLLM）
 */
const BaseAction = require('../../actions/base-action');

class ImplementerRole extends BaseAction {
    constructor({ journal, notifier, decision, skills, loadPrompt }) {
        super({ journal, notifier, decision, loadPrompt });
        this.skills = skills;
    }

    /**
     * 生成 patch proposal
     * @param {object} ctx - 含 diagnosis, strategy (含 target_file/target_node/strategy), journalContext
     * @returns {Promise<{ proposals: object[], codeSnippet: string, reflectionFile: string, implementerProvider: string|null }|null>}
     */
    async run(ctx) {
        const { diagnosis, strategy, journalContext = '(無)' } = ctx;
        const targetFile = strategy.target_file || 'src/autonomy/actions.js';
        const targetNode = strategy.target_node  || null;

        // 先驗證檔案存在
        const absPath = path.join(process.cwd(), targetFile);
        if (!fs.existsSync(absPath)) {
            console.warn('[Team/Implementer] target_file 不存在:', targetFile);
            this.journal.append({ action: 'team_implementer', outcome: 'target_file_invalid', target: targetFile });
            return { _error: 'target_file_invalid', _invalidTarget: targetFile };
        }

        // target_node 為 null 代表 Architect 找不到有效節點，繼續只會產生佔位符 patch
        if (!targetNode) {
            console.warn('[Team/Implementer] target_node 為 null，無法定位目標，中止');
            this.journal.append({ action: 'team_implementer', outcome: 'no_target_node', target: targetFile });
            return null;
        }

        const { snippet: codeSnippet, knownMethods } = this.decision.extractCodeSection(targetFile, targetNode);
        if (!codeSnippet || codeSnippet.length < 10) {
            console.warn('[Team/Implementer] 無法提取程式碼區段:', targetFile, targetNode);
            this.journal.append({ action: 'team_implementer', outcome: 'section_not_found', target: targetFile });
            return null;
        }

        const evolutionSkill = this.skills?.skillLoader?.loadSkill('EVOLUTION') || 'Output a JSON Array.';

        // 近期 llm_review_failed / reviewer_rejected 的 reason，注入 prompt 避免重蹈
        // 使用 readRecent 直接過濾，不依賴不存在的方法
        const recentRejections = this.journal.readRecent(30).filter(e =>
            (e.action === 'self_reflection') &&
            (e.outcome === 'llm_review_failed' || e.outcome === 'reviewer_rejected')
        );
        const rejectedReasons = recentRejections
            .map(e => e.llm_review?.reason || e.reviewer_summary || null)
            .filter(Boolean)
            .slice(-5); // 最近 5 條，避免 prompt 過長
        const REJECTED_REASONS = rejectedReasons.length > 0
            ? rejectedReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')
            : '(無近期拒絕記錄)';

        const prompt = this.loadPrompt('self-reflection-patch.md', {
            EVOLUTION_SKILL:  evolutionSkill,
            DIAGNOSIS:        diagnosis || '(無)',
            APPROACH:         strategy.strategy || '',
            TARGET_FILE:      targetFile,
            CODE_SNIPPET:     codeSnippet,
            JOURNAL_CONTEXT:  journalContext,
            REJECTED_REASONS: REJECTED_REASONS,
        });
        if (!prompt) throw new Error('self-reflection-patch.md 載入失敗');

        console.log(`[Team/Implementer] 生成 patch（${codeSnippet.length} chars）...`);
        const raw = (await this.decision.callLLM(prompt, {
            intent:      'code_edit',
            temperature: 0.2,
        })).text;

        // 記錄實際使用的 provider，供 Reviewer 互斥選擇
        const implementerProvider = this.decision.lastModel?.split('/')[0] || null;

        // strip <think>...</think>（reasoning model 防禦，避免破壞 JSON parse）
        const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        const reflectionFile = this.decision.saveReflection('self_reflection', raw);
        const { ResponseParser } = require('../../../parsers');
        const proposals = ResponseParser.extractJson(cleaned);

        if (!Array.isArray(proposals) || proposals.length === 0) {
            console.warn('[Team/Implementer] 無法解析 proposals');
            this.journal.append({ action: 'team_implementer', outcome: 'no_proposals', reflection_file: reflectionFile });
            return null;
        }

        // 過濾非法 proposal：只保留有足夠欄位的合法物件
        // core_patch 需要 target_node(string) + replace(string)
        // skill_create 需要 skill_name + content
        const validProposals = proposals.filter(p => {
            if (!p || typeof p !== 'object') return false;
            const mode = p.mode || (p.target_node ? 'core_patch' : p.skill_name ? 'skill_create' : null);
            if (mode === 'core_patch' || (!mode && p.target_node)) {
                return typeof p.target_node === 'string' && p.target_node.length > 0
                    && typeof p.replace === 'string';
            }
            if (mode === 'skill_create') {
                return typeof p.skill_name === 'string' && typeof p.content === 'string';
            }
            return false; // metadata 物件、空殼或不明格式 → 過濾掉
        });

        if (validProposals.length === 0) {
            console.warn('[Team/Implementer] proposals 解析成功但全部無效（缺少必要欄位）');
            console.warn('[Team/Implementer] 原始 proposals:', JSON.stringify(proposals.map(p => Object.keys(p || {}))));
            this.journal.append({ action: 'team_implementer', outcome: 'no_valid_proposals', reflection_file: reflectionFile, raw_count: proposals.length });
            return null;
        }

        if (validProposals.length < proposals.length) {
            console.log(`[Team/Implementer] 過濾無效 proposal：${proposals.length} → ${validProposals.length}`);
        }

        console.log('[Team/Implementer] proposals:', validProposals.length, '| mode:', validProposals[0].mode, '| provider:', implementerProvider);
        return { proposals: validProposals, codeSnippet, reflectionFile, implementerProvider, knownMethods };
    }
}

module.exports = ImplementerRole;
