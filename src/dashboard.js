/**
 * 檔案名稱: dashboard.js
 * 版本: v8.5.3 (Reattach Edition)
 * ---------------------------------------
 * 更新重點：
 * 1. 支援 Neuro-Link 雙軌訊號的色彩高亮 (CDP vs DOM)。
 * 2. 狀態面板新增 Neuro-Link 狀態指示。
 * 3. 📝 [v8.5.1] 所有 log 同時寫入 logs/golem.log，可透過 SSH tail -f 監看。
 * 4. 🔧 [v8.5.2] 修正 _writeLog 只去除 blessed 色彩標籤，不破壞 JSON 大括號。
 * 5. 🔄 [v8.5.3] F12 切換 detach/reattach，不再需要重啟 Golem。
 *    - detach 後在 console 按 F12 可重新叫出面板
 *    - 使用 stdin raw mode 監聽按鍵，不依賴 blessed
 */
const GOLEM_VERSION = require('../package.json').version;
const os = require('os');
const fs = require('fs');
const path = require('path');
const DashboardLog = require('./dashboard-log');
const DashboardMonitor = require('./dashboard-monitor');
const { createWidgets, setupScreenKeys, startStdinListener, stopStdinListener } = require('./dashboard-renderer');

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
        this.logFilePath = path.join(process.cwd(), 'logs', 'golem.log');
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
        Object.assign(this, createWidgets(GOLEM_VERSION));
        setupScreenKeys(this.screen, {
            onExit: () => {
                this._destroyUI();
                console.log = this.originalLog;
                console.error = this.originalError;
                console.warn = this.originalWarn;
                console.log("🛑 Golem 系統已完全終止。");
                process.exit(0);
            },
            onDetach: () => this.detach(),
        });
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
    // stdin 監聽（detach 狀態用）
    // =========================================================
    _startStdinListener() {
        if (this._stdinListener) return;  // 避免重複綁定
        const handler = startStdinListener({
            onReattach: () => this.reattach(),
            onExit: () => {
                console.log = this.originalLog;
                console.error = this.originalError;
                console.warn = this.originalWarn;
                console.log("\n🛑 Golem 系統已完全終止。");
                process.exit(0);
            },
        });
        if (!handler) {
            this.originalLog('⚠️  非 TTY 環境，無法監聽 F12 reattach');
            return;
        }
        this._stdinListener = handler;
    }

    _stopStdinListener() {
        stopStdinListener(this._stdinListener);
        this._stdinListener = null;
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
