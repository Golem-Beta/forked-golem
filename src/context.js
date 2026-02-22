/**
 * 🔌 UniversalContext + 👁️ OpticNerve + 📨 MessageManager
 * 依賴：https (Node built-in), CONFIG, InputFile, Discord.js components
 */
const https = require('https');
const CONFIG = require('./config');

// Discord.js components — optional, only needed if Discord is active
let ActionRowBuilder, ButtonBuilder, ButtonStyle, InputFile;
try {
    ({ ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'));
} catch (e) { /* Discord not installed */ }
try {
    ({ InputFile } = require('grammy'));
} catch (e) { /* grammy not installed — shouldn't happen */ }

class OpticNerve {
    static async analyze(fileUrl, mimeType, router) {
        console.log(`👁️ [OpticNerve] 正在透過 ModelRouter 分析檔案 (${mimeType})...`);
        try {
            const buffer = await new Promise((resolve, reject) => {
                https.get(fileUrl, (res) => {
                    const data = [];
                    res.on('data', (chunk) => data.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(data)));
                    res.on('error', reject);
                });
            });
            const prompt = mimeType.startsWith('image/')
                ? "請詳細描述這張圖片的視覺內容。如果包含文字或程式碼，請完整轉錄。如果是介面截圖，請描述UI元件。請忽略無關的背景雜訊。"
                : "請閱讀這份文件，並提供詳細的摘要、關鍵數據與核心內容。";

            const result = await router.complete({
                intent: 'vision',
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 8192,
                temperature: 0.5,
                inlineData: { data: buffer.toString('base64'), mimeType },
            });

            console.log("✅ [OpticNerve] 分析完成 (長度: " + result.text.length + ", via " + result.meta.provider + ")");
            return result.text;
        } catch (e) {
            console.error("❌ [OpticNerve] 解析失敗:", e.message);
            return `(系統錯誤：視神經無法解析此檔案。原因：${e.message})`;
        }
    }
}

class MessageManager {
    static async send(ctx, text, options = {}) {
        if (!text) return;
        const MAX_LENGTH = ctx.platform === 'telegram' ? 4000 : 1900;
        const chunks = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= MAX_LENGTH) { chunks.push(remaining); break; }
            let splitIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
            if (splitIndex === -1) splitIndex = MAX_LENGTH;
            chunks.push(remaining.substring(0, splitIndex));
            remaining = remaining.substring(splitIndex).trim();
        }

        for (const chunk of chunks) {
            try {
                if (ctx.platform === 'telegram') {
                    await ctx.instance.api.sendMessage(ctx.chatId, chunk, options);
                } else {
                    const channel = await ctx.instance.channels.fetch(ctx.chatId);
                    const dcOptions = { content: chunk };
                    if (options.reply_markup && options.reply_markup.inline_keyboard && ActionRowBuilder) {
                        const row = new ActionRowBuilder();
                        options.reply_markup.inline_keyboard[0].forEach(btn => {
                            row.addComponents(new ButtonBuilder().setCustomId(btn.callback_data).setLabel(btn.text).setStyle(ButtonStyle.Primary));
                        });
                        dcOptions.components = [row];
                    }
                    await channel.send(dcOptions);
                }
            } catch (e) { console.error(`[MessageManager] 發送失敗 (${ctx.platform}):`, e.message); }
        }
    }
}

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

module.exports = { OpticNerve, UniversalContext, MessageManager };
