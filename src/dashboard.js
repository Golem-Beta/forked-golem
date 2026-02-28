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
const DashboardLog = require('./dashboard-log');
const DashboardMonitor = require('./dashboard-monitor');

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
        this._log = new DashboardLog(this);
        this._monitor = new DashboardMonitor(this);
        this._log._initLogStream();

        // 數據容器（跨 attach/detach 保留）
        this.memData = { title: 'RAM (MB)', x: Array(10).fill(' '), y: Array(10).fill(0), style: { line: 'red' } };

        // 首次建立 UI
        this._buildUI();
        this._log.setupOverride();
        this._monitor.startMonitoring();
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
            this._log._writeLog('LOG', msg);
        };
        console.error = (...args) => {
            this.originalError(...args);
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            this._log._writeLog('ERR', msg);
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
        this._log.setupOverride();

        // 重啟監控
        this._monitor.startMonitoring();

        // 在日誌面板顯示 reattach 訊息
        if (this.logBox) {
            this.logBox.log('{cyan-fg}🔄 Dashboard Reattached{/cyan-fg}');
        }
    }


}

if (process.env.GOLEM_TEST_MODE === 'true') {
    module.exports = DashboardPlugin;
} else {
    module.exports = new DashboardPlugin();
}
