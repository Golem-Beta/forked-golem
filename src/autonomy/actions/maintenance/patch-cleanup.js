'use strict';
/**
 * @module maintenance/patch-cleanup
 * @role 清理 pending_patches 裡過期未處理的 patch（超過 72h）
 * @llm-free true
 */
const fs = require('fs');
const path = require('path');
const MaintenanceAction = require('./base');

const PATCHES_PATH = path.join(process.cwd(), 'memory', 'pending-patches.json');
const EXPIRE_MS = 72 * 3600000; // 72 小時

class PatchCleanupAction extends MaintenanceAction {
    constructor(deps) { super(deps, 'patch_cleanup'); }

    async run() {
        let patches = [];
        try {
            if (!fs.existsSync(PATCHES_PATH)) {
                this._record('skipped', { reason: 'no_patches_file' });
                return { success: true, skipped: true };
            }
            patches = JSON.parse(fs.readFileSync(PATCHES_PATH, 'utf8'));
            if (!Array.isArray(patches)) patches = [];
        } catch (e) {
            this._record('error', { error: e.message });
            return { success: false, error: e.message };
        }

        const now = Date.now();
        const before = patches.length;
        const expired = patches.filter(p => {
            const age = now - new Date(p.ts || p.createdAt || 0).getTime();
            return age > EXPIRE_MS && p.status === 'pending';
        });
        const kept = patches.filter(p => !expired.includes(p));

        if (expired.length > 0) {
            console.log(`🧹 [PatchCleanup] 清理 ${expired.length} 個過期 patch`);
        } else {
            console.log(`🧹 [PatchCleanup] 無過期 patch（共 ${before} 個）`);
        }

        // patch 結果回寫 registry（已 resolve 且尚未回寫的條目）
        const providerRegistry = require('../../../model-router/provider-registry');
        const resolved = kept.filter(p =>
            (p.status === 'dropped' || p.status === 'deployed') &&
            p.model &&
            !p.patchFeedbackWritten
        );

        let feedbackWritten = 0;
        for (const p of resolved) {
            const score = p.status === 'deployed' ? 1 : 0;
            const slashIdx = p.model.indexOf('/');
            if (slashIdx === -1) continue;
            const provider = p.model.slice(0, slashIdx);
            const model = p.model.slice(slashIdx + 1);

            try {
                const info = providerRegistry.getModelInfo(provider, model);
                const prev = info?.patchScores?.code_edit;
                const count = info?.patchScores?.code_edit_count || 0;
                let newScore;
                if (count < 5) {
                    newScore = prev == null ? score : (prev * count + score) / (count + 1);
                } else {
                    newScore = prev * 0.7 + score * 0.3;
                }
                providerRegistry.updateModelStatus(provider, model, {
                    patchScores: {
                        ...(info?.patchScores || {}),
                        code_edit: Math.round(newScore * 1000) / 1000,
                        code_edit_count: count + 1,
                        code_edit_last: new Date().toISOString(),
                    }
                });
                p.patchFeedbackWritten = true;
                feedbackWritten++;
                console.log(`  📊 [PatchCleanup] ${p.model} code_edit patch score: ${prev?.toFixed(2) ?? 'new'} → ${newScore.toFixed(2)} (${p.status})`);
            } catch (e) {
                console.warn(`  ⚠️ [PatchCleanup] patch score 回寫失敗 ${p.model}: ${e.message}`);
            }
        }

        // 清理或 feedback 任一有改動都寫回（使用 kept，避免重新引入 expired）
        if (expired.length > 0 || feedbackWritten > 0) {
            fs.writeFileSync(PATCHES_PATH, JSON.stringify(kept, null, 2));
        }

        const summary = `清理 ${expired.length} 個過期 patch，保留 ${kept.length} 個，回寫 ${feedbackWritten} 個 patch 分數`;
        this._record('completed', { before, removed: expired.length, kept: kept.length, feedbackWritten, summary });
        return { success: true, summary, removed: expired.length, kept: kept.length, feedbackWritten };
    }
}

module.exports = PatchCleanupAction;
