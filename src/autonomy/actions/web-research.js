/**
 * @module web-research
 * @role 網路研究行動 — 選題 → Grounding 搜尋 → 匯報
 * @when-to-modify 調整搜尋 prompt、Grounding 工具呼叫、或匯報格式時
 *
 * [2026-03-03] BaseAction pilot：使用 _abortIfChannelDown / _sentOutcome / _sentErrorField / _handleError
 */

const BaseAction = require('./base-action');

class WebResearchAction extends BaseAction {
    constructor({ journal, notifier, decision, loadPrompt, memoryLayer }) {
        super({ journal, notifier, decision, loadPrompt });
        this.memory = memoryLayer || null;
    }

    async performWebResearch(decisionReason = '') {
        try {
            const abort = this._abortIfChannelDown('web_research');
            if (abort) return abort;

            const soul = this.decision.readSoul();
            const recentJournal = this.journal.readRecent(5);

            // 三層記憶：避免重複研究已知主題
            let memoryContextSection = '';
            try {
                if (this.memory) {
                    const soulGoals = soul.substring(0, 200);
                    const recentTopics = recentJournal.map(j => j.topic || j.action).filter(Boolean).join(' ');
                    const { warm, cold } = this.memory.recall(soulGoals + ' ' + recentTopics, { hotLimit: 0, warmLimit: 1, coldLimit: 2 });
                    const memCtx = [warm, cold].filter(Boolean).join('\n');
                    memoryContextSection = memCtx ? '【已知相關知識（避免重複研究）】\n' + memCtx : '';
                }
            } catch (e) { /* 記憶召回失敗不影響主流程 */ }

            const topicPrompt = this.loadPrompt('web-research-topic.md', {
                SOUL: soul,
                RECENT_JOURNAL: JSON.stringify(recentJournal.slice(-5), null, 0),
                DECISION_REASON: decisionReason,
                MEMORY_CONTEXT: memoryContextSection
            }) || `你是 Golem。根據你的目標和經驗，你決定要上網研究一個主題。
決策理由：${decisionReason}
用 JSON 回覆：{"query": "搜尋關鍵字（英文）", "purpose": "為什麼要研究這個"}`;

            const topicRaw = (await this.decision.callLLM(topicPrompt, { temperature: 0.7, intent: 'decision' })).text;
            const topicCleaned = topicRaw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            let topicData;
            try {
                topicData = JSON.parse(topicCleaned);
            } catch {
                console.warn('🌐 [WebResearch] 主題 JSON 解析失敗，啟動降級機制');
                topicData = {
                    query: 'AI agent autonomous evolution',
                    purpose: 'fallback due to topic parse failure: ' + decisionReason
                };
                this.journal.append({ action: 'web_research', outcome: 'topic_parse_fallback', detail: 'json_error' });
            }

            const query = topicData.query || 'AI agent architecture';
            const purpose = topicData.purpose || decisionReason;
            console.log('🌐 [WebResearch] 搜尋主題: ' + query + ' | 目的: ' + purpose);

            const searchPrompt = '搜尋並用繁體中文摘要以下主題的最新資訊（200-300字）：\n' +
                '主題：' + query + '\n' +
                '重點：' + purpose + '\n' +
                '請包含具體的數據、版本號、日期等事實性資訊。如果找到相關的工具或專案，列出名稱和網址。';

            const searchResult = await this.decision.callLLM(searchPrompt, {
                temperature: 0.5, intent: 'analysis',
                tools: [{ googleSearch: {} }],
            });
            const text = searchResult.text;
            const grounding = searchResult.grounding;

            const reflectionFile = this.decision.saveReflection('web_research', text);
            const sourcesBlock = (grounding && grounding.sources && grounding.sources.length > 0)
                ? '\n\n---\n📎 來源：\n' + grounding.sources.slice(0, 5).map(s => `• ${s.title || s.url}`).join('\n')
                : '';
            const parts = [
                '🌐 網路研究報告',
                '🔎 主題: ' + query,
                '💡 目的: ' + purpose,
                '', text + sourcesBlock
            ].filter(Boolean).join('\n');
            const sentWR = await this.notifier.sendToAdmin(parts);
            console.log('[WebResearch] sendToAdmin:', sentWR === true ? '✅ OK' : '❌ FAILED');

            this.journal.append({
                action: 'web_research', topic: query, purpose: purpose,
                outcome: this._sentOutcome(sentWR, 'shared'),
                reflection_file: reflectionFile,
                grounded: grounding !== null,
                sources: grounding ? grounding.sources.length : 0,
                ...this._sentErrorField(sentWR)
            });
            if (sentWR === true) console.log('✅ [WebResearch] 研究報告已發送: ' + query);
            return { success: sentWR === true, action: 'web_research', outcome: this._sentOutcome(sentWR, 'shared') };
        } catch (e) {
            return this._handleError('web_research', e);
        }
    }
}

module.exports = WebResearchAction;
