/**
 * 檔案名稱: dashboard.js
 * 版本: v8.5.3 (Reattach Edition)
 * ---------------------------------------
 * 更新重點：
 * 1. 支援 Neuro-Link 雙軌訊號的色彩高亮 (CDP vs DOM)。
 * 2. 狀態面板新增 Neuro-Link 狀態指示。
 * 3. 📝 [v8.5.1] 所有 log 同時寫入 golem.log，可透過 SSH tail -f 監看。
 * 4. 🔧 [v8.5.2] 修正 _writeLog 只去除 blessed 色彩標籤，不破壞 JSON 大括號。
 * 5. 🔄 [v8.5.3] F12 切換 detach/reattach，不再需要重啟 Golem。
 *    - detach 後在 console 按 F12 可重新叫出面板
 *    - 使用 stdin raw mode 監聽按鍵，不依賴 blessed
 */
const GOLEM_VERSION = require('../package.json').version;
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const os = require('os');
const fs = require('fs');
const path = require('path');

class DashboardPlugin {
    constructor() {
        // 保存原始的 Console 方法
        this.originalLog = console.log;
        this.originalError = console.error;
        this.originalWarn = console.warn;
        this.isDetached = false;

        // blessed UI 元件（detach 時會被清空）
        this.screen = null;
        this.grid = null;
        this.cpuLine = null;
        this.logBox = null;
        this.statusBox = null;
        this.providerBox = null;
        this.radarLog = null;
        this.chatBox = null;
        this.radarLog = null;
        this.footer = null;
        this.timer = null;

        // 狀態追蹤
        this.queueCount = 0;

        // HH:MM timestamp 產生器
        this._ts = () => {
            const now = new Date();
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            return h + ':' + m;
        };

        // stdin 按鍵監聯器（detach 狀態用）
        this._stdinListener = null;

        // 📝 日誌檔案初始化
        this.logFilePath = path.join(process.cwd(), 'golem.log');
        this._initLogStream();

        // 數據容器（跨 attach/detach 保留）
        this.memData = { title: 'RAM (MB)', x: Array(10).fill(' '), y: Array(10).fill(0), style: { line: 'red' } };

        // 首次建立 UI
        this._buildUI();
        this.setupOverride();
        this.startMonitoring();
    }

    /**
     * 注入外部依賴（取代 require.cache hack）
     * @param {{ modelRouter?, autonomy? }} deps
     */
    inject(deps) {
        if (deps.modelRouter) this._modelRouter = deps.modelRouter;
        if (deps.autonomy) this._autonomy = deps.autonomy;
    }

    // =========================================================
    // UI 建立 / 銷毀
    // =========================================================
    _buildUI() {
        this.isDetached = false;

        // 建立螢幕
        this.screen = blessed.screen({
            smartCSR: true,
            title: `🦞 Golem v${GOLEM_VERSION} 戰術控制台`,
            fullUnicode: true
        });

        // 建立網格 (12x12)
        this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

        // [左上] 系統負載 (RAM)
        this.cpuLine = this.grid.set(0, 0, 4, 6, contrib.line, {
            style: { line: "yellow", text: "green", baseline: "black" },
            label: '⚡ 系統負載 (RAM)',
            showLegend: true
        });

        // [右上] 狀態面板（含日期時間）
        this.statusBox = this.grid.set(0, 6, 3, 6, contrib.markdown, {
            label: '🧠 引擎狀態',
            style: { border: { fg: 'cyan' } }
        });

        // [右中上] API Provider 狀態
        this.providerBox = this.grid.set(3, 6, 3, 6, blessed.box, {
            label: '🚀 API Providers',
            tags: true,
            style: { fg: 'cyan' }
        });

        // [右中] Autonomy / Chronos 雷達
        this.radarLog = this.grid.set(6, 6, 2, 6, contrib.log, {
            fg: "yellow",
            selectedFg: "yellow",
            label: '⏰ Autonomy / Chronos',
            tags: true
        });

        // [左下] 核心日誌
        this.logBox = this.grid.set(4, 0, 8, 6, contrib.log, {
            fg: "green",
            selectedFg: "lightgreen",
            label: '📠 核心日誌 (Neuro-Link)',
            tags: true
        });

        // [右下] 三流協定 + Queue
        this.chatBox = this.grid.set(8, 6, 4, 6, contrib.log, {
            fg: "white",
            selectedFg: "cyan",
            label: '💬 三流協定 / Queue',
            tags: true
        });

        // 底部說明列
        this.footer = blessed.box({
            parent: this.screen,
            bottom: 0,
            left: 0,
            width: '100%',
            height: 1,
            content: ` {bold}F12{/bold}: Detach | {bold}Ctrl+C{/bold}: 停止 | {bold}v${GOLEM_VERSION}{/bold} `,
            style: { fg: 'black', bg: 'cyan' },
            tags: true
        });

        // 設定按鍵
        this._setupScreenKeys();

        this.screen.render();
    }

    _destroyUI() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.screen) {
            this.screen.destroy();
            this.screen = null;
        }
        this.grid = null;
        this.cpuLine = null;
        this.logBox = null;
        this.statusBox = null;
        this.providerBox = null;
        this.chatBox = null;
        this.footer = null;
    }

    // =========================================================
    // 按鍵監聽
    // =========================================================
    _setupScreenKeys() {
        // Ctrl+C / q = 完全停止
        this.screen.key(['C-c', 'q'], () => {
            this._destroyUI();
            console.log = this.originalLog;
            console.error = this.originalError;
            console.warn = this.originalWarn;
            console.log("🛑 Golem 系統已完全終止。");
            process.exit(0);
        });

        // F12 = detach
        this.screen.key(['f12'], () => {
            this.detach();
        });
    }

    _startStdinListener() {
        // 在 detach 狀態下，用 raw stdin 監聽 F12（ESC [ 24 ~）
        if (this._stdinListener) return; // 避免重複綁定

        const stdin = process.stdin;

        // 確保 stdin 是 TTY 才能切 raw mode
        if (!stdin.isTTY) {
            this.originalLog('⚠️  非 TTY 環境，無法監聽 F12 reattach');
            return;
        }

        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        this._stdinListener = (key) => {
            // F12 的 ANSI escape sequence: ESC [ 24 ~
            if (key === '\u001b[24~') {
                this.reattach();
            }
            // Ctrl+C = 停止
            if (key === '\u0003') {
                console.log = this.originalLog;
                console.error = this.originalError;
                console.warn = this.originalWarn;
                console.log("\n🛑 Golem 系統已完全終止。");
                process.exit(0);
            }
        };

        stdin.on('data', this._stdinListener);
    }

    _stopStdinListener() {
        if (!this._stdinListener) return;

        const stdin = process.stdin;
        stdin.removeListener('data', this._stdinListener);
        this._stdinListener = null;

        // 把 stdin 還原回 normal mode
        // 注意：blessed 重建 screen 時會自己接管 stdin
        try {
            if (stdin.isTTY) {
                stdin.setRawMode(false);
            }
        } catch (e) {
            // blessed 可能已經拿走了 stdin 控制權，忽略
        }
    }

    // =========================================================
    // Detach / Reattach
    // =========================================================
    detach() {
        this.isDetached = true;
        this._destroyUI();

        // 恢復原始 console（detach 期間直接輸出到 stdout）
        console.log = (...args) => {
            this.originalLog(...args);
            // 持續寫 log 檔
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            this._writeLog('LOG', msg);
        };
        console.error = (...args) => {
            this.originalError(...args);
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            this._writeLog('ERR', msg);
        };

        this.originalLog("\n============================================");
        this.originalLog("📺 Dashboard Detached");
        this.originalLog("🤖 Golem 仍在背景執行中...");
        this.originalLog("📝 Log: " + this.logFilePath);
        this.originalLog("🔄 按 F12 重新叫出面板");
        this.originalLog("============================================\n");

        // 開始監聽 stdin 的 F12
        this._startStdinListener();
    }

    reattach() {
        this.originalLog("\n🔄 Reattaching Dashboard...\n");

        // 停止 stdin 監聽（blessed 會接管）
        this._stopStdinListener();

        // 重建 UI
        this._buildUI();

        // 重新設定 console 攔截
        this.setupOverride();

        // 重啟監控
        this.startMonitoring();

        // 在日誌面板顯示 reattach 訊息
        if (this.logBox) {
            this.logBox.log('{cyan-fg}🔄 Dashboard Reattached{/cyan-fg}');
        }
    }

    // =========================================================
    // Console 攔截 (v8.5 增強版)
    // =========================================================
    setupOverride() {
        console.log = (...args) => {
            if (this.isDetached) {
                this.originalLog(...args);
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

            // 寫入日誌面板（加 HH:MM 時間戳）
            if (this.logBox) this.logBox.log('{blue-fg}' + this._ts() + '{/}' + ' ' + logMsg);

            // 📝 同步寫入 log 檔
            this._writeLog('LOG', msg);

            // 分流邏輯：Autonomy / Chronos → radarLog
            if (msg.includes('[Autonomy]') || msg.includes('[Decision]') || msg.includes('[GitHub]') || msg.includes('[LifeCycle]')) {
                if (this.radarLog) this.radarLog.log('{blue-fg}' + this._ts() + '{/}' + ' ' + `{cyan-fg}${msg}{/cyan-fg}`);
            }
            else if (msg.includes('[Chronos]') || msg.includes('排程')) {
                if (this.radarLog) this.radarLog.log('{blue-fg}' + this._ts() + '{/}' + ' ' + `{yellow-fg}${msg}{/yellow-fg}`);
            }
            // 分流邏輯：TitanQ / Queue → chatBox
            else if (msg.includes('[TitanQ]') || msg.includes('[Queue]')) {
                if (this.chatBox) this.chatBox.log(`{magenta-fg}${msg}{/magenta-fg}`);
                if (msg.includes('合併')) this.queueCount = Math.max(0, (this.queueCount || 0) - 1);
            }
            // 分流邏輯：三流協定 → chatBox
            if (msg.includes('[💬 REPLY]') || msg.includes('[GOLEM_REPLY]') || msg.includes('—-回覆開始—-')) {
                const text = msg.replace('[💬 REPLY]', '').replace('[GOLEM_REPLY]', '').replace('—-回覆開始—-', '').substring(0, 60);
                if (this.chatBox) this.chatBox.log(`\x1b[36m[回覆]\x1b[0m ${text}...`);
            }
            else if (msg.includes('[🤖 ACTION_PLAN]') || msg.includes('[GOLEM_ACTION]')) {
                if (this.chatBox) this.chatBox.log(`\x1b[33m[行動]\x1b[0m 偵測到指令`);
            }
            else if (msg.includes('[🧠 MEMORY_IMPRINT]') || msg.includes('[GOLEM_MEMORY]')) {
                if (this.chatBox) this.chatBox.log(`\x1b[35m[記憶]\x1b[0m 寫入記憶`);
            }
        };

        console.error = (...args) => {
            if (this.isDetached) {
                this.originalError(...args);
                const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
                this._writeLog('ERR', msg);
                return;
            }
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            if (this.logBox) this.logBox.log('{blue-fg}' + this._ts() + '{/}' + ' ' + `{red-fg}[錯誤] ${msg}{/red-fg}`);

            // 📝 同步寫入 log 檔
            this._writeLog('ERR', msg);
        };

        console.warn = (...args) => {
            if (this.isDetached) {
                this.originalWarn(...args);
                const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
                this._writeLog('WARN', msg);
                return;
            }
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            if (this.logBox) this.logBox.log('{blue-fg}' + this._ts() + '{/}' + ' ' + `{yellow-fg}⚠️ ${msg}{/yellow-fg}`);

            // 分流：429 / KeyChain 相關 → radarLog
            if (msg.includes('[Brain]') || msg.includes('[KeyChain]') || msg.includes('429')) {
                if (this.radarLog) this.radarLog.log(`{yellow-fg}${msg}{/yellow-fg}`);
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
            if (fs.existsSync(this.logFilePath)) {
                const stat = fs.statSync(this.logFilePath);
                if (stat.size > MAX_LOG_SIZE) {
                    fs.renameSync(this.logFilePath, this.logFilePath + '.old');
                }
            }
            this._logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
            this._logStream.write(`\n=== Golem Dashboard Log Started: ${new Date().toISOString()} ===\n\n`);
        } catch (e) {
            this.originalError('⚠️ 無法建立 log 檔:', e.message);
            this._logStream = null;
        }
    }

    _writeLog(level, msg) {
        if (!this._logStream) return;
        try {
            const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
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


    // 倒數計時格式化（讀取 autonomy.nextWakeTime）
    _formatCountdown() {
        if (!this._autonomy || !this._autonomy.nextWakeTime) {
            if (this._autonomy && this._autonomy.nextWakeTime === null) {
                return '⏳ 行動中...';
            }
            return '--';
        }
        const remain = this._autonomy.nextWakeTime.getTime() - Date.now();
        if (remain <= 0) return '⏳ 行動中...';
        const m = Math.floor(remain / 60000);
        const s = Math.floor((remain % 60000) / 1000);
        if (m >= 60) {
            const h = Math.floor(m / 60);
            return h + 'h ' + (m % 60) + 'm';
        }
        return m + 'm ' + String(s).padStart(2, '0') + 's';
    }

    // =========================================================
    // 系統監控
    // =========================================================
    startMonitoring() {
        if (this.timer) clearInterval(this.timer);

        this.timer = setInterval(() => {
            if (this.isDetached) return;
            if (!this.screen) return;

            const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
            this.memData.y.shift();
            this.memData.y.push(memUsage);
            if (this.cpuLine) this.cpuLine.setData([this.memData]);

            const mode = process.env.GOLEM_MEMORY_MODE || 'Browser';
            const uptime = Math.floor(process.uptime());
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);

            // 日期時間顯示
            const now = new Date();
            const dateStr = now.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
            const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false });

            // statusBox：系統狀態（乾淨版）
            if (this.statusBox) {
                this.statusBox.setMarkdown(`# ${dateStr} ${timeStr}
- **模式**: ${mode}
- **RAM**: ${memUsage.toFixed(0)} MB
- **Uptime**: ${hours}h ${minutes}m
- **⏰ 醒來**: ${this._formatCountdown()}
`);
            }

            // providerBox：API Provider 即時狀態（獨立面板）
            if (this.providerBox && this._modelRouter) {
                try {
                    const mr = this._modelRouter;
                    const abbreviateModel = (m) => {
                        if (m === 'gemini-2.5-flash')           return 'flash';
                        if (m === 'gemini-3-flash-preview')     return '3flash';
                        if (m === 'gemini-2.5-flash-lite')      return 'lite';
                        if (m === 'llama-3.3-70b-versatile')    return 'llama';
                        if (m.includes('kimi-k2-instruct'))     return 'kimi';
                        if (m === 'qwen/qwen3-32b')             return 'qwen32b';
                        if (m.includes('llama-3.3-70b'))        return 'llama';
                        if (m.includes('kimi-k2.5'))            return 'kimi';
                        if (m.includes('minimax-m2.1'))         return 'm2.1';
                        if (m.includes('qwen3-coder'))          return 'qwen3';
                        return m.split('/').pop().split(':')[0].slice(-8);
                    };
                    const pLines = [];
                    for (const [name, h] of mr.health.providers) {
                        if (!h.hasKey) continue;
                        const adapter = mr.adapters.get(name);
                        // Key-level 狀態
                        let keyStatus = '';
                        if (adapter && adapter.keys) {
                            const parts = [];
                            for (let i = 0; i < adapter.keys.length; i++) {
                                const k = adapter.keys[i];
                                const coolUntil = adapter._cooldownUntil.get(k);
                                if (coolUntil && coolUntil > Date.now()) {
                                    const remain = coolUntil - Date.now();
                                    if (h.reliability === 0) {
                                        parts.push(`{red-fg}#${i}✗{/}`);
                                    } else if (remain > 3600000) {
                                        parts.push(`{cyan-fg}#${i}{/}~${(remain/3600000).toFixed(1)}h`);
                                    } else {
                                        parts.push(`{cyan-fg}#${i}{/}~${Math.ceil(remain/60000)}m`);
                                    }
                                } else {
                                    parts.push(`{green-fg}#${i}●{/}`);
                                }
                            }
                            keyStatus = parts.join(' ');
                        }
                        // 多 model provider 展開 per-model RPD，單 model 用 aggregate
                        const isMultiModel = Object.keys(h.rpdLimits || {}).length > 1;
                        let rpdStr;
                        if (isMultiModel) {
                            const modelParts = Object.keys(h.rpdLimits).map(model => {
                                const used     = h.modelUsed?.[model] ?? 0;
                                const limit    = h.rpdLimits[model];
                                const limitStr = limit === Infinity ? '∞' : String(limit);
                                const abbr     = abbreviateModel(model);
                                const pct      = limit === Infinity ? 0 : used / limit;
                                const color    = pct >= 0.8 ? '{yellow-fg}' : '';
                                const colorEnd = pct >= 0.8 ? '{/}' : '';
                                return `${color}${abbr} ${used}/${limitStr}${colorEnd}`;
                            });
                            rpdStr = modelParts.join('  ');
                        } else {
                            rpdStr = h.rpd.limit === Infinity ? '~' : `${h.rpd.used}/${h.rpd.limit}`;
                        }
                        // provider-level 燈號
                        let pIcon = '{green-fg}●{/}';
                        if (h.reliability === 0) pIcon = '{red-fg}✗{/}';
                        else if (h.coolUntil > Date.now()) pIcon = '{cyan-fg}●{/}';
                        else if (h.reliability < 0.8) pIcon = '{yellow-fg}●{/}';
                        // DeepSeek 顯示餘額
                        let extraInfo = '';
                        if (name === 'deepseek') {
                            const bal = mr.health.getDeepSeekBalance();
                            if (bal) extraInfo = ' │ \x24' + bal.total.toFixed(2);
                        }
                        const rpdLabel = isMultiModel ? '' : 'RPD ';
                        pLines.push(`${pIcon} ${name}: ${keyStatus} │ ${rpdLabel}${rpdStr}${extraInfo}`);
                    }
                    const snap = pLines.join('\n');
                    if (snap !== this._lastProviderSnap) {
                        this._lastProviderSnap = snap;
                        this.providerBox.setContent(snap);
                    }
                } catch(e) {}
            }
            this.screen.render();
        }, 1000);
    }
}

module.exports = new DashboardPlugin();
