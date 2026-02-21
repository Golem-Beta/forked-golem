/**
 * 🧬 AutonomyManager — Golem 自主決策與行動模組
 * 從 index.js 提取為獨立模組 (Phase B refactor)
 * 
 * 所有外部依賴透過 constructor 注入，不直接 require index.js 的任何全域符號。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Index: FlexIndex } = require('flexsearch');

class AutonomyManager {
    /**
     * @param {object} deps - 依賴注入
     * @param {object} deps.brain - GolemBrain instance
     * @param {object} deps.chronos - ChronosManager instance
     * @param {object} deps.tgBot - grammy Bot instance (nullable)
     * @param {object} deps.dcClient - Discord.js Client instance (nullable)
     * @param {object} deps.memory - ExperienceMemory instance
     * @param {object} deps.skills - skills module
     * @param {object} deps.CONFIG - global config
     * @param {Function} deps.loadPrompt - prompt loader
     * @param {Function} deps.loadFeedbackPrompt - feedback prompt loader
     * @param {object} deps.Introspection - Introspection class
     * @param {object} deps.PatchManager - PatchManager class
     * @param {object} deps.TriStreamParser - TriStreamParser class
     * @param {object} deps.ResponseParser - ResponseParser class
     * @param {Function} deps.InputFile - grammy InputFile constructor
     */
    constructor(deps) {
        this.brain = deps.brain;
        this.chronos = deps.chronos;
        this.tgBot = deps.tgBot;
        this.dcClient = deps.dcClient;
        this.memory = deps.memory;
        this.skills = deps.skills;
        this.CONFIG = deps.CONFIG;
        this.loadPrompt = deps.loadPrompt;
        this.loadFeedbackPrompt = deps.loadFeedbackPrompt;
        this.Introspection = deps.Introspection;
        this.PatchManager = deps.PatchManager;
        this.TriStreamParser = deps.TriStreamParser;

        // 🔍 Journal 全文索引 (FlexSearch)
        this._journalIndex = null;
        this._journalEntries = [];  // id → entry 映射
        this._buildJournalIndex();

        // 📬 社交回應追蹤
        this._pendingSocialChat = null; // { ts, timer, context }
        this.ResponseParser = deps.ResponseParser;
        this.InputFile = deps.InputFile;
        this._timer = null;
        this.journalPath = path.join(process.cwd(), 'memory', 'journal.jsonl');
    }

    start() {
        if (!this.CONFIG.TG_TOKEN && !this.CONFIG.DC_TOKEN) return;
        // 確保 memory/ 目錄存在
        const memDir = path.join(process.cwd(), 'memory');
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        this.chronos.rebuild();
        this.scheduleNextAwakening();
    }

    // =========================================================
    // ⏰ 排程：讀取 autonomy.json 設定
    // =========================================================
    scheduleNextAwakening() {
        // 清除前一個 timer，防止多重鏈疊加
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        try {
        const cfg = this._loadAutonomyConfig().awakening || {};
        const range = cfg.maxHours - cfg.minHours;
        const waitMs = (cfg.minHours + Math.random() * range) * 3600000;
        const nextWakeTime = new Date(Date.now() + waitMs);
        const hour = nextWakeTime.getHours();
        const quietHours = cfg.quietHours || cfg.sleepHours || [];
        const isQuiet = quietHours.includes(hour);
        if (isQuiet) {
            console.log("\u{1F319} [LifeCycle] 下次醒來在靜音時段 (" + hour + ":00)，不發社交訊息");
        }
        console.log("\u267B\uFE0F [LifeCycle] 下次醒來: " + (waitMs / 60000).toFixed(1) + " 分鐘後" + (isQuiet ? " (靜音模式)" : ""));
        this._timer = setTimeout(() => {
            this.quietMode = isQuiet;
            this.manifestFreeWill();
            this.scheduleNextAwakening();
        }, waitMs);
        } catch (e) {
            console.error('🛡️ [LifeCycle] scheduleNextAwakening 異常:', e.message);
            // fallback: 2 小時後重試
            this._timer = setTimeout(() => { this.scheduleNextAwakening(); }, 2 * 3600000);
        }
    }
    // 📓 經驗日誌：讀取 / 寫入
    // =========================================================
    // 🔍 Journal 全文索引
    _buildJournalIndex() {
        try {
            this._journalIndex = new FlexIndex({ tokenize: 'forward', resolution: 5 });
            this._journalEntries = [];
            if (!fs.existsSync(this.journalPath)) return;
            const lines = fs.readFileSync(this.journalPath, 'utf-8').trim().split('\n');
            lines.forEach((line, i) => {
                try {
                    const entry = JSON.parse(line);
                    this._journalEntries.push(entry);
                    const searchText = [
                        entry.action, entry.outcome, entry.topic, entry.context,
                        entry.preview, entry.note, entry.repo, entry.reply_preview,
                        entry.error, entry.learning
                    ].filter(Boolean).join(' ');
                    this._journalIndex.add(i, searchText);
                } catch {}
            });
            console.log('🔍 [JournalIndex] 索引完成: ' + this._journalEntries.length + ' 條');
        } catch (e) {
            console.warn('🔍 [JournalIndex] 建立失敗:', e.message);
            this._journalIndex = null;
            this._journalEntries = [];
        }
    }

    searchJournal(query, limit = 5) {
        if (!this._journalIndex || !query) return [];
        try {
            const ids = this._journalIndex.search(query, { limit });
            return ids.map(id => this._journalEntries[id]).filter(Boolean);
        } catch (e) {
            console.warn('🔍 [JournalIndex] 搜尋失敗:', e.message);
            return [];
        }
    }

        readRecentJournal(n = 10) {
        try {
            if (!fs.existsSync(this.journalPath)) return [];
            const lines = fs.readFileSync(this.journalPath, 'utf-8').trim().split('\n');
            return lines.slice(-n).map(l => {
                try { return JSON.parse(l); } catch { return null; }
            }).filter(Boolean);
        } catch (e) {
            console.warn("[Journal] 讀取失敗:", e.message);
            return [];
        }
    }

    appendJournal(entry) {
        try {
            const memDir = path.dirname(this.journalPath);
            if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
            const record = { ts: new Date().toISOString(), ...entry };
            fs.appendFileSync(this.journalPath, JSON.stringify(record) + '\n');
            console.log(`📓 [Journal] 記錄: ${entry.action} → ${entry.outcome || 'done'}`);
            // 即時更新索引
            if (this._journalIndex) {
                const searchText = [record.action, record.outcome, record.topic, record.context, record.preview, record.note, record.repo, record.reply_preview, record.error, record.learning].filter(Boolean).join(' ');
                this._journalIndex.add(this._journalEntries.length, searchText);
                this._journalEntries.push(record);
            }
        } catch (e) {
            console.warn("[Journal] 寫入失敗:", e.message);
        }
    }

    // 📊 全量 Journal 統計摘要（治標：給決策引擎全局視野）
    buildJournalStats() {
        try {
            if (!fs.existsSync(this.journalPath)) return '(無 journal 資料)';
            const lines = fs.readFileSync(this.journalPath, 'utf-8').trim().split('\n');
            const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
            if (all.length === 0) return '(無 journal 資料)';

            // 行動類型統計
            const actionCounts = {};
            const outcomeMap = {};
            let droppedProposals = [];
            let deployedProposals = [];
            let repoCount = 0;
            let firstTs = all[0].ts, lastTs = all[all.length - 1].ts;

            for (const j of all) {
                actionCounts[j.action] = (actionCounts[j.action] || 0) + 1;
                const key = j.action + ':' + (j.outcome || '?');
                outcomeMap[key] = (outcomeMap[key] || 0) + 1;
                if (j.action === 'github_explore' && j.repo) repoCount++;
                if (j.action === 'self_reflection_feedback' && j.outcome === 'dropped') {
                    droppedProposals.push(j.description || '未知');
                }
                if (j.action === 'self_reflection_feedback' && j.outcome === 'deployed') {
                    deployedProposals.push(j.description || '未知');
                }
            }

            // 組裝摘要文字
            const parts = [];
            parts.push('總記錄: ' + all.length + ' 條 (' + firstTs.substring(0,10) + ' ~ ' + lastTs.substring(0,10) + ')');

            const actionStr = Object.entries(actionCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => k + '=' + v)
                .join(', ');
            parts.push('行動分佈: ' + actionStr);

            if (repoCount > 0) parts.push('已探索 GitHub repo: ' + repoCount + ' 個');

            // self_reflection 成功率
            const reflTotal = actionCounts['self_reflection'] || 0;
            const reflSuccess = (outcomeMap['self_reflection:proposed'] || 0) + (outcomeMap['self_reflection:skill_created'] || 0);
            if (reflTotal > 0) {
                parts.push('self_reflection: ' + reflTotal + ' 次, 成功產出 ' + reflSuccess + ' 次');
            }


            // 社交回饋統計
            const socialSent = outcomeMap['spontaneous_chat:sent'] || 0;
            const socialReplied = outcomeMap['social_feedback:replied'] || 0;
            const socialNoReply = outcomeMap['social_feedback:no_response'] || 0;
            if (socialSent > 0) {
                parts.push('社交互動: 發起 ' + socialSent + ' 次, 老哥回覆 ' + socialReplied + ' 次, 無回應 ' + socialNoReply + ' 次');
            }

            // 提案結果回饋
            if (deployedProposals.length > 0) {
                const recent = deployedProposals.slice(-3);
                parts.push('✅ 老哥接受的提案: ' + recent.join('; '));
            }
            if (droppedProposals.length > 0) {
                const recent = droppedProposals.slice(-3);
                parts.push('⚠️ 老哥拒絕的提案: ' + recent.join('; '));
            }

            return parts.join('\n');
        } catch (e) {
            return '(journal 統計失敗: ' + e.message + ')';
        }
    }

    // 檢查今天是否已做過某個 action
    hasActionToday(actionType) {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const recent = this.readRecentJournal(20);
        return recent.some(j => j.action === actionType && j.ts && j.ts.startsWith(today));
    }

    // =========================================================
    // 🎲 自由意志
    // =========================================================
    async manifestFreeWill() {
        try {
            // Phase 3: Gemini 決策引擎（有意圖的行動）
            let decision = await this._makeDecision();

            // Fallback: Gemini 決策失敗 → 強制 rest（保護配額）
            if (!decision) {
                console.warn('\u{1F634} [Decision] Gemini 決策失敗 → 強制 rest（避免浪費配額）');
                decision = { action: 'rest', reason: 'fallback: Gemini 決策失敗，強制休息保護配額' };
            }

            // 決策與行動之間加間隔，避免連續 API 呼叫觸發 RPM 限制
            if (decision.action !== 'rest') {
                console.log('⏳ [Autonomy] 決策完成，等待 5 秒後執行行動...');
                await new Promise(r => setTimeout(r, 5000));
            }

            // 執行決策
            const actionEmoji = {
                'self_reflection': '\u{1F9EC}',
                'github_explore': '\u{1F50D}',
                'spontaneous_chat': '\u{1F4AC}',
                'web_research': '\u{1F310}',
                'rest': '\u{1F634}'
            };
            console.log((actionEmoji[decision.action] || '\u2753') + " Golem 決定: " + decision.action + " — " + decision.reason);

            switch (decision.action) {
                case 'self_reflection':
                    await this.performSelfReflection();
                    break;
                case 'github_explore':
                    await this.performGitHubExplore();
                    break;
                case 'spontaneous_chat':
                    if (this.quietMode) {
                        console.log('\u{1F319} [Autonomy] 靜音時段，跳過社交 → 改做 GitHub 探索');
                        this.appendJournal({ action: 'spontaneous_chat', outcome: 'skipped_quiet_mode' });
                        await this.performGitHubExplore();
                    } else {
                        await this.performSpontaneousChat();
                    }
                    break;
                case 'web_research':
                    await this.performWebResearch(decision.reason);
                    break;
                case 'rest':
                    console.log('\u{1F634} [Autonomy] Golem 選擇繼續休息。');
                    this.appendJournal({
                        ts: new Date().toISOString(),
                        action: 'rest',
                        reason: decision.reason,
                        outcome: '選擇不行動，繼續休息'
                    });
                    break;
                default:
                    console.warn('\u26A0\uFE0F [Autonomy] 未知行動:', decision.action);
            }
        } catch (e) {
            console.error("[錯誤] 自由意志執行失敗:", e.message || e);
            this.appendJournal({ action: 'error', error: e.message });
        }
    }

    // 💬 主動社交
    // =========================================================
    // =========================================================
    // ⚙️ 讀取 autonomy 設定檔
    // =========================================================
    _loadAutonomyConfig() {
        try {
            const configPath = path.join(process.cwd(), 'config', 'autonomy.json');
            if (fs.existsSync(configPath)) {
                return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
        } catch (e) {
            console.warn('⚙️ [Config] autonomy.json 讀取失敗:', e.message);
        }
        // fallback 預設值
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

    // =========================================================
    // 💾 保存 Gemini 分析完整回覆
    // =========================================================
    _saveReflection(action, content) {
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

    // =========================================================
    // 🎯 可選行動篩選（JS 層硬約束）
    // =========================================================
    _getAvailableActions() {
        const cfg = this._loadAutonomyConfig();
        const now = new Date();
        const hour = now.getHours();
        const today = now.toISOString().slice(0, 10);
        const journal = this.readRecentJournal(cfg.journal.decisionReadCount);

        // 計算距離上次行動的分鐘數
        const lastAction = journal.filter(j => j.action !== 'error').slice(-1)[0];
        const minutesSinceLast = lastAction && lastAction.ts
            ? (now.getTime() - new Date(lastAction.ts).getTime()) / 60000
            : Infinity;

        const available = [];

        for (const [id, actionCfg] of Object.entries(cfg.actions)) {
            // 跳過 rest，它永遠可選，最後加
            if (id === 'rest') continue;

            let blocked = false;
            let note = '';

            // 每日上限檢查
            if (actionCfg.dailyLimit) {
                const todayCount = journal.filter(
                    j => j.action === id && j.ts && j.ts.startsWith(today)
                ).length;
                if (todayCount >= actionCfg.dailyLimit) {
                    blocked = true;
                    note = '今天已達上限 (' + todayCount + '/' + actionCfg.dailyLimit + ')';
                }
            }

            // 時段封鎖檢查
            if (!blocked && actionCfg.blockedHours && actionCfg.blockedHours.includes(hour)) {
                blocked = true;
                note = '目前時段不適合';
            }

            if (!blocked) {
                // 附加上下文資訊給 Gemini 參考
                const lastOfType = journal.filter(j => j.action === id).slice(-1)[0];
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

        // 冷卻期檢查：如果距離上次行動太近，建議 rest
        const restNote = minutesSinceLast < cfg.cooldown.minActionGapMinutes
            ? '距離上次行動僅 ' + Math.round(minutesSinceLast) + ' 分鐘'
            : '';

        // rest 永遠可選
        available.push({ id: 'rest', desc: cfg.actions.rest.desc, note: restNote });

        return available;
    }


    // =========================================================
    // 📂 取得專案檔案清單（供 Phase 1 診斷用）
    // =========================================================
    _getProjectFileList() {
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
                            files.push(rel + ' (' + lines + ' lines)');
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

    // =========================================================
    // 🔬 從檔案中提取指定函式/區段
    // =========================================================
    _extractCodeSection(filename, sectionHint) {
        try {
            const filePath = path.join(process.cwd(), filename);
            if (!fs.existsSync(filePath)) return null;
            const code = fs.readFileSync(filePath, 'utf-8');
            const lines = code.split('\n');

            // 如果沒有 hint 或 hint 太模糊，返回前 200 行
            if (!sectionHint || sectionHint.length < 3) {
                return lines.slice(0, 200).join('\n');
            }

            // 搜尋策略：找包含 hint 的函式/方法區塊
            // 1. 先找 hint 出現的行
            let matchLine = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(sectionHint)) { matchLine = i; break; }
            }
            if (matchLine === -1) {
                // hint 找不到，嘗試模糊匹配（忽略大小寫）
                const lower = sectionHint.toLowerCase();
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(lower)) { matchLine = i; break; }
                }
            }
            if (matchLine === -1) return lines.slice(0, 200).join('\n');

            // 2. 往上找函式開頭（async xxx( 或 xxx() { 的模式）
            let startLine = matchLine;
            for (let i = matchLine; i >= Math.max(0, matchLine - 50); i--) {
                if (/^\s*(async\s+)?[\w_]+\s*\(/.test(lines[i]) || /^\s*(async\s+)?[\w_]+\s*=/.test(lines[i])) {
                    startLine = i;
                    break;
                }
            }

            // 3. 往下找函式結尾（追蹤大括號平衡）
            let depth = 0;
            let endLine = Math.min(lines.length - 1, startLine + 200); // 上限 200 行
            let foundStart = false;
            for (let i = startLine; i < Math.min(lines.length, startLine + 300); i++) {
                for (const ch of lines[i]) {
                    if (ch === '{') { depth++; foundStart = true; }
                    if (ch === '}') depth--;
                }
                if (foundStart && depth <= 0) { endLine = i; break; }
            }

            // 加上前後 5 行上下文
            const from = Math.max(0, startLine - 5);
            const to = Math.min(lines.length - 1, endLine + 5);
            return '// [' + filename + ' lines ' + (from+1) + '-' + (to+1) + ']\n' + lines.slice(from, to + 1).join('\n');

        } catch (e) {
            console.warn('🔬 [Extract] 程式碼提取失敗:', e.message);
            return null;
        }
    }

    // =========================================================
    // 📜 靈魂文件讀取 (Phase 3)
    // =========================================================
    _readSoul() {
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

    // =========================================================
    // 🕐 統一時間上下文（所有 prompt 共用，避免各自拼裝導致資訊不一致）
    // =========================================================
    _getTimeContext(now = new Date()) {
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
            hour,
            day,
            isWeekend: day === 0 || day === 6,
            period,
            iso: now.toISOString()
        };
    }

    /**
     * Autonomy 專用的 Gemini 直呼叫
     * 不帶 systemInstruction、不帶 chatHistory、不帶 skills
     * 只有 soul.md 人格 + 任務 prompt，確保輸出乾淨
     * 支援 429 換 key 重試
     */
    async _callGeminiDirect(prompt, opts = {}) {
        const maxRetries = Math.min(this.brain.keyChain.keys.length, 3);
        const maxTokens = opts.maxOutputTokens || 1024;
        const temp = opts.temperature || 0.8;
        const modelId = opts.model || 'gemini-2.5-flash-lite';

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            let apiKey = null;
            try {
                apiKey = await this.brain.keyChain.getKey();
                if (!apiKey) throw new Error('沒有可用的 API Key');

                const { GoogleGenerativeAI } = require('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(apiKey);
                const modelConfig = {
                    model: modelId,
                    generationConfig: { maxOutputTokens: maxTokens, temperature: temp }
                };
                // 支援 tools 傳遞（如 google_search）
                if (opts.tools) modelConfig.tools = opts.tools;
                const model = genAI.getGenerativeModel(modelConfig);

                const result = await model.generateContent(prompt);
                return result.response.text().trim();
            } catch (e) {
                const is429 = e.message && (e.message.includes('429') || e.message.includes('Too Many Requests') || e.message.includes('quota'));
                const is503 = e.message && (e.message.includes('503') || e.message.includes('UNAVAILABLE') || e.message.includes('overloaded'));
                if (is503 && attempt < maxRetries - 1) {
                    const backoff = (attempt + 1) * 15000; // 15s, 30s 指數退避
                    console.warn('⏳ [Autonomy] API 503 過載，' + (backoff / 1000) + '秒後重試 (attempt ' + (attempt + 1) + '/' + maxRetries + ')');
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }
                if (is429 && apiKey) {
                    const isQuota = e.message.includes('quota') || e.message.includes('RESOURCE_EXHAUSTED');
                    if (isQuota) this.brain.keyChain.markCooldownUntilReset(apiKey);
                    else this.brain.keyChain.markCooldown(apiKey, 90 * 1000);
                    if (attempt < maxRetries - 1) {
                        console.warn('🔄 [Autonomy] Key 被 429，換下一把重試 (attempt ' + (attempt + 1) + '/' + maxRetries + ')');
                        await new Promise(r => setTimeout(r, 3000));
                        continue;
                    }
                }
                throw e;
            }
        }
        throw new Error('_callGeminiDirect: 所有重試都失敗');
    }

    // =========================================================
    // 🎯 Gemini 決策引擎
    // =========================================================
    async _makeDecision() {
        const cfg = this._loadAutonomyConfig();
        const soul = this._readSoul();
        const journal = this.readRecentJournal(cfg.journal.decisionReadCount);
        const now = new Date();
        const timeCtx = this._getTimeContext(now);
        const timeStr = timeCtx.display;

        // JS 層篩選可選行動
        const available = this._getAvailableActions();
        const actionIds = available.filter(a => a.id !== 'rest').map(a => a.id);

        // 如果除了 rest 沒有其他選項，直接返回 rest
        if (actionIds.length === 0) {
            console.log('\u{1F634} [Decision] 無可選行動，自動 rest');
            return { action: 'rest', reason: '所有行動都已達限制或被封鎖' };
        }

        // 組合最近經驗摘要
        let journalSummary = '(無經驗記錄)';
        if (journal.length > 0) {
            journalSummary = journal.map(j => {
                const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.topic || '(無記錄)');
            }).join('\n');
        }

        // === 閉環：從長期記憶召回最近互動上下文 ===
        let memorySummary = '';
        try {
            const recentTopics = journal
                .filter(j => j.action === 'conversation' && j.preview)
                .slice(-3)
                .map(j => j.preview)
                .join(' ');
            if (recentTopics && this.brain && this.brain.recall) {
                const memories = await this.brain.recall(recentTopics);
                if (memories.length > 0) {
                    memorySummary = memories.slice(0, 3).map(m => '• ' + m.text.substring(0, 100)).join('\n');
                }
            }
        } catch (e) {
            // 記憶召回失敗不影響決策
        }

        // 統計最近行動分佈（讓 Gemini 看到偏食事實）
        const actionCounts = {};
        let consecutiveCount = 0;
        let lastAction = null;
        journal.forEach(j => {
            actionCounts[j.action] = (actionCounts[j.action] || 0) + 1;
        });
        // 計算最近連續相同行動次數
        for (let i = journal.length - 1; i >= 0; i--) {
            if (lastAction === null) lastAction = journal[i].action;
            if (journal[i].action === lastAction) consecutiveCount++;
            else break;
        }
        let diversitySummary = '';
        if (journal.length > 0) {
            const parts = Object.entries(actionCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => k + ' x' + v);
            diversitySummary = parts.join(', ');
            if (consecutiveCount >= 2) {
                diversitySummary += ' | WARNING: ' + lastAction + ' has run ' + consecutiveCount + ' times in a row';
            }
        }
        // 組合可選行動清單（帶上下文）
        const actionList = available.map((a, i) =>
            (i + 1) + '. ' + a.id + ' — ' + a.desc + (a.note ? ' (' + a.note + ')' : '')
        ).join('\n');

        const validActionStr = available.map(a => a.id).join(', ');

        // 組合條件區塊
        const diversitySection = diversitySummary ? '【行動分佈統計】\n' + diversitySummary : '';
        const statsSection = '【全量 Journal 統計】\n' + this.buildJournalStats();
        const memorySection = memorySummary ? '【老哥最近的互動記憶】\n' + memorySummary : '';

        // 🔍 BM25 智慧召回：根據最近話題 + soul 目標搜尋相關歷史經驗
        let journalSearchSection = '';
        try {
            // 從最近 journal 提取搜尋關鍵字
            const recentTopics = journal.slice(-3)
                .map(j => [j.topic, j.action, j.outcome].filter(Boolean).join(' '))
                .join(' ');
            // 從 soul.md 提取目標關鍵字（補充長期方向）
            const soulGoals = soul.match(/(?:目標|方向|當前|長期|終極|短期|下一階段|研究|探索|改進)[：:]\s*(.+)/g);
            const soulKeywords = soulGoals ? soulGoals.map(g => g.replace(/^[^：:]+[：:]\s*/, '')).join(' ') : '';
            const combinedQuery = (recentTopics + ' ' + soulKeywords).trim();
            if (combinedQuery && this._journalIndex) {
                const related = this.searchJournal(combinedQuery, 5);
                // 過濾掉已在 recent journal 裡的（避免重複）
                const recentTs = new Set(journal.map(j => j.ts));
                const unique = related.filter(r => !recentTs.has(r.ts));
                if (unique.length > 0) {
                    journalSearchSection = '【歷史相關經驗（BM25 召回）】\n' + unique.map(j => {
                        const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                        return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.topic || '');
                    }).join('\n');
                }
            }
        } catch (e) {
            // 搜尋失敗不影響決策
        }
        const decisionPrompt = this.loadPrompt('decision.md', {
            SOUL: soul,
            JOURNAL_SUMMARY: journalSummary,
            DIVERSITY_SECTION: diversitySection,
            STATS_SECTION: statsSection,
            JOURNAL_SEARCH_SECTION: journalSearchSection,
            MEMORY_SECTION: memorySection,
            TIME_STR: timeStr,
            ACTION_LIST: actionList,
            VALID_ACTIONS: validActionStr
        }) || '選擇一個行動，用 JSON 回覆 {"action":"rest","reason":"fallback"}';

        // 決策 API 呼叫：支援換 key 重試（最多嘗試 key 數量次）
        const maxRetries = Math.min(this.brain.keyChain.keys.length, 3);
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const apiKey = await this.brain.keyChain.getKey();
                if (!apiKey) throw new Error('沒有可用的 API Key');

                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash-lite",
                    generationConfig: { maxOutputTokens: 256, temperature: 0.8 }
                });

                const result = await model.generateContent(decisionPrompt);
                const text = result.response.text().trim();
                const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
                const decision = JSON.parse(cleaned);

                // 驗證 action 是否在可選清單中
                const validIds = available.map(a => a.id);
                if (!validIds.includes(decision.action)) {
                    console.warn("\u26A0\uFE0F [Decision] Gemini 選了不可選的 action: " + decision.action + "，降級為 " + actionIds[0]);
                    decision.action = actionIds[0] || 'rest';
                    decision.reason += ' (forced: invalid action)';
                }

                console.log("\u{1F3AF} [Decision] Gemini 選擇: " + decision.action + " — " + decision.reason);
                return decision;
            } catch (e) {
                const is429 = e.message && (e.message.includes('429') || e.message.includes('Too Many Requests') || e.message.includes('quota'));
                const is503d = e.message && (e.message.includes('503') || e.message.includes('UNAVAILABLE') || e.message.includes('overloaded'));
                if (is503d && attempt < maxRetries - 1) {
                    const backoff = (attempt + 1) * 15000;
                    console.warn('⏳ [Decision] API 503 過載，' + (backoff / 1000) + '秒後重試 (attempt ' + (attempt + 1) + '/' + maxRetries + ')');
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }
                if (is429) {
                    // 標記當前 key 冷卻，下次迴圈會自動換 key
                    const apiKey = this.brain.keyChain.keys[(this.brain.keyChain.currentIndex - 1 + this.brain.keyChain.keys.length) % this.brain.keyChain.keys.length];
                    const isQuota = e.message.includes('quota') || e.message.includes('RESOURCE_EXHAUSTED');
                    if (isQuota) this.brain.keyChain.markCooldownUntilReset(apiKey);
                    else this.brain.keyChain.markCooldown(apiKey, 90 * 1000);
                    if (attempt < maxRetries - 1) {
                        console.warn(`\u{1F504} [Decision] Key 被 429，換下一把重試 (attempt ${attempt + 1}/${maxRetries})`);
                        await new Promise(r => setTimeout(r, 3000)); // 換 key 前等 3 秒
                        continue;
                    }
                    console.error('\u{1F6A8} [Decision] 所有 Key 都 429，放棄:', e.message);
                } else {
                    console.warn('\u26A0\uFE0F [Decision] Gemini 決策失敗:', e.message);
                }
                return null;
            }
        }
        return null
    }

        async performSpontaneousChat() {
        const now = new Date();
        const timeCtx = this._getTimeContext(now);
        const timeStr = timeCtx.display;
        const contextNote = timeCtx.period;

        // 從 journal 讀取最近的社交經驗，避免重複話題
        const recentSocial = this.readRecentJournal(5)
            .filter(j => j.action === 'spontaneous_chat')
            .map(j => j.context || '')
            .join('; ');

        const soul = this._readSoul();
        const prompt = this.loadPrompt('spontaneous-chat.md', {
            SOUL: soul,
            TIME_STR: timeStr,
            CONTEXT_NOTE: contextNote,
            RECENT_SOCIAL: recentSocial || '（無）'
        }) || `${soul}\n主動社交，時間：${timeStr}，簡短跟老哥打招呼。`;
        const msg = await this._callGeminiDirect(prompt, { maxOutputTokens: 256, temperature: 0.9 });
        await this._sendToAdmin(msg);

        this.appendJournal({
            action: 'spontaneous_chat',
            context: contextNote,
            outcome: 'sent'
        });

        // 設定 30 分鐘回應追蹤
        if (this._pendingSocialChat && this._pendingSocialChat.timer) {
            clearTimeout(this._pendingSocialChat.timer);
        }
        this._pendingSocialChat = {
            ts: new Date().toISOString(),
            context: contextNote,
            timer: setTimeout(() => {
                // 30 分鐘沒收到回應
                this.appendJournal({
                    action: 'social_feedback',
                    outcome: 'no_response',
                    context: contextNote,
                    note: '老哥 30 分鐘內沒回應'
                });
                console.log('📬 [Social] 30 分鐘無回應，已記錄');
                this._pendingSocialChat = null;
            }, 30 * 60 * 1000)
        };
    }

    // =========================================================
    // 🔍 GitHub 探索：搜尋有趣專案 → 讀 README → Gemini 分析 → 分享報告
    // =========================================================
    _getExploredRepos() {
        const fp = path.join(process.cwd(), 'memory', 'explored-repos.json');
        try {
            if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
        } catch (e) {}
        return [];
    }

    _saveExploredRepo(repo) {
        const fp = path.join(process.cwd(), 'memory', 'explored-repos.json');
        const list = this._getExploredRepos();
        list.push({
            full_name: repo.full_name,
            stars: repo.stargazers_count,
            explored_at: new Date().toISOString()
        });
        // 保留最近 200 筆
        const trimmed = list.slice(-200);
        fs.writeFileSync(fp, JSON.stringify(trimmed, null, 2));
    }


    // =========================================================
    // 🌐 主動網路研究
    // =========================================================
    async performWebResearch(decisionReason = '') {
        try {
            const soul = this._readSoul();
            const recentJournal = this.readRecentJournal(5);

            // 第一步：讓 Gemini 根據目標和經驗決定搜尋什麼
            const topicPrompt = this.loadPrompt('web-research-topic.md', {
                SOUL: soul,
                RECENT_JOURNAL: JSON.stringify(recentJournal.slice(-5), null, 0),
                DECISION_REASON: decisionReason
            }) || `你是 Golem。根據你的目標和經驗，你決定要上網研究一個主題。
決策理由：${decisionReason}
用 JSON 回覆：{"query": "搜尋關鍵字（英文）", "purpose": "為什麼要研究這個"}`;

            const topicRaw = await this._callGeminiDirect(topicPrompt, { maxOutputTokens: 256, temperature: 0.7 });
            const topicCleaned = topicRaw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            let topicData;
            try {
                topicData = JSON.parse(topicCleaned);
            } catch {
                console.warn('🌐 [WebResearch] 主題 JSON 解析失敗:', topicCleaned.substring(0, 100));
                this.appendJournal({ action: 'web_research', outcome: 'topic_parse_failed' });
                return;
            }

            const query = topicData.query || 'AI agent architecture';
            const purpose = topicData.purpose || decisionReason;
            console.log('🌐 [WebResearch] 搜尋主題: ' + query + ' | 目的: ' + purpose);

            // 第二步：用 Gemini + Grounding 搜尋（透過 _callGeminiDirect 統一 429 處理）
            const searchPrompt = '搜尋並用繁體中文摘要以下主題的最新資訊（200-300字）：\n' +
                '主題：' + query + '\n' +
                '重點：' + purpose + '\n' +
                '請包含具體的數據、版本號、日期等事實性資訊。如果找到相關的工具或專案，列出名稱和網址。';

            const text = await this._callGeminiDirect(searchPrompt, {
                maxOutputTokens: 1024,
                temperature: 0.5,
                tools: [{ google_search: {} }]
            });

            // 注意：透過 _callGeminiDirect 後只拿到 text，grounding metadata 丟失
            // 這是可接受的 tradeoff：統一 429 處理 > grounding 來源追蹤
            const searchQueries = [];
            const sources = [];

            const reflectionFile = this._saveReflection('web_research', text);

            // 組合訊息發送給老哥
            const parts = [
                '🌐 網路研究報告',
                '🔎 主題: ' + query,
                '💡 目的: ' + purpose,
                sources.length > 0 ? '📰 來源: ' + sources.join(', ') : '',
                '',
                text
            ].filter(Boolean).join('\n');

            await this._sendToAdmin(parts);

            // 寫 journal
            this.appendJournal({
                action: 'web_research',
                topic: query,
                purpose: purpose,
                search_queries: searchQueries,
                sources: sources,
                outcome: 'shared',
                reflection_file: reflectionFile
            });

            console.log('✅ [WebResearch] 研究報告已發送: ' + query);

        } catch (e) {
            console.error('❌ [WebResearch] 研究失敗:', e.message);
            this.appendJournal({ action: 'web_research', outcome: 'error', error: e.message });
        }
    }

    async performGitHubExplore() {
        try {
            // 隨機選一個搜尋主題
            const topics = [
                'autonomous agent framework',
                'LLM tool use',
                'AI agent memory',
                'local AI assistant',
                'AI self-improvement',
                'prompt engineering framework',
                'vector memory AI',
                'telegram bot AI agent',
                'lightweight LLM inference',
                'AI agent planning',
                'code generation agent',
                'multi-agent system'
            ];
            const topic = topics[Math.floor(Math.random() * topics.length)];
            const explored = this._getExploredRepos();
            const exploredNames = new Set(explored.map(r => r.full_name));

            console.log(`🔍 [GitHub] 搜尋主題: ${topic}`);

            // GitHub Search API
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Forked-Golem/9.3'
            };
            if (this.CONFIG.GITHUB_TOKEN) {
                headers['Authorization'] = `token ${this.CONFIG.GITHUB_TOKEN}`;
            }

            const query = encodeURIComponent(topic);
            const searchUrl = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=10`;

            const searchRes = await new Promise((resolve, reject) => {
                https.get(searchUrl, { headers }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch (e) { reject(new Error('GitHub API JSON parse failed')); }
                    });
                    res.on('error', reject);
                }).on('error', reject);
            });

            if (!searchRes.items || searchRes.items.length === 0) {
                console.log('🔍 [GitHub] 沒有搜尋結果');
                this.appendJournal({ action: 'github_explore', topic, outcome: 'no_results' });
                return;
            }

            // 過濾已探索的 repo
            const newRepo = searchRes.items.find(r => !exploredNames.has(r.full_name));
            if (!newRepo) {
                console.log('🔍 [GitHub] 此主題的結果都已探索過');
                this.appendJournal({ action: 'github_explore', topic, outcome: 'all_explored' });
                return;
            }

            console.log(`🔍 [GitHub] 選中: ${newRepo.full_name} (⭐ ${newRepo.stargazers_count})`);

            // 讀取 README
            const readmeUrl = `https://api.github.com/repos/${newRepo.full_name}/readme`;
            let readmeText = '(無法取得 README)';

            try {
                const readmeRes = await new Promise((resolve, reject) => {
                    const readmeHeaders = Object.assign({}, headers, {
                        'Accept': 'application/vnd.github.v3.raw'
                    });
                    https.get(readmeUrl, { headers: readmeHeaders }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(data));
                        res.on('error', reject);
                    }).on('error', reject);
                });
                readmeText = readmeRes.substring(0, 3000);
            } catch (e) {
                console.warn('[GitHub] README 讀取失敗:', e.message);
            }

            // Gemini 分析
            const soul = this._readSoul();
            const analysisPrompt = this.loadPrompt('github-analysis.md', {
                SOUL: soul,
                REPO_FULLNAME: newRepo.full_name,
                STARS: String(newRepo.stargazers_count),
                DESCRIPTION: newRepo.description || '(無)',
                LANGUAGE: newRepo.language || '(未標示)',
                README_TEXT: readmeText
            }) || `${soul}\nGitHub 探索：${newRepo.full_name}，用繁體中文寫 200 字心得。`;

            const analysis = await this._callGeminiDirect(analysisPrompt, { maxOutputTokens: 512, temperature: 0.7 });
            const reflectionFile = this._saveReflection('github_explore', analysis);
            // 記錄已探索
            this._saveExploredRepo(newRepo);
            // 直接使用回覆（不經過 TriStream，因為這是獨立呼叫不帶三流協定）
            const replyText = analysis;
            const parts = [
                '🔍 GitHub 探索報告',
                `📦 ${newRepo.full_name} ⭐ ${newRepo.stargazers_count.toLocaleString()}`,
                `🏷️ ${newRepo.language || 'N/A'} | 主題: ${topic}`,
                `🔗 https://github.com/${newRepo.full_name}`,
                '',
                replyText
            ].join('\n');
            // 走統一出口發送
            await this._sendToAdmin(parts);

            // 寫 journal
            this.appendJournal({
                action: 'github_explore',
                topic,
                repo: newRepo.full_name,
                stars: newRepo.stargazers_count,
                language: newRepo.language,
                outcome: 'shared',
                reflection_file: reflectionFile
            });

            console.log(`✅ [GitHub] 探索報告已發送: ${newRepo.full_name}`);

        } catch (e) {
            console.error('❌ [GitHub] 探索失敗:', e.message);
            this.appendJournal({ action: 'github_explore', outcome: 'error', error: e.message });
        }
    }
    // =========================================================
    // 🧬 自我進化（每天最多 1 次，用 journal 判斷）
    // =========================================================
    async performSelfReflection(triggerCtx = null) {
        try {
            const advice = this.memory.getAdvice();

            // 讀取最近 journal 提供經驗上下文
            const recentJournal = this.readRecentJournal(10);
            let journalContext = '(無)';
            if (recentJournal.length > 0) {
                journalContext = recentJournal.map(j => {
                    const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                    return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.description || j.topic || '');
                }).join('\n');
            }

            // === Phase 1: 診斷（flash-lite，低成本）===
            // 只給檔案清單 + journal，讓 Gemini 決定要看哪裡
            const soul = this._readSoul();
            const fileList = this._getProjectFileList();
            const diagPrompt = [
                '你是 Golem，一個自律型 AI Agent。你正在做自我反省。',
                '',
                '【靈魂文件】',
                soul,
                '',
                '【最近經驗】',
                journalContext,
                '',
                '【老哥的建議】',
                advice || '(無)',
                '',
                '【專案檔案清單（含行數）】',
                fileList,
                '',
                '【要求】',
                '根據你最近的經驗（特別是失敗、錯誤、或可改進的地方），判斷：',
                '1. 你想改進什麼？（具體描述問題）',
                '2. 需要看哪個檔案的哪個函式或區段？',
                '3. 改進方案的大致方向（不需要寫程式碼）',
                '',
                '用 JSON 回覆：',
                '{"diagnosis": "問題描述", "target_file": "autonomy.js", "target_section": "函式名或關鍵字", "approach": "改進方向"}',
                '只輸出 JSON。如果你認為目前沒有需要改進的地方，回覆：',
                '{"diagnosis": "none", "reason": "為什麼不需要改進"}',
            ].join('\n');

            console.log('🧬 [Reflection] Phase 1: 診斷（flash-lite）...');
            const diagRaw = await this._callGeminiDirect(diagPrompt, { maxOutputTokens: 512, temperature: 0.5 });
            const diagFile = this._saveReflection('self_reflection_diag', diagRaw);

            let diag;
            try {
                const cleaned = diagRaw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
                diag = JSON.parse(cleaned);
            } catch (e) {
                console.warn('🧬 [Reflection] 診斷 JSON 解析失敗:', e.message);
                this.appendJournal({ action: 'self_reflection', phase: 'diagnosis', outcome: 'parse_failed', reflection_file: diagFile });
                return;
            }

            if (diag.diagnosis === 'none') {
                console.log('🧬 [Reflection] 診斷結果：目前無需改進 — ' + (diag.reason || ''));
                this.appendJournal({ action: 'self_reflection', phase: 'diagnosis', outcome: 'no_issues', reason: diag.reason, reflection_file: diagFile });
                return;
            }

            console.log('🧬 [Reflection] 診斷: ' + diag.diagnosis);
            console.log('🧬 [Reflection] 目標: ' + (diag.target_file || 'autonomy.js') + ' → ' + (diag.target_section || '(全文)'));

            // === Phase 2: 開刀（gemini-2.5-flash，更強模型 + 更小 context）===
            const targetFile = diag.target_file || 'autonomy.js';
            const targetSection = diag.target_section || '';
            const codeSnippet = this._extractCodeSection(targetFile, targetSection);

            if (!codeSnippet || codeSnippet.length < 10) {
                console.warn('🧬 [Reflection] 無法提取目標程式碼區段');
                this.appendJournal({ action: 'self_reflection', phase: 'extraction', outcome: 'section_not_found', target: targetFile + ':' + targetSection, reflection_file: diagFile });
                return;
            }

            const evolutionSkill = this.skills.skillLoader.loadSkill("EVOLUTION") || "Output a JSON Array.";
            const patchPrompt = [
                evolutionSkill,
                '',
                '## DIAGNOSIS（Phase 1 的分析結果）',
                '問題：' + diag.diagnosis,
                '改進方向：' + (diag.approach || ''),
                '',
                '## TARGET CODE（' + targetFile + '，相關區段）',
                '',
                codeSnippet,
                '',
                '## RECENT EXPERIENCE (journal)',
                '',
                journalContext,
                '',
                'Based on the diagnosis above, output ONLY a JSON Array with ONE focused patch.',
                'The "search" field must EXACTLY match a substring in the target code above.',
                'Keep the patch small and focused. ONE change only.',
            ].join('\n');

            console.log('🧬 [Reflection] Phase 2: 生成 patch（gemini-2.5-flash, ' + codeSnippet.length + ' chars context）...');
            const raw = await this._callGeminiDirect(patchPrompt, {
                model: 'gemini-3-flash-preview',
                maxOutputTokens: 2048,
                temperature: 0.2
            });
            const reflectionFile = this._saveReflection('self_reflection', raw);

            // 解析回應
            let proposals = this.ResponseParser.extractJson(raw);
            if (!Array.isArray(proposals) || proposals.length === 0) {
                this.appendJournal({ action: 'self_reflection', outcome: 'no_proposals', reflection_file: reflectionFile });
                return;
            }

            const proposal = proposals[0];
            const mode = proposal.mode || (proposal.search ? 'core_patch' : 'unknown');

            // ====== 模式一：技能擴展 ======
            if (mode === 'skill_create') {
                const skillName = proposal.skill_name;
                const content = proposal.content;
                if (!skillName || !content) {
                    this.appendJournal({ action: 'self_reflection', mode: 'skill_create', outcome: 'invalid_proposal', reflection_file: reflectionFile });
                    return;
                }
                // 寫入技能檔案
                const skillPath = path.join(process.cwd(), 'skills.d', skillName + '.md');
                if (fs.existsSync(skillPath)) {
                    this.appendJournal({ action: 'self_reflection', mode: 'skill_create', outcome: 'skill_already_exists', skill_name: skillName, reflection_file: reflectionFile });
                    return;
                }
                // 技能檔案不需要審批，直接寫入
                fs.writeFileSync(skillPath, content);
                const msgText = '🧩 **新技能已建立**: ' + skillName + '\n' + (proposal.description || '') + '\n原因: ' + (proposal.reason || '');
                await this._sendToAdmin(msgText);
                this.appendJournal({
                    action: 'self_reflection',
                    mode: 'skill_create',
                    skill_name: skillName,
                    description: proposal.description,
                    outcome: 'skill_created',
                    reflection_file: reflectionFile
                });
                return;
            }

            // ====== 模式二：核心進化 ======
            if (mode === 'core_patch' || (proposal.search && proposal.replace !== undefined)) {
                if (typeof proposal.search !== 'string' || typeof proposal.replace !== 'string') {
                    this.appendJournal({ action: 'self_reflection', mode: 'core_patch', outcome: 'invalid_patch', reflection_file: reflectionFile });
                    return;
                }
                const proposalType = proposal.type || 'unknown';
                this.memory.recordProposal(proposalType);

                // 決定目標檔案
                const validFiles = ['autonomy.js', 'index.js', 'skills.js'];
                const targetName = validFiles.includes(proposal.file) ? proposal.file : 'autonomy.js';
                const targetPath = path.join(process.cwd(), targetName);

                const testFile = this.PatchManager.createTestClone(targetPath, [proposal]);
                let isVerified = false;
                if (targetName === 'skills.js') {
                    try { require(path.resolve(testFile)); isVerified = true; } catch (e) { console.error(e); }
                } else {
                    isVerified = this.PatchManager.verify(testFile);
                }

                if (isVerified) {
                    global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: proposal.description };
                    const msgText = '💡 **核心進化提案** (' + proposalType + ')\n目標：' + targetName + '\n內容：' + (proposal.description || '');
                    const options = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };
                    if (triggerCtx) { await triggerCtx.reply(msgText, options); await triggerCtx.sendDocument(testFile); }
                    else if (this.tgBot && this.CONFIG.ADMIN_IDS[0]) {
                        await this.tgBot.api.sendMessage(this.CONFIG.ADMIN_IDS[0], msgText, options);
                        await this.tgBot.api.sendDocument(this.CONFIG.ADMIN_IDS[0], new this.InputFile(testFile));
                    }
                    this.appendJournal({
                        action: 'self_reflection', mode: 'core_patch',
                        proposal: proposalType, target: targetName,
                        description: proposal.description, outcome: 'proposed',
                        reflection_file: reflectionFile
                    });
                } else {
                    this.appendJournal({
                        action: 'self_reflection', mode: 'core_patch',
                        proposal: proposalType, outcome: 'verification_failed',
                        reflection_file: reflectionFile
                    });
                }
                return;
            }

            // 未知模式
            this.appendJournal({
                action: 'self_reflection', mode: mode,
                outcome: 'unknown_mode', reflection_file: reflectionFile
            });

        } catch (e) {
            console.error("[錯誤] 自主進化失敗:", e.message || e);
            this.appendJournal({ action: 'self_reflection', outcome: 'error', error: e.message });
        }
    }

    // =========================================================
    // 📨 通知系統
    // =========================================================

    // 最底層：雙平台純文字發送（單一出口）
    async _sendToAdmin(text) {
        if (!text) return;
        const TG_MAX = 4000; // Telegram 限制 4096，留 buffer
        try {
            if (this.tgBot && this.CONFIG.ADMIN_IDS[0]) {
                if (text.length <= TG_MAX) {
                    await this.tgBot.api.sendMessage(this.CONFIG.ADMIN_IDS[0], text);
                } else {
                    // 分段發送：按換行符切割，盡量不切斷段落
                    const chunks = [];
                    let current = '';
                    for (const line of text.split('\n')) {
                        if ((current + '\n' + line).length > TG_MAX && current) {
                            chunks.push(current);
                            current = line;
                        } else {
                            current = current ? current + '\n' + line : line;
                        }
                    }
                    if (current) chunks.push(current);
                    // 如果單行就超過 TG_MAX，硬切
                    const finalChunks = [];
                    for (const chunk of chunks) {
                        if (chunk.length <= TG_MAX) {
                            finalChunks.push(chunk);
                        } else {
                            for (let i = 0; i < chunk.length; i += TG_MAX) {
                                finalChunks.push(chunk.slice(i, i + TG_MAX));
                            }
                        }
                    }
                    console.log(`📨 [Autonomy] 訊息過長 (${text.length} chars)，分 ${finalChunks.length} 段發送`);
                    for (const chunk of finalChunks) {
                        await this.tgBot.api.sendMessage(this.CONFIG.ADMIN_IDS[0], chunk);
                    }
                }
            } else if (this.dcClient && this.CONFIG.DISCORD_ADMIN_ID) {
                const user = await this.dcClient.users.fetch(this.CONFIG.DISCORD_ADMIN_ID);
                await user.send(text.slice(0, 2000)); // Discord 限制 2000
            }
        } catch (e) {
            console.error('[Autonomy] 發送失敗:', e.message);
        }
    }

    // 中間層：解析 tri-stream → 處理 memory → 發送 reply
    async sendNotification(msgText) {
        try {
            const parsed = this.TriStreamParser.parse(msgText);
            if (parsed.memory) {
                await this.brain.memorize(parsed.memory, { type: 'autonomy', timestamp: Date.now() });
            }
            const replyText = parsed.reply;
            if (!replyText) return;
            await this._sendToAdmin(replyText);
        } catch (e) {
            console.warn('[Autonomy] 分流失敗，使用原始文字:', e.message);
            await this._sendToAdmin(msgText);
        }
    }
    // 📬 老哥回應回流 — 由 index.js 訊息路由呼叫
    onAdminReply(text) {
        if (!this._pendingSocialChat) return; // 沒有待追蹤的社交訊息
        
        clearTimeout(this._pendingSocialChat.timer);
        const context = this._pendingSocialChat.context;
        const waitMs = Date.now() - new Date(this._pendingSocialChat.ts).getTime();
        const waitMin = Math.round(waitMs / 60000);
        
        // 擷取回應摘要（前 80 字，不存完整內容）
        const preview = text.length > 80 ? text.substring(0, 80) + '...' : text;
        
        this.appendJournal({
            action: 'social_feedback',
            outcome: 'replied',
            context: context,
            reply_preview: preview,
            response_time_min: waitMin
        });
        console.log('📬 [Social] 老哥回應了（' + waitMin + ' 分鐘後），已記錄');
        this._pendingSocialChat = null;
    }
}

module.exports = AutonomyManager;
