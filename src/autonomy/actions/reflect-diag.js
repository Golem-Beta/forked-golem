/**
 * @module reflect-diag
 * @role Self-reflection Phase 1 — 診斷當前問題，產出改進方向
 * @when-to-modify 調整診斷提示詞、歷史 reflection 讀取數量、或診斷輸出 schema 時
 */

class ReflectDiag {
    constructor({ journal, notifier, decision, memory, memoryLayer }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
        this.memory = memory;              // 舊 ExperienceMemory（getAdvice 用）
        this.memoryLayer = memoryLayer || null; // 新三層記憶召回
    }

    /**
     * Phase 1 診斷
     * @param {string} journalContext - 已格式化的最近日誌字串
     * @param {object|null} triggerCtx - Telegram context（手動觸發時）
     * @returns {{ diag: object, diagFile: string } | null} 解析成功返回診斷物件，否則 null
     */
    async run(journalContext, triggerCtx) {
        const advice = this.memory ? this.memory.getAdvice() : '';
        const soul = this.decision.readSoul();
        const fileList = this.decision.getProjectFileList();

        // 加入歷史 reflection 記錄，讓 Golem 知道上次診斷了什麼、成功還是失敗
        const recentReflections = this.journal.readRecent(50)
            .filter(j => j.action === 'self_reflection')
            .slice(-5)
            .map(j => {
                const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                const detail = [j.outcome, j.diagnosis, j.description, j.reason].filter(Boolean).join(' / ');
                return '[' + time + '] ' + (j.mode || 'phase1') + ' outcome=' + detail;
            }).join('\n') || '(無歷史記錄)';

        // 三層記憶：取過去 github/web 探索的相關洞察（Phase 1 尚無 diag，以 soul + 近期 journal 作查詢）
        let coldInsights = '';
        let warmInsights = '';
        try {
            const diagQuery = (soul.substring(0, 200) + ' ' + journalContext.substring(0, 200)).trim();
            if (this.memoryLayer && diagQuery) {
                const { warm, cold } = this.memoryLayer.recall(diagQuery, { hotLimit: 0, warmLimit: 2, coldLimit: 3 });
                warmInsights = warm || '';
                coldInsights = cold || '';
            }
        } catch (e) { /* 記憶召回失敗不影響診斷 */ }

        const diagPrompt = [
            '你是 Golem，一個自律型 AI Agent。你正在做自我反省。',
            '', '【靈魂文件】', soul,
            '', '【最近經驗】', journalContext,
            '', '【歷史 reflection 結果（最近 5 次）】', recentReflections,
            '', '【老哥的建議】', advice || '(無)',
            '', '【過去探索的相關洞察（冷層召回）】', coldInsights || '(無)',
            '', '【近期歸納文件摘要（溫層）】', warmInsights || '(無)',
            '', '【專案檔案清單（含行數）】', fileList,
            '', '【要求】',
            '根據你最近的經驗（特別是失敗、錯誤、或可改進的地方），判斷：',
            '1. 你想改進什麼？（具體描述問題，避免與歷史 reflection 重複診斷同樣問題）',
            '2. 需要看哪個檔案的哪個函式或區段？',
            '3. 改進方案的大致方向（不需要寫程式碼）',
            '', '用 JSON 回覆：',
            '{"diagnosis": "問題描述", "target_file": "src/autonomy/actions.js", "approach": "改進方向"}',
            '注意：target_file 必須是上方檔案清單中的完整路徑（例如 src/brain.js, src/autonomy/decision.js）',
            '只輸出 JSON。如果你認為目前沒有需要改進的地方，回覆：',
            '{"diagnosis": "none", "reason": "為什麼不需要改進"}',
        ].join('\n');

        console.log('🧬 [Reflection] Phase 1: 診斷...');
        const diagRaw = (await this.decision.callLLM(diagPrompt, { temperature: 0.5, intent: 'analysis' })).text;
        const diagFile = this.decision.saveReflection('self_reflection_diag', diagRaw);

        let diag;
        try {
            const cleaned = diagRaw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            diag = JSON.parse(cleaned);
        } catch (e) {
            console.warn('🧬 [Reflection] 診斷 JSON 解析失敗:', e.message);
            this.journal.append({ action: 'self_reflection', phase: 'diagnosis', outcome: 'parse_failed', reflection_file: diagFile });
            if (!triggerCtx) {
                const errMsg = '🧬 [self_reflection] Phase 1 診斷解析失敗: ' + e.message + '\n(輸出已存至 ' + diagFile + ')';
                await this.notifier.sendToAdmin(errMsg);
            }
            return null;
        }

        if (diag.diagnosis === 'none') {
            console.log('🧬 [Reflection] 診斷結果：目前無需改進 — ' + (diag.reason || ''));
            this.journal.append({ action: 'self_reflection', phase: 'diagnosis', outcome: 'no_issues', reason: diag.reason, reflection_file: diagFile });
            return null;
        }

        console.log('🧬 [Reflection] 診斷: ' + diag.diagnosis);
        console.log('🧬 [Reflection] 目標: ' + (diag.target_file || 'src/autonomy/actions.js'));
        return { diag, diagFile };
    }
}

module.exports = ReflectDiag;
