/**
 * GoogleCommands — Gmail / Calendar / Tasks / Drive 指令處理
 * 依賴：googleServices (GoogleServices), gcpAuth (GCPAuth)
 */
class GoogleCommands {
    constructor({ googleServices, gcpAuth }) {
        this.googleServices = googleServices;
        this.gcpAuth = gcpAuth;
    }

    _guard(ctx) {
        if (!this.googleServices || !this.gcpAuth.isAuthenticated()) {
            ctx.reply('⚠️ Google 尚未授權，請等待 Golem 發送授權連結');
            return false;
        }
        return true;
    }

    _simplifyMime(mimeType) {
        if (!mimeType) return '未知';
        const map = {
            'application/vnd.google-apps.document':     'Google Doc',
            'application/vnd.google-apps.spreadsheet':  '試算表',
            'application/vnd.google-apps.presentation': '簡報',
            'application/vnd.google-apps.folder':       '資料夾',
        };
        if (map[mimeType]) return map[mimeType];
        const slash = mimeType.lastIndexOf('/');
        return slash >= 0 ? mimeType.slice(slash + 1) : mimeType;
    }

    async gmail(ctx) {
        if (!this._guard(ctx)) return;
        await ctx.sendTyping();
        try {
            const msgs = await this.googleServices.listUnread(10);
            if (!msgs.length) { await ctx.reply('📭 沒有未讀郵件'); return; }
            const lines = [`📬 Gmail 未讀（${msgs.length} 封）`];
            msgs.forEach((m, i) => {
                lines.push('');
                lines.push(`${i + 1}. 寄件人：${m.from}`);
                lines.push(`   主旨：${m.subject || '（無主旨）'}`);
                if (m.snippet) lines.push(`   摘要：${m.snippet.substring(0, 80)}`);
                lines.push(`   時間：${m.date}`);
            });
            await ctx.reply(lines.join('\n'));
        } catch (e) {
            await ctx.reply(`❌ Gmail 讀取失敗：${e.message}`);
        }
    }

    async calendar(ctx) {
        if (!this._guard(ctx)) return;
        const parts = ctx.text.trim().split(/\s+/);
        const days = parseInt(parts[1], 10) || 7;
        await ctx.sendTyping();
        try {
            const events = await this.googleServices.listEvents(days);
            if (!events.length) { await ctx.reply(`📅 未來 ${days} 天沒有行程`); return; }
            const lines = [`📅 未來 ${days} 天行程（${events.length} 項）`];
            for (const ev of events) {
                lines.push('');
                lines.push(`• ${ev.title || '（無標題）'}`);
                lines.push(`  🕐 ${ev.start} → ${ev.end}`);
                if (ev.location) lines.push(`  📍 ${ev.location}`);
            }
            await ctx.reply(lines.join('\n'));
        } catch (e) {
            await ctx.reply(`❌ Calendar 讀取失敗：${e.message}`);
        }
    }

    async tasks(ctx) {
        if (!this._guard(ctx)) return;
        await ctx.sendTyping();
        try {
            const tasks = await this.googleServices.listTasks(20);
            if (!tasks.length) { await ctx.reply('✅ 沒有待辦事項'); return; }
            const lines = [`✅ Tasks 待辦（${tasks.length} 項）`];
            for (const t of tasks) {
                const due = t.due ? t.due.substring(0, 10) : '無';
                lines.push('');
                lines.push(`• ${t.title}（截止：${due}）`);
                if (t.notes) lines.push(`  ${t.notes.substring(0, 50)}`);
            }
            await ctx.reply(lines.join('\n'));
        } catch (e) {
            await ctx.reply(`❌ Tasks 讀取失敗：${e.message}`);
        }
    }

    async drive(ctx) {
        if (!this._guard(ctx)) return;
        const query = ctx.text.replace(/^\/drive\s*/i, '').trim();
        await ctx.sendTyping();
        try {
            const files = await this.googleServices.listFiles(query, 10);
            if (!files.length) { await ctx.reply('📁 沒有找到相關檔案'); return; }
            const lines = [`📁 Drive 檔案（${files.length} 筆）`];
            for (const f of files) {
                const mtime = f.modifiedTime ? f.modifiedTime.substring(0, 10) : '未知';
                lines.push('');
                lines.push(`• ${f.name}`);
                lines.push(`  類型：${this._simplifyMime(f.mimeType)}`);
                lines.push(`  修改：${mtime}`);
            }
            await ctx.reply(lines.join('\n'));
        } catch (e) {
            await ctx.reply(`❌ Drive 讀取失敗：${e.message}`);
        }
    }
}

module.exports = GoogleCommands;
