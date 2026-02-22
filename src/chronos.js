/**
 * ⏰ ChronosManager — 時間排程系統
 * 依賴：fs, path (Node built-in)
 * 構造注入：{ tgBot, adminChatId }
 */
const fs = require('fs');
const path = require('path');

class ChronosManager {
    constructor(deps = {}) {
        this.schedulePath = path.join(process.cwd(), 'memory', 'schedules.json');
        this.timers = new Map();
        this._tgBot = deps.tgBot || null;
        this._adminChatId = deps.adminChatId || null;
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.schedulePath)) {
                const data = JSON.parse(fs.readFileSync(this.schedulePath, 'utf-8'));
                this.schedules = Array.isArray(data) ? data : [];
            } else {
                this.schedules = [];
            }
        } catch (e) {
            console.warn('[Chronos] 讀取排程檔失敗:', e.message);
            this.schedules = [];
        }
    }

    _save() {
        try {
            const dir = path.dirname(this.schedulePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.schedulePath, JSON.stringify(this.schedules, null, 2));
        } catch (e) {
            console.error('[Chronos] 寫入失敗:', e.message);
        }
    }

    rebuild() {
        for (const [id, handle] of this.timers) clearTimeout(handle);
        this.timers.clear();

        const now = Date.now();
        const alive = [];
        let expiredCount = 0;

        for (const s of this.schedules) {
            if (s.fireAt <= now) { expiredCount++; this._fire(s, true); }
            else { alive.push(s); this._arm(s); }
        }

        this.schedules = alive;
        this._save();

        const total = alive.length + expiredCount;
        if (total > 0) {
            console.log(`⏰ [Chronos] 重建完成: ${alive.length} 個排程待觸發, ${expiredCount} 個過期補發`);
        }
    }

    _arm(schedule) {
        const delay = schedule.fireAt - Date.now();
        if (delay <= 0) { this._fire(schedule, false); return; }
        const handle = setTimeout(() => this._fire(schedule, false), delay);
        this.timers.set(schedule.id, handle);
    }

    _fire(schedule, isLate) {
        const lateNote = isLate ? ' (重啟後補發)' : '';
        const msg = `⏰ **定時提醒**${lateNote}\n${schedule.message}`;
        console.log(`⏰ [Chronos] 觸發: ${schedule.message}${lateNote}`);

        if (this._tgBot && this._adminChatId) {
            this._tgBot.api.sendMessage(this._adminChatId, msg).catch(e => {
                console.error('[Chronos] 發送失敗:', e.message);
            });
        }

        this.timers.delete(schedule.id);
        this.schedules = this.schedules.filter(s => s.id !== schedule.id);
        this._save();
    }

    add(minutes, message) {
        const mins = parseInt(minutes, 10);
        if (isNaN(mins) || mins <= 0) return '❌ 分鐘數必須是正整數';
        if (!message || !message.trim()) return '❌ 提醒內容不能為空';
        if (mins > 10080) return '❌ 最長排程 7 天 (10080 分鐘)';

        const id = `chr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const fireAt = Date.now() + mins * 60000;
        const schedule = { id, fireAt, message: message.trim(), createdAt: new Date().toISOString() };

        this.schedules.push(schedule);
        this._save();
        this._arm(schedule);

        const fireTime = new Date(fireAt);
        const timeStr = `${String(fireTime.getHours()).padStart(2, '0')}:${String(fireTime.getMinutes()).padStart(2, '0')}`;
        return `✅ 排程已設定: ${mins} 分鐘後 (${timeStr}) 提醒「${schedule.message}」 [id: ${id}]`;
    }

    list() {
        if (this.schedules.length === 0) return '⏰ 目前沒有任何排程';
        const now = Date.now();
        const lines = this.schedules.map(s => {
            const remaining = Math.max(0, Math.ceil((s.fireAt - now) / 60000));
            const fireTime = new Date(s.fireAt);
            const timeStr = `${String(fireTime.getHours()).padStart(2, '0')}:${String(fireTime.getMinutes()).padStart(2, '0')}`;
            return `  • [${s.id}] ${remaining} 分鐘後 (${timeStr}): ${s.message}`;
        });
        return `⏰ 現有 ${this.schedules.length} 個排程:\n${lines.join('\n')}`;
    }

    cancel(id) {
        const idx = this.schedules.findIndex(s => s.id === id);
        if (idx === -1) return `❌ 找不到排程: ${id}`;
        const removed = this.schedules.splice(idx, 1)[0];
        const handle = this.timers.get(id);
        if (handle) { clearTimeout(handle); this.timers.delete(id); }
        this._save();
        return `✅ 已取消排程: ${removed.message} [id: ${id}]`;
    }
}

module.exports = ChronosManager;
