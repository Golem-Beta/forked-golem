/**
 * @module social
 * @role 主動社交行動 — 自發打招呼 + 回應追蹤
 * @when-to-modify 調整社交訊息生成邏輯、回應追蹤視窗、或社交提示詞時
 */

class SocialAction {
    constructor({ journal, notifier, decision, loadPrompt }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
        this.loadPrompt = loadPrompt;

        // 📬 30 分鐘回應追蹤
        this._pendingSocialChat = null;
    }

    async performSpontaneousChat() {
        const now = new Date();
        const timeCtx = this.decision.getTimeContext(now);
        const timeStr = timeCtx.display;
        const contextNote = timeCtx.period;

        const recentSocial = this.journal.readRecent(5)
            .filter(j => j.action === 'spontaneous_chat')
            .map(j => j.context || '')
            .join('; ');

        const soul = this.decision.readSoul();
        const prompt = this.loadPrompt('spontaneous-chat.md', {
            SOUL: soul,
            TIME_STR: timeStr,
            CONTEXT_NOTE: contextNote,
            RECENT_SOCIAL: recentSocial || '（無）'
        }) || `${soul}\n主動社交，時間：${timeStr}，簡短跟老哥打招呼。`;
        const msg = await this.decision.callLLM(prompt, { temperature: 0.9, intent: 'creative' });

        if (!msg || msg.trim().length === 0) {
            console.warn('[Social] LLM returned empty, skip send');
            this.journal.append({ action: 'spontaneous_chat', context: contextNote, outcome: 'empty_llm_response' });
            return;
        }

        // 過濾 TriStream 格式（LLM 偶爾輸出三流 tag，需取 reply 部分）
        const { TriStreamParser } = require('../../parsers');
        const parsed = TriStreamParser.parse(msg);
        const finalMsg = parsed.hasStructuredTags ? parsed.reply : msg;
        if (!finalMsg || finalMsg.trim().length === 0) {
            console.warn('[Social] TriStream parsed but reply empty (raw tag only), skip send');
            this.journal.append({ action: 'spontaneous_chat', context: contextNote, outcome: 'empty_llm_response' });
            return;
        }
        console.log('[Social] LLM generated ' + finalMsg.length + ' chars, sending...');
        const sent = await this.notifier.sendToAdmin(finalMsg);

        this.journal.append({
            action: 'spontaneous_chat',
            context: contextNote,
            outcome: sent ? 'sent' : 'send_failed',
            msg_length: msg.length,
            model: this.decision.lastModel,
            tokens: this.decision.lastTokens
        });

        if (!sent) {
            console.error('[Social] SEND FAILED! preview:', msg.substring(0, 80));
            return;
        }

        // 30 分鐘回應追蹤
        if (this._pendingSocialChat && this._pendingSocialChat.timer) {
            clearTimeout(this._pendingSocialChat.timer);
        }
        this._pendingSocialChat = {
            ts: new Date().toISOString(),
            context: contextNote,
            timer: setTimeout(() => {
                this.journal.append({
                    action: 'social_feedback',
                    outcome: 'no_response',
                    context: contextNote,
                    note: '老哥 30 分鐘內沒回應'
                });
                console.log('📬 [Social] 30 分鐘無回應，已記錄');
                this._pendingSocialChat = null;
            }, 30 * 60 * 1000)
        };
        return { success: sent, action: 'spontaneous_chat', outcome: sent ? 'sent' : 'send_failed' };
    }

    /**
     * 老哥回應回流 — 由 coordinator 轉發
     */
    onAdminReply(text) {
        if (!this._pendingSocialChat) return;
        clearTimeout(this._pendingSocialChat.timer);
        const context = this._pendingSocialChat.context;
        const waitMs = Date.now() - new Date(this._pendingSocialChat.ts).getTime();
        const waitMin = Math.round(waitMs / 60000);
        const preview = text.length > 80 ? text.substring(0, 80) + '...' : text;
        this.journal.append({
            action: 'social_feedback',
            outcome: 'replied',
            context: context,
            reply_preview: preview,
            response_time_min: waitMin
        });
        console.log('📬 [Social] 老哥回應了（' + waitMin + ' 分鐘後），已記錄');
        this._pendingSocialChat = null;
    }
}

module.exports = SocialAction;
