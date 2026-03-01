'use strict';
/**
 * @module context
 * @role UniversalContext — 跨平台（Telegram/Discord）訊息抽象層
 * @when-to-modify 新增平台、調整附件解析、或修改 admin 判斷邏輯時
 */
const CONFIG = require('./config');
const OpticNerve    = require('./optic-nerve');
const MessageManager = require('./message-manager');

// grammy InputFile — 附件上傳用
let InputFile;
try {
    ({ InputFile } = require('grammy'));
} catch (e) { /* grammy not installed — shouldn't happen */ }

class UniversalContext {
    constructor(platform, event, instance) {
        this.platform = platform;
        this.event = event;
        this.instance = instance;
    }

    get userId() {
        if (this.platform === 'telegram') {
            const from = this.event.from || this.event.callbackQuery?.from;
            return String(from.id);
        }
        return this.event.user ? this.event.user.id : this.event.author.id;
    }

    get chatId() {
        if (this.platform === 'telegram') {
            return this.event.chat?.id || this.event.callbackQuery?.message?.chat?.id;
        }
        return this.event.channelId || this.event.channel.id;
    }

    get text() {
        if (this.platform === 'telegram') {
            const msg = this.event.message || this.event.msg;
            return msg?.text || msg?.caption || "";
        }
        return this.event.content || "";
    }

    get replyText() {
        if (this.platform === 'telegram') {
            const msg = this.event.message || this.event.msg;
            const replied = msg?.reply_to_message;
            if (replied) return replied.text || replied.caption || "";
        }
        return "";
    }

    get messageTime() {
        if (this.platform === 'telegram' && this.event.message?.date) {
            return this.event.message.date * 1000;
        }
        if (this.platform === 'discord' && this.event.createdTimestamp) {
            return this.event.createdTimestamp;
        }
        return null;
    }

    async getAttachment() {
        if (this.platform === 'telegram') {
            const msg = this.event.message || this.event.msg;
            if (!msg) return null;
            let fileId = null;
            let mimeType = 'image/jpeg';

            if (msg.photo) fileId = msg.photo[msg.photo.length - 1].file_id;
            else if (msg.document) {
                fileId = msg.document.file_id;
                mimeType = msg.document.mime_type;
            }

            if (fileId && InputFile) {
                try {
                    const file = await this.instance.api.getFile(fileId);
                    return {
                        url: `https://api.telegram.org/file/bot${CONFIG.TG_TOKEN}/${file.file_path}`,
                        mimeType
                    };
                } catch (e) { console.error("TG File Error:", e); }
            }
        } else {
            const attachment = this.event.attachments && this.event.attachments.first();
            if (attachment) {
                return { url: attachment.url, mimeType: attachment.contentType || 'application/octet-stream' };
            }
        }
        return null;
    }

    get isAdmin() {
        if (CONFIG.ADMIN_IDS.length === 0) return true;
        return CONFIG.ADMIN_IDS.includes(this.userId);
    }

    async reply(content, options = {}) {
        return await MessageManager.send(this, content, options);
    }

    async sendDocument(filePath) {
        try {
            if (this.platform === 'telegram' && InputFile) {
                await this.instance.api.sendDocument(this.chatId, new InputFile(filePath));
            } else {
                const channel = await this.instance.channels.fetch(this.chatId);
                await channel.send({ files: [filePath] });
            }
        } catch (e) {
            if (e.message.includes('Request entity too large')) {
                await this.reply(`⚠️ 檔案過大，無法上傳 (Discord 限制 25MB)。\n路徑：\`${filePath}\``);
            } else {
                console.error(`[Context] 傳送檔案失敗: ${e.message}`);
                await this.reply(`❌ 傳送失敗: ${e.message}`);
            }
        }
    }

    async sendTyping() {
        if (this.platform === 'telegram') {
            this.instance.api.sendChatAction(this.chatId, 'typing');
        } else {
            const channel = await this.instance.channels.fetch(this.chatId);
            await channel.sendTyping();
        }
    }
}

// re-export OpticNerve + MessageManager 維持呼叫端向後相容
module.exports = { OpticNerve, UniversalContext, MessageManager };
