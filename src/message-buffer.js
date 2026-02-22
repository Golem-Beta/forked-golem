/**
 * 📦 Titan Queue — 訊息防抖合併 + Per-chat 序列化
 * 零外部依賴
 */
class MessageBuffer {
    constructor(options = {}) {
        this.DEBOUNCE_MS = options.debounceMs || 1500;
        this.buffers = new Map();
        this.processCallback = options.onFlush || (() => {});
    }

    push(ctx, hasMedia = false) {
        const chatId = ctx.chatId;
        const text = ctx.text || '';

        if (!this.buffers.has(chatId)) {
            this.buffers.set(chatId, {
                texts: [], latestCtx: null, timer: null,
                isProcessing: false, queue: []
            });
        }

        const buf = this.buffers.get(chatId);

        if (hasMedia) {
            if (buf.texts.length > 0) {
                this._enqueue(chatId, buf.texts.join('\n'), buf.latestCtx, false);
                buf.texts = [];
                buf.latestCtx = null;
                if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
            }
            this._enqueue(chatId, text, ctx, true);
            return;
        }

        if (text.trim()) buf.texts.push(text);
        buf.latestCtx = ctx;

        if (buf.timer) clearTimeout(buf.timer);
        buf.timer = setTimeout(() => this._flush(chatId), this.DEBOUNCE_MS);
    }

    _flush(chatId) {
        const buf = this.buffers.get(chatId);
        if (!buf) return;
        buf.timer = null;

        if (buf.texts.length > 0 && buf.latestCtx) {
            const merged = buf.texts.join('\n');
            if (buf.texts.length > 1) {
                console.log(`📦 [TitanQ] 合併 ${buf.texts.length} 條碎片訊息 → ${merged.length} chars (chat: ${chatId})`);
            }
            this._enqueue(chatId, merged, buf.latestCtx, false);
            buf.texts = [];
            buf.latestCtx = null;
        }
    }

    _enqueue(chatId, mergedText, ctx, hasMedia) {
        const buf = this.buffers.get(chatId);
        buf.queue.push({ text: mergedText, ctx, hasMedia });
        this._processNext(chatId);
    }

    async _processNext(chatId) {
        const buf = this.buffers.get(chatId);
        if (!buf || buf.isProcessing || buf.queue.length === 0) return;

        buf.isProcessing = true;
        const item = buf.queue.shift();

        try {
            await this.processCallback(item.ctx, item.text, item.hasMedia);
        } catch (e) {
            console.error(`❌ [TitanQ] 處理失敗 (chat: ${chatId}): ${e.message}`);
        } finally {
            buf.isProcessing = false;
            if (buf.texts.length > 0 && buf.timer) return;
            if (buf.queue.length > 0) {
                this._processNext(chatId);
            } else if (buf.texts.length === 0) {
                this.buffers.delete(chatId);
            }
        }
    }
}

module.exports = MessageBuffer;
