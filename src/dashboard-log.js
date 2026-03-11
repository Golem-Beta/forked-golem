/**
 * 📟 DashboardLog — blessed 終端機 Log 面板（console 覆寫）
 * 依賴：fs, path（Node built-in）
 */
'use strict';
const fs = require('fs');

class DashboardLog {
    constructor(dashboard) {
        this._d = dashboard;
    }

    // =========================================================
    // Console 攔截 (v8.5 增強版)
    // =========================================================
    setupOverride() {
        console.log = (...args) => {
            if (this._d.isDetached) {
                this._d.originalLog(...args);
                const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
                this._writeLog('LOG', msg);
                return;
            }

            let msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');

            // --- v8.5 Neuro-Link 色彩增強邏輯 ---
            let logMsg = msg;

            // 1. CDP 網路層訊號 (Cyan/Blue)
            if (msg.includes('[CDP]')) {
                logMsg = `{cyan-fg}${msg}{/cyan-fg}`;
            }
            // 2. DOM 視覺層訊號 (Yellow)
            else if (msg.includes('[DOM]') || msg.includes('[F12]')) {
                logMsg = `{yellow-fg}${msg}{/yellow-fg}`;
            }
            // 3. Brain 決策訊號 (Magenta)
            else if (msg.includes('[Brain]')) {
                logMsg = `{magenta-fg}${msg}{/magenta-fg}`;
            }
            // 4. OpticNerve 視覺訊號 (Blue)
            else if (msg.includes('[OpticNerve]') || msg.includes('[Vision]')) {
                logMsg = `{blue-fg}${msg}{/blue-fg}`;
            }

            // 寫入日誌面板（加 HH:MM 時間戳）逐行送入避免多行字串破圖
            if (this._d.logBox) {
                const _ts1 = this._d._ts();
                logMsg.split('\n').filter(l => l.trim()).forEach(l => {
                    this._d.logBox.log('{blue-fg}' + _ts1 + '{/}' + ' ' + l);
                });
            }

            // 📝 同步寫入 log 檔
            this._writeLog('LOG', msg);

            // 分流邏輯：Autonomy / Chronos → radarLog
            if (msg.includes('[Autonomy]') || msg.includes('[Decision]') || msg.includes('[GitHub]') || msg.includes('[LifeCycle]')) {
                if (this._d.radarLog) this._d.radarLog.log('{blue-fg}' + this._d._ts() + '{/}' + ' ' + `{cyan-fg}${msg}{/cyan-fg}`);
            }
            else if (msg.includes('[Chronos]') || msg.includes('排程')) {
                if (this._d.radarLog) this._d.radarLog.log('{blue-fg}' + this._d._ts() + '{/}' + ' ' + `{yellow-fg}${msg}{/yellow-fg}`);
            }
            // 分流邏輯：TitanQ / Queue → chatBox
            else if (msg.includes('[TitanQ]') || msg.includes('[Queue]')) {
                if (this._d.chatBox) this._d.chatBox.log(`{magenta-fg}${msg}{/magenta-fg}`);
                if (msg.includes('合併')) this._d.queueCount = Math.max(0, (this._d.queueCount || 0) - 1);
            }
            // 分流邏輯：三流協定 → chatBox
            if (msg.includes('[💬 REPLY]') || msg.includes('[GOLEM_REPLY]') || msg.includes('—-回覆開始—-')) {
                const text = msg.replace('[💬 REPLY]', '').replace('[GOLEM_REPLY]', '').replace('—-回覆開始—-', '').substring(0, 60);
                if (this._d.chatBox) this._d.chatBox.log(`\x1b[36m[回覆]\x1b[0m ${text}...`);
            }
            else if (msg.includes('[🤖 ACTION_PLAN]') || msg.includes('[GOLEM_ACTION]')) {
                if (this._d.chatBox) this._d.chatBox.log(`\x1b[33m[行動]\x1b[0m 偵測到指令`);
            }
            else if (msg.includes('[🧠 MEMORY_IMPRINT]') || msg.includes('[GOLEM_MEMORY]')) {
                if (this._d.chatBox) this._d.chatBox.log(`\x1b[35m[記憶]\x1b[0m 寫入記憶`);
            }
        };

        console.error = (...args) => {
            if (this._d.isDetached) {
                this._d.originalError(...args);
                const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
                this._writeLog('ERR', msg);
                return;
            }
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            if (this._d.logBox) {
                const _ts2 = this._d._ts();
                msg.split('\n').filter(l => l.trim()).forEach((l, i) => {
                    const prefix = i === 0 ? '[錯誤] ' : '  ';
                    this._d.logBox.log('{blue-fg}' + _ts2 + '{/}' + ' ' + `{red-fg}${prefix}${l}{/red-fg}`);
                });
            }

            // 📝 同步寫入 log 檔
            this._writeLog('ERR', msg);
        };

        console.warn = (...args) => {
            if (this._d.isDetached) {
                this._d.originalWarn(...args);
                const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
                this._writeLog('WARN', msg);
                return;
            }
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            if (this._d.logBox) {
                const _ts3 = this._d._ts();
                msg.split('\n').filter(l => l.trim()).forEach((l, i) => {
                    const prefix = i === 0 ? '⚠️ ' : '  ';
                    this._d.logBox.log('{blue-fg}' + _ts3 + '{/}' + ' ' + `{yellow-fg}${prefix}${l}{/yellow-fg}`);
                });
            }

            // 分流：429 / KeyChain 相關 → radarLog
            if (msg.includes('[Brain]') || msg.includes('[KeyChain]') || msg.includes('429')) {
                if (this._d.radarLog) this._d.radarLog.log(`{yellow-fg}${msg}{/yellow-fg}`);
            }

            // 📝 同步寫入 log 檔
            this._writeLog('WARN', msg);
        };
    }

    // =========================================================
    // 📝 日誌檔案管理
    // =========================================================
    _initLogStream() {
        const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
        try {
            if (fs.existsSync(this._d.logFilePath)) {
                const stat = fs.statSync(this._d.logFilePath);
                if (stat.size > MAX_LOG_SIZE) {
                    fs.renameSync(this._d.logFilePath, this._d.logFilePath + '.old');
                }
            }
            this._logStream = fs.createWriteStream(this._d.logFilePath, { flags: 'a' });
            this._logStream.write(`\n=== Golem Dashboard Log Started: ${new Date().toISOString()} ===\n\n`);
        } catch (e) {
            this._d.originalError('⚠️ 無法建立 log 檔:', e.message);
            this._logStream = null;
        }
    }

    _writeLog(level, msg) {
        if (!this._logStream) return;
        try {
            const _d = new Date();
            const _p = Object.fromEntries(new Intl.DateTimeFormat('zh-TW', {
                timeZone: 'Asia/Taipei', hour12: false,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            }).formatToParts(_d).map(p => [p.type, p.value]));
            const ts = `${_p.year}-${_p.month}-${_p.day} ${_p.hour}:${_p.minute}:${_p.second}`;
            // 🔧 [v8.5.2] 只去除 blessed 色彩/格式標籤，保留 JSON 大括號
            const clean = msg.replace(/\{\/?(?:[\w]+-fg|[\w]+-bg|bold|underline|blink|inverse|invisible)\}/g, '');
            // 🔧 [v9.7.0] 多行訊息逐行加 timestamp，避免 groq 行沒 timestamp
            const lines = clean.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    this._logStream.write(`[${ts}] [${level}] ${line}\n`);
                }
            }
        } catch (e) {
            // 寫入失敗不影響主程式
        }
    }
}

module.exports = DashboardLog;
