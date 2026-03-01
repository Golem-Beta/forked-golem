'use strict';
/**
 * @module message-manager
 * @role MessageManager — 多平台訊息傳送（分塊、Telegram + Discord 適配）
 * @when-to-modify 調整訊息長度上限、新增平台、或 Discord 按鈕格式時
 */

// Discord.js components — optional, only needed if Discord is active
let ActionRowBuilder, ButtonBuilder, ButtonStyle;
try {
    ({ ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'));
} catch (e) { /* Discord not installed */ }

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

module.exports = MessageManager;
