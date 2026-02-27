/**
 * @module decision-utils
 * @role DecisionEngine 輔助工具 — 設定讀取、靈魂文件、時間脈絡、檔案工具
 * @when-to-modify 調整設定預設值、時段分類、或檔案掃描邏輯時
 */
const fs = require('fs');
const path = require('path');

class DecisionUtils {
    // === 設定 ===

    loadAutonomyConfig() {
        try {
            const configPath = path.join(process.cwd(), 'config', 'autonomy.json');
            if (fs.existsSync(configPath)) {
                return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
        } catch (e) {
            console.warn('⚙️ [Config] autonomy.json 讀取失敗:', e.message);
        }
        return {
            awakening: { minHours: 3, maxHours: 7, sleepHours: [1,2,3,4,5,6,7], morningWakeHour: 8 },
            actions: {
                self_reflection: { dailyLimit: 1, desc: "閱讀自己的程式碼，提出改進方案" },
                github_explore: { dailyLimit: null, desc: "去 GitHub 探索 AI/Agent 相關專案" },
                spontaneous_chat: { dailyLimit: null, blockedHours: [23,0,1,2,3,4,5,6], desc: "主動社交" },
                web_research: { dailyLimit: 2, desc: "根據目標或經驗中的線索，主動上網搜尋研究特定主題" },
                rest: { desc: "繼續休息" }
            },
            cooldown: { minActionGapMinutes: 120 },
            journal: { decisionReadCount: 10 }
        };
    }

    // === Context 工具 ===

    readSoul() {
        try {
            const soulPath = path.join(process.cwd(), 'soul.md');
            if (fs.existsSync(soulPath)) {
                return fs.readFileSync(soulPath, 'utf-8');
            }
        } catch (e) {
            console.warn('📜 [Soul] 讀取失敗:', e.message);
        }
        return '(靈魂文件不存在)';
    }

    getTimeContext(now = new Date()) {
        const weekdays = ['週日','週一','週二','週三','週四','週五','週六'];
        const hour = now.getHours();
        const day = now.getDay();
        let period = '平常時段';
        if (hour >= 0 && hour < 7) period = '深夜/凌晨，不適合打擾';
        else if (hour >= 7 && hour < 9) period = '早晨';
        else if (hour >= 9 && hour <= 18 && day > 0 && day < 6) period = '工作時間，語氣簡潔暖心';
        else if (day === 0 || day === 6) period = '週末假日，語氣輕鬆';
        else if (hour > 22) period = '深夜時段，提醒休息';
        else if (hour > 18) period = '傍晚';
        return {
            display: now.toLocaleString('zh-TW', {
                weekday: 'long', year: 'numeric', month: 'long',
                day: 'numeric', hour: '2-digit', minute: '2-digit',
                hour12: false
            }),
            weekday: weekdays[day],
            hour, day,
            isWeekend: day === 0 || day === 6,
            period,
            iso: now.toISOString()
        };
    }

    _parseJSDocHeader(content) {
        const lines = content.split('\n').slice(0, 20).join('\n');
        const role = (lines.match(/@role\s+(.+)/) || [])[1]?.trim() || null;
        const whenToModify = (lines.match(/@when-to-modify\s+(.+)/) || [])[1]?.trim() || null;
        return { role, whenToModify };
    }

    getProjectFileList() {
        try {
            const cwd = process.cwd();
            const files = [];
            const scan = (dir, prefix) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
                    const rel = prefix ? prefix + '/' + e.name : e.name;
                    if (e.isDirectory()) {
                        if (['memory', 'logs', '.git'].includes(e.name)) continue;
                        scan(path.join(dir, e.name), rel);
                    } else if (e.name.endsWith('.js') || e.name.endsWith('.md') || e.name.endsWith('.json')) {
                        try {
                            const content = fs.readFileSync(path.join(dir, e.name), 'utf-8');
                            const lines = content.split('\n').length;
                            const entry = [rel + ' (' + lines + ' lines)'];
                            if (e.name.endsWith('.js')) {
                                const { role, whenToModify } = this._parseJSDocHeader(content);
                                if (role) entry.push('  @role: ' + role);
                                if (whenToModify) entry.push('  @when-to-modify: ' + whenToModify);
                            }
                            files.push(entry.join('\n'));
                        } catch { files.push(rel + ' (unreadable)'); }
                    }
                }
            };
            scan(cwd, '');
            return files.join('\n');
        } catch (e) {
            return '(檔案清單讀取失敗: ' + e.message + ')';
        }
    }

    /**
     * 讀取目標檔案的程式碼。
     * 模組化後每個檔案 40-600 行，可直接整檔讀入作為 LLM context。
     * 超過 15000 字元才截斷（安全閥，正常不會觸發）。
     */
    extractCodeSection(filename) {
        try {
            // 支援 src/ 前綴和不帶前綴兩種寫法
            let filePath = path.join(process.cwd(), filename);
            if (!fs.existsSync(filePath) && !filename.startsWith('src/')) {
                filePath = path.join(process.cwd(), 'src', filename);
            }
            if (!fs.existsSync(filePath)) return null;
            const code = fs.readFileSync(filePath, 'utf-8');
            if (code.length > 15000) {
                return code.substring(0, 15000) + '\n// ... (truncated at 15000 chars)';
            }
            return code;
        } catch (e) {
            console.warn('[extractCodeSection]', e.message);
            return null;
        }
    }

    saveReflection(action, content) {
        try {
            const dir = path.join(process.cwd(), 'memory', 'reflections');
            fs.mkdirSync(dir, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${action}-${ts}.txt`;
            const filepath = path.join(dir, filename);
            fs.writeFileSync(filepath, content);
            return `reflections/${filename}`;
        } catch (e) {
            console.warn('💾 [Reflection] 保存失敗:', e.message);
            return null;
        }
    }

    // === 行動過濾 ===

    getAvailableActions({ journal, notifier }) {
        const cfg = this.loadAutonomyConfig();
        const now = new Date();
        const hour = now.getHours();
        const today = now.toISOString().slice(0, 10);
        const entries = journal.readRecent(cfg.journal.decisionReadCount);

        const lastAction = entries.filter(j => j.action !== 'error').slice(-1)[0];
        const minutesSinceLast = lastAction && lastAction.ts
            ? (now.getTime() - new Date(lastAction.ts).getTime()) / 60000
            : Infinity;

        const available = [];

        for (const [id, actionCfg] of Object.entries(cfg.actions)) {
            if (id === 'rest') continue;

            let blocked = false;
            let note = '';

            if (actionCfg.dailyLimit) {
                const todayCount = entries.filter(
                    j => j.action === id && j.ts && j.ts.startsWith(today)
                ).length;
                if (todayCount >= actionCfg.dailyLimit) {
                    blocked = true;
                    note = '今天已達上限 (' + todayCount + '/' + actionCfg.dailyLimit + ')';
                }
            }

            if (!blocked && actionCfg.blockedHours && actionCfg.blockedHours.includes(hour)) {
                blocked = true;
                note = '目前時段不適合';
            }

            if (!blocked) {
                const lastOfType = entries.filter(j => j.action === id).slice(-1)[0];
                if (lastOfType) {
                    const ago = lastOfType.ts
                        ? Math.round((now.getTime() - new Date(lastOfType.ts).getTime()) / 60000)
                        : null;
                    note = '上次 ' + (ago !== null ? ago + ' 分鐘前' : '時間不明');
                    if (lastOfType.outcome) note += '，結果: ' + lastOfType.outcome;
                } else {
                    note = '從未執行過';
                }
                available.push({ id, desc: actionCfg.desc, note });
            }
        }

        const restNote = minutesSinceLast < cfg.cooldown.minActionGapMinutes
            ? '距離上次行動僅 ' + Math.round(minutesSinceLast) + ' 分鐘'
            : '';

        // morning_digest：有靜默 queue 且今天尚未執行才加入可選
        if (cfg.actions.morning_digest) {
            const queueLen = notifier ? notifier._quietQueue.length : 0;
            const digestToday = entries.filter(j => j.action === 'morning_digest' && j.ts && j.ts.startsWith(today)).length;
            const digestLimit = cfg.actions.morning_digest.dailyLimit || 1;
            const digestBlocked = cfg.actions.morning_digest.blockedHours && cfg.actions.morning_digest.blockedHours.includes(hour);
            if (!digestBlocked && queueLen > 0 && digestToday < digestLimit) {
                available.unshift({
                    id: 'morning_digest',
                    desc: cfg.actions.morning_digest.desc,
                    note: '有 ' + queueLen + ' 則未匯報的靜默時段訊息'
                });
            }
        }

        available.push({ id: 'rest', desc: cfg.actions.rest.desc, note: restNote });
        return available;
    }
}

module.exports = DecisionUtils;
