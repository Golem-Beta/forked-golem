/**
 * 📟 DashboardMonitor — blessed 終端機系統監控面板（CPU/RAM/進程）
 * 依賴：os, child_process（Node built-in）
 */
'use strict';

class DashboardMonitor {
    constructor(dashboard) {
        this._d = dashboard;
        this.timer = null;
    }

    // 倒數計時格式化（讀取 autonomy.nextWakeTime）
    _formatCountdown() {
        if (!this._d._autonomy || !this._d._autonomy.nextWakeTime) {
            if (this._d._autonomy && this._d._autonomy.nextWakeTime === null) {
                return '⏳ 行動中...';
            }
            return '--';
        }
        const remain = this._d._autonomy.nextWakeTime.getTime() - Date.now();
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
            if (this._d.isDetached) return;
            if (!this._d.screen) return;

            const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
            this._d.memData.y.shift();
            this._d.memData.y.push(memUsage);
            if (this._d.cpuLine) this._d.cpuLine.setData([this._d.memData]);

            const mode = process.env.GOLEM_MEMORY_MODE || 'Browser';
            const uptime = Math.floor(process.uptime());
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);

            // 日期時間顯示
            const now = new Date();
            const dateStr = now.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
            const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false });

            // statusBox：系統狀態（乾淨版）
            if (this._d.statusBox) {
                this._d.statusBox.setMarkdown(`# ${dateStr} ${timeStr}
- **模式**: ${mode}
- **RAM**: ${memUsage.toFixed(0)} MB
- **Uptime**: ${hours}h ${minutes}m
- **⏰ 醒來**: ${this._formatCountdown()}
`);
            }

            // providerBox：API Provider 即時狀態（獨立面板）
            if (this._d.providerBox && this._d._modelRouter) {
                try {
                    const mr = this._d._modelRouter;
                    const abbreviateModel = (m) => {
                        if (m === 'gemini-2.5-flash')           return 'flash';
                        if (m === 'gemini-3-flash-preview')     return '3flash';
                        if (m === 'gemini-2.5-flash-lite')      return 'lite';
                        if (m === 'llama-3.3-70b-versatile')    return 'llama';
                        if (m.includes('kimi-k2-instruct'))     return 'kimi';
                        if (m === 'qwen/qwen3-32b')             return 'qwen32b';
                        if (m.includes('llama-3.3-70b'))        return 'llama';
                        if (m === 'deepseek-chat')              return 'chat';
                        if (m === 'deepseek-reasoner')          return 'reasoner';
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
                    if (snap !== this._d._lastProviderSnap) {
                        this._d._lastProviderSnap = snap;
                        this._d.providerBox.setContent(snap);
                    }
                } catch(e) {}
            }
            this._d.screen.render();
        }, 1000);
    }
}

module.exports = DashboardMonitor;
