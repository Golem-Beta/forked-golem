/**
 * 📨 Notifier — Telegram/Discord 訊息發送 + tri-stream 解析
 *
 * 依賴注入：tgBot, dcClient, config, brain, TriStreamParser
 */

class Notifier {
    /**
     * @param {object} deps
     * @param {object} deps.tgBot - grammy Bot instance (nullable)
     * @param {object} deps.dcClient - Discord.js Client (nullable)
     * @param {object} deps.config - CONFIG 物件
     * @param {object} deps.brain - GolemBrain instance
     * @param {object} deps.TriStreamParser - TriStreamParser class
     */
    constructor({ tgBot, dcClient, config, brain, TriStreamParser }) {
        this.tgBot = tgBot;
        this.dcClient = dcClient;
        this.config = config;
        this.brain = brain;
        this.TriStreamParser = TriStreamParser;
        // 靜默時段暫存 queue（{ text, ts }[]）
        this._quietQueue = [];
        this.quietMode = false;
    }

    /**
     * 由 AutonomyManager 控制靜默模式
     */
    setQuietMode(val) {
        this.quietMode = !!val;
    }

    /**
     * 取出並清空靜默 queue
     */
    drainQuietQueue() {
        const items = this._quietQueue.slice();
        this._quietQueue = [];
        return items;
    }

    /**
     * 發送純文字到管理員（自動分段）
     */
    async sendToAdmin(text) {
        if (!text) {
            console.warn('[Notifier] sendToAdmin received empty text, skip');
            return false;
        }
        // 靜默時段：暫存，不發送
        if (this.quietMode) {
            this._quietQueue.push({ text, ts: new Date().toISOString() });
            console.log('[Notifier] 靜默時段，訊息暫存 (queue=' + this._quietQueue.length + ')');
            return false;
        }
        const TG_MAX = 4000;
        try {
            if (this.tgBot && this.config.ADMIN_IDS[0]) {
                if (text.length <= TG_MAX) {
                    await this.tgBot.api.sendMessage(this.config.ADMIN_IDS[0], text);
                    console.log('[Notifier] TG sent OK (' + text.length + ' chars)');
                    return true;
                } else {
                    const chunks = [];
                    let current = '';
                    for (const line of text.split('\n')) {
                        if ((current + '\n' + line).length > TG_MAX && current) {
                            chunks.push(current);
                            current = line;
                        } else {
                            current = current ? current + '\n' + line : line;
                        }
                    }
                    if (current) chunks.push(current);
                    const finalChunks = [];
                    for (const chunk of chunks) {
                        if (chunk.length <= TG_MAX) {
                            finalChunks.push(chunk);
                        } else {
                            for (let i = 0; i < chunk.length; i += TG_MAX) {
                                finalChunks.push(chunk.slice(i, i + TG_MAX));
                            }
                        }
                    }
                    console.log(`📨 [Notifier] 訊息過長 (${text.length} chars)，分 ${finalChunks.length} 段發送`);
                    for (const chunk of finalChunks) {
                        await this.tgBot.api.sendMessage(this.config.ADMIN_IDS[0], chunk);
                    }
                    console.log('[Notifier] TG sent OK (' + text.length + ' chars, chunked)');
                    return true;
                }
            } else if (this.dcClient && this.config.DISCORD_ADMIN_ID) {
                const user = await this.dcClient.users.fetch(this.config.DISCORD_ADMIN_ID);
                await user.send(text.slice(0, 2000));
            }
        } catch (e) {
            console.error('[Notifier] send FAILED:', e); // Log full error object for better diagnosis
            return false;
        }
        return false;
    }

    /**
     * 中間層：tri-stream 解析 → memorize → 發送 reply
     */
    async sendNotification(msgText) {
        try {
            const parsed = this.TriStreamParser.parse(msgText);
            if (parsed.memory) {
                await this.brain.memorize(parsed.memory, { type: 'autonomy', timestamp: Date.now() });
            }
            const replyText = parsed.reply;
            if (!replyText) return false;
            return await this.sendToAdmin(replyText);
        } catch (e) {
            console.warn('[Notifier] 分流失敗，使用原始文字:', e.message);
            return await this.sendToAdmin(msgText);
        }
    }
}

module.exports = Notifier;
