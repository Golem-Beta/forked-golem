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
        } catch (e) {
            console.warn("[Journal] 寫入失敗:", e.message);
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

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            let apiKey = null;
            try {
                apiKey = await this.brain.keyChain.getKey();
                if (!apiKey) throw new Error('沒有可用的 API Key');

                const { GoogleGenerativeAI } = require('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash-lite",
                    generationConfig: { maxOutputTokens: maxTokens, temperature: temp }
                });

                const result = await model.generateContent(prompt);
                return result.response.text().trim();
            } catch (e) {
                const is429 = e.message && (e.message.includes('429') || e.message.includes('Too Many Requests') || e.message.includes('quota'));
                if (is429 && apiKey) {
                    this.brain.keyChain.markCooldown(apiKey, 90 * 1000);
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
        const timeStr = now.toLocaleString('zh-TW', {
            weekday: 'long', year: 'numeric', month: 'long',
            day: 'numeric', hour: '2-digit', minute: '2-digit',
            hour12: false
        });

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
        const memorySection = memorySummary ? '【老哥最近的互動記憶】\n' + memorySummary : '';
        const decisionPrompt = this.loadPrompt('decision.md', {
            SOUL: soul,
            JOURNAL_SUMMARY: journalSummary,
            DIVERSITY_SECTION: diversitySection,
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
                if (is429) {
                    // 標記當前 key 冷卻，下次迴圈會自動換 key
                    const apiKey = this.brain.keyChain.keys[(this.brain.keyChain.currentIndex - 1 + this.brain.keyChain.keys.length) % this.brain.keyChain.keys.length];
                    this.brain.keyChain.markCooldown(apiKey, 90 * 1000);
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
        const timeStr = now.toLocaleString('zh-TW', { hour12: false });
        const day = now.getDay();
        const hour = now.getHours();
        let contextNote = "平常時段";
        if (day === 0 || day === 6) contextNote = "週末假日，語氣輕鬆";
        if (hour >= 9 && hour <= 18 && day > 0 && day < 6) contextNote = "工作時間，語氣簡潔暖心";
        if (hour > 22) contextNote = "深夜時段，提醒休息";

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
            // 讀取目標程式碼
            let autonomyCode, indexCode;
            try { autonomyCode = fs.readFileSync(path.join(process.cwd(), 'autonomy.js'), 'utf-8'); } catch (e) { autonomyCode = '(autonomy.js 讀取失敗)'; }
            try { indexCode = this.Introspection.readSelf(); } catch (e) { indexCode = ''; }
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

            // Load EVOLUTION skill as prompt template
            const evolutionSkill = this.skills.skillLoader.loadSkill("EVOLUTION") || "Output a JSON Array.";
            const prompt = [
                evolutionSkill,
                "",
                "## PRIMARY TARGET: autonomy.js (full source)",
                "",
                autonomyCode,
                "",
                "## SECONDARY CONTEXT: index.js (first 8000 chars, for reference only)",
                "",
                indexCode.slice(0, 8000),
                "",
                "## RECENT EXPERIENCE (journal)",
                "",
                journalContext,
                "",
                "## CONTEXT FROM MEMORY",
                "",
                advice || "(none)",
                "",
                "Based on the code and your recent experience, output ONLY a JSON Array. No other text.",
            ].join("\n");

            const raw = await this._callGeminiDirect(prompt, { maxOutputTokens: 2048, temperature: 0.3 });
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
}

module.exports = AutonomyManager;
