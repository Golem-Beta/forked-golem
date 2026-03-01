/**
 * @module dashboard-renderer
 * @role Dashboard 視覺元件工廠（blessed widget 建立、按鍵綁定、stdin 監聽）
 * @when-to-modify 調整 widget 佈局、按鍵設定、stdin 輸入處理行為時
 *
 * 與 dashboard.js 的職責分界：
 *   dashboard.js          — lifecycle（attach/detach/reattach）、狀態追蹤、外部注入
 *   dashboard-renderer.js — UI 元件建立、按鍵綁定、raw stdin 輸入處理（純函式）
 */
'use strict';
const blessed = require('blessed');
const contrib = require('blessed-contrib');

/**
 * 建立並回傳所有 blessed widget
 * @param {string} version - Golem 版本號（顯示於標題列與 footer）
 * @returns {{ screen, grid, cpuLine, logBox, statusBox, providerBox, radarLog, chatBox, footer }}
 */
function createWidgets(version) {
    const screen = blessed.screen({
        smartCSR: true,
        title: `🦞 Golem v${version} 戰術控制台`,
        fullUnicode: true
    });
    const grid = new contrib.grid({ rows: 12, cols: 12, screen });

    // [左上] 系統負載 (RAM)
    const cpuLine = grid.set(0, 0, 4, 6, contrib.line, {
        style: { line: "yellow", text: "green", baseline: "black" },
        label: '⚡ 系統負載 (RAM)',
        showLegend: true
    });
    // [右上] 狀態面板（含日期時間）
    const statusBox = grid.set(0, 6, 3, 6, contrib.markdown, {
        label: '🧠 引擎狀態',
        style: { border: { fg: 'cyan' } }
    });
    // [右中上] API Provider 狀態
    const providerBox = grid.set(3, 6, 3, 6, blessed.box, {
        label: '🚀 API Providers',
        tags: true,
        style: { fg: 'cyan' }
    });
    // [右中] Autonomy / Chronos 雷達
    const radarLog = grid.set(6, 6, 2, 6, contrib.log, {
        fg: "yellow",
        selectedFg: "yellow",
        label: '⏰ Autonomy / Chronos',
        tags: true
    });
    // [左下] 核心日誌
    const logBox = grid.set(4, 0, 8, 6, contrib.log, {
        fg: "green",
        selectedFg: "lightgreen",
        label: '📠 核心日誌 (Neuro-Link)',
        tags: true
    });
    // [右下] 三流協定 + Queue
    const chatBox = grid.set(8, 6, 4, 6, contrib.log, {
        fg: "white",
        selectedFg: "cyan",
        label: '💬 三流協定 / Queue',
        tags: true
    });
    // 底部說明列
    const footer = blessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 1,
        content: ` {bold}F12{/bold}: Detach | {bold}Ctrl+C{/bold}: 停止 | {bold}v${version}{/bold} `,
        style: { fg: 'black', bg: 'cyan' },
        tags: true
    });

    return { screen, grid, cpuLine, logBox, statusBox, providerBox, radarLog, chatBox, footer };
}

/**
 * 在 blessed screen 上設定 Ctrl+C / q / F12 按鍵監聽
 * @param {object} screen - blessed screen instance
 * @param {{ onExit: Function, onDetach: Function }} callbacks
 */
function setupScreenKeys(screen, { onExit, onDetach }) {
    screen.key(['C-c', 'q'], onExit);
    screen.key(['f12'], onDetach);
}

/**
 * 在 detach 狀態啟動 raw stdin 監聽（等待 F12 reattach）
 * @param {{ onReattach: Function, onExit: Function }} callbacks
 * @returns {Function|null} 已綁定的 handler（供 stopStdinListener 移除），非 TTY 時回傳 null
 */
function startStdinListener({ onReattach, onExit }) {
    const stdin = process.stdin;
    if (!stdin.isTTY) return null;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const handler = (key) => {
        if (key === '\u001b[24~') onReattach();  // F12 = ESC [ 24 ~
        if (key === '\u0003') onExit();           // Ctrl+C
    };
    stdin.on('data', handler);
    return handler;
}

/**
 * 移除 startStdinListener 回傳的 handler，並嘗試還原 stdin 模式
 * @param {Function|null} handler - startStdinListener 的回傳值
 */
function stopStdinListener(handler) {
    if (!handler) return;
    process.stdin.removeListener('data', handler);
    try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch (_) {
        // blessed 重建 screen 時可能已接管 stdin，忽略
    }
}

module.exports = { createWidgets, setupScreenKeys, startStdinListener, stopStdinListener };
