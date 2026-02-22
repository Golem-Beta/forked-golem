/**
 * 🦞 Forked-Golem v9.7.0 (ModelRouter Edition)
 * ---------------------------------------------------
 * 基於 Arvincreator/project-golem 分支，重構為 API 直連 + 輕量 headless 架構
 * 目標硬體：ThinkPad X200, 4-8GB RAM, Arch Linux headless (TTY + SSH)
 *
 * 架構：[Universal Context] -> [Node.js 反射層] <==> [ModelRouter] <==> [Gemini/Groq/DeepSeek/...]
 * 特性：
 *   1. 🐍 Hydra Link — Telegram (grammy) + Discord 雙平台
 *   2. 🚀 ModelRouter — 多供應商 LLM 智慧路由（intent-based 選路 + 健康追蹤）
 *   3. ⚓ Tri-Stream Protocol — Memory/Action/Reply 三流並行
 *   4. 🔮 OpticNerve — 視覺解析（圖片/文件）
 *   5. 🌗 Dual-Engine Memory — Native FS / QMD 雙模記憶核心
 *   6. 🛡️ SecurityManager v2 — 白名單/黑名單 + Taint 偵測 + Flood Guard
 *   7. 📦 Titan Queue — 訊息防抖合併 + Per-chat 序列化
 *   8. 📟 Dashboard — blessed 戰術控制台（支援 detach/reattach）
 */

// ==========================================
// 📟 儀表板外掛 (Dashboard Switch)
// 用法：npm start dashboard (開啟)
//       npm start           (關閉)
// ==========================================
if (process.argv.includes('dashboard')) {
    try {
        require('./src/dashboard');
        console.log("✅ 戰術控制台已啟動 (繁體中文版)");
    } catch (e) {
        console.error("❌ 無法載入 Dashboard:", e.message);
    }
} else {
    console.log("ℹ️  以標準模式啟動 (無 Dashboard)。若需介面請輸入 'npm start dashboard'");
}
// ==========================================
const GOLEM_VERSION = require('./package.json').version;
require('dotenv').config();
const { Bot, InputFile } = require('grammy');
const { autoRetry } = require('@grammyjs/auto-retry');
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
// [已移除] puppeteer / puppeteer-extra / stealth — API 直連模式不需要瀏覽器
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exec, execSync, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const skills = require('./src/skills');
const SecurityManager = require('./src/security');
const { TriStreamParser, ResponseParser, dbg } = require('./src/parsers');
const { loadPrompt, loadFeedbackPrompt } = require('./src/prompt-loader');

// --- ⚙️ 全域配置 (已搬至 src/config.js) ---
const CONFIG = require("./src/config");
const { cleanEnv, isPlaceholder } = CONFIG;

// --- 初始化組件 ---
// [已移除] puppeteer.use(StealthPlugin());

// 🛡️ [Flood Guard] 啟動時間戳，用於過濾離線期間堆積的訊息
const BOOT_TIME = Date.now();
const API_MIN_INTERVAL_MS = 2500; // API 呼叫最小間隔 (毫秒)

// 1. Telegram Bot
const tgBot = CONFIG.TG_TOKEN ? new Bot(CONFIG.TG_TOKEN) : null;
if (tgBot) { tgBot.api.config.use(autoRetry({ maxRetryAttempts: 5, maxDelaySeconds: 60 })); }

// 2. Discord Client
const dcClient = CONFIG.DC_TOKEN ? new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
}) : null;

const pendingTasks = new Map(); // 暫存等待審核的任務
global.pendingPatch = null; // 暫存等待審核的 Patch
// ============================================================
// Phase 2 模組 (已搬至 src/)
// ============================================================
const { OpticNerve, UniversalContext, MessageManager } = require('./src/context');
const MessageBuffer = require('./src/message-buffer');
const { ExperienceMemory, SystemQmdDriver, SystemNativeDriver } = require('./src/memory-drivers');
const { GolemBrain, getSystemFingerprint } = require('./src/brain');
const { Introspection, PatchManager, SystemUpgrader } = require('./src/upgrader');
const { ToolScanner, HelpManager } = require('./src/tools');
const memory = new ExperienceMemory();

// ============================================================
// ⚡ NodeRouter (反射層)
// ============================================================
class NodeRouter {
    static async handle(ctx, brain) {
        const text = ctx.text ? ctx.text.trim() : "";
        if (text.match(/^\/(help|menu|指令|功能)/)) { await ctx.reply(HelpManager.getManual(), { parse_mode: 'Markdown' }); return true; }

        // ✨ 新增：贊助指令
        if (text === '/donate' || text === '/support' || text === '贊助') {
            await ctx.reply(`☕ **感謝您的支持心意！**\n\n您的支持是 Golem 持續進化的動力來源。\n您可以透過以下連結請我的創造者喝杯咖啡：\n\n${CONFIG.DONATE_URL}\n\n(Golem 覺得開心 🤖❤️)`);
            return true;
        }

        // OTA 更新入口
        if (text === '/update' || text === '/reset' || text === '系統更新') {
            await ctx.reply("⚠️ **系統更新警告**\n這將從 GitHub 強制覆蓋本地代碼。\n請確認您的 GitHub 上的程式碼是可運行的。", {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔥 確認更新', callback_data: 'SYSTEM_FORCE_UPDATE' },
                        { text: '❌ 取消', callback_data: 'SYSTEM_UPDATE_CANCEL' }
                    ]]
                }
            });
            return true;
        }

        if (text.startsWith('/callme')) {
            const newName = text.replace('/callme', '').trim();
            if (newName) {
                skills.persona.setName('user', newName);
                await brain.init(true);
                await ctx.reply(`👌 了解，以後叫你 **${newName}**。`, { parse_mode: "Markdown" });
                return true;
            }
        }
        if (text.startsWith('/patch') || text.includes('優化代碼')) return false;
        return false;
    }
}

// ============================================================
// ⚡ Task Controller (閉環回饋版 + 汙染追蹤)
// ============================================================
class TaskController {
    constructor() {
        this.security = new SecurityManager();
        // Executor 在 runSequence 首次呼叫時 lazy-init（每個 sequence 共享 cwd）
    }

    /**
     * @param {object} ctx - UniversalContext
     * @param {Array} steps - [{cmd: "..."}, ...]
     * @param {number} startIndex
     * @param {boolean} tainted - 上下文是否包含外部不可信內容
     */
    async runSequence(ctx, steps, startIndex = 0, tainted = false) {
        let reportBuffer = [];
        for (let i = startIndex; i < steps.length; i++) {
            const step = steps[i];
            // ✨ [Consolidated] 欄位正規化：Gemini 可能回 cmd / command / shell / action
            if (!step.cmd) {
                step.cmd = step.command || step.shell || step.action || '';
            }
            if (!step.cmd) {
                dbg('TaskCtrl', `Step ${i} 無有效指令欄位，跳過:`, JSON.stringify(step));
                reportBuffer.push(`⚠️ [Step ${i + 1}] 無法辨識指令格式: ${JSON.stringify(step).substring(0, 100)}`);
                continue;
            }

            // ✨ [v7.6] Tool Discovery Interceptor
            // 🔧 [v9.2] golem-skill 虛擬指令：技能管理
            // ⏰ [Chronos] golem-schedule 虛擬指令
            if (step.cmd.startsWith('golem-schedule')) {
                const parts = step.cmd.match(/^golem-schedule\s+(\w+)\s*(.*)/);
                if (!parts) {
                    reportBuffer.push('❓ 用法: golem-schedule add <分鐘> <訊息> | list | cancel <id>');
                    continue;
                }
                const [, subCmd, rest] = parts;
                if (subCmd === 'add') {
                    const addMatch = rest.match(/^(\d+)\s+(.+)/);
                    if (!addMatch) {
                        reportBuffer.push('❓ 用法: golem-schedule add <分鐘> <提醒內容>');
                    } else {
                        reportBuffer.push(chronos.add(addMatch[1], addMatch[2]));
                    }
                } else if (subCmd === 'list') {
                    reportBuffer.push(chronos.list());
                } else if (subCmd === 'cancel') {
                    reportBuffer.push(chronos.cancel(rest.trim()));
                } else {
                    reportBuffer.push('❓ 用法: golem-schedule add <分鐘> <訊息> | list | cancel <id>');
                }
                continue;
            }
            if (step.cmd.startsWith('golem-skill')) {
                const parts = step.cmd.split(/\s+/);
                const subCmd = parts[1]; // list / load / reload
                if (subCmd === 'list') {
                    const listing = skills.skillLoader.listSkills();
                    reportBuffer.push(`📦 [技能目錄]\n${listing}`);
                } else if (subCmd === 'load' && parts[2]) {
                    const skillName = parts[2];
                    const content = skills.skillLoader.loadSkill(skillName);
                    if (content) {
                        // 注入到當前對話的 system context
                        await brain.sendMessage(`[系統注入] 已載入技能 ${skillName}:\n${content}`, true);
                        reportBuffer.push(`✅ 技能 ${skillName} 已載入並注入當前對話`);
                    } else {
                        reportBuffer.push(`❌ 找不到技能: ${skillName}。使用 golem-skill list 查看可用技能。`);
                    }
                } else if (subCmd === 'reload') {
                    skills.skillLoader.reload();
                    reportBuffer.push('✅ 技能索引已重新掃描');
                } else {
                    reportBuffer.push('❓ 用法: golem-skill list | load <名稱> | reload');
                }
                continue;
            }
            if (step.cmd.startsWith('golem-check')) {
                const toolName = step.cmd.split(' ')[1];
                if (!toolName) {
                    reportBuffer.push(`⚠️ [ToolCheck] 缺少參數。用法: golem-check <tool>`);
                } else {
                    const result = ToolScanner.check(toolName);
                    reportBuffer.push(`🔍 [ToolCheck] ${result}`);
                }
                continue;
            }

            // 🛡️ 風險評估 (傳入 tainted 標記)
            const risk = this.security.assess(step.cmd, tainted);
            dbg('Security', `[${risk.level}] ${step.cmd.substring(0, 60)}${tainted ? ' (tainted)' : ''}`);

            if (risk.level === 'BLOCKED') {
                return `⛔ 指令被系統攔截：${step.cmd} (原因: ${risk.reason})`;
            }
            if (risk.level === 'WARNING' || risk.level === 'DANGER') {
                const approvalId = uuidv4();
                pendingTasks.set(approvalId, { steps, nextIndex: i, ctx, tainted });
                const taintedNote = tainted ? '\n⚠️ **注意：此指令源自包含外部內容的上下文**' : '';
                const confirmMsg = `${risk.level === 'DANGER' ? '🔥' : '⚠️'} **請求確認**\n指令：\`${step.cmd}\`\n風險：${risk.reason}${taintedNote}`;
                await ctx.reply(confirmMsg, {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ 批准', callback_data: `APPROVE:${approvalId}` },
                            { text: '🛡️ 駁回', callback_data: `DENY:${approvalId}` }
                        ]]
                    }
                });
                return null;
            }

            try {
                if (!this.internalExecutor) this.internalExecutor = new Executor();
                const output = await this.internalExecutor.run(step.cmd);
                reportBuffer.push(`[Step ${i + 1} Success] cmd: ${step.cmd}\nResult/Output:\n${output.trim() || "(No stdout)"}`);
            } catch (err) {
                reportBuffer.push(`[Step ${i + 1} Failed] cmd: ${step.cmd}\nError:\n${err.message}`);
            }
        }
        return reportBuffer.join('\n\n----------------\n\n');
    }
}

class Executor {
    /**
     * Sandboxed command executor with session-persistent cwd.
     * - 每個 Executor instance 建立獨立的 /tmp/golem-task-<id>/ 工作目錄
     * - cd 指令在 JS 層追蹤 cwd 狀態，跨步驟生效
     * - 互動式程式（htop, top, vim 等）自動攔截
     * - 所有 exec 帶 30s timeout 防掛起
     * - Golem repo 目錄（~/forked-golem/）不可被 cd 進入
     */
    constructor() {
        this.taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this.WORKSPACE = path.join(os.tmpdir(), `golem-task-${this.taskId}`);
        fs.mkdirSync(this.WORKSPACE, { recursive: true });
        this.cwd = this.WORKSPACE;

        // 禁止 cd 進入的路徑（Golem repo + 系統敏感目錄）
        this.FORBIDDEN_PATHS = [
            path.resolve(process.cwd()),            // ~/forked-golem/
            '/etc', '/boot', '/root', '/sys', '/proc'
        ];

        // 互動式程式黑名單（exec 裡會掛住）
        this.INTERACTIVE_CMDS = ['htop', 'top', 'vim', 'vi', 'nano', 'less', 'more', 'man', 'ssh', 'ftp', 'python', 'node'];
    }

    /**
     * 執行一個 shell 指令（沙盒內）
     * @param {string} cmd - shell 指令
     * @returns {Promise<string>} stdout
     */
    run(cmd) {
        const baseCmd = cmd.trim().split(/\s+/)[0];

        // 互動式程式攔截
        if (this.INTERACTIVE_CMDS.includes(baseCmd) && !cmd.includes('-e') && !cmd.includes('-c') && !cmd.includes('-b')) {
            // 特殊處理：top -bn1 這類帶 batch flag 的放行
            if (baseCmd === 'top' && (cmd.includes('-b') || cmd.includes('--batch'))) {
                // 放行
            } else if ((baseCmd === 'python' || baseCmd === 'python3' || baseCmd === 'node') && (cmd.includes('-e') || cmd.includes('-c'))) {
                // 放行 python -c / node -e
            } else {
                const hint = baseCmd === 'top' ? '試試 top -bn1' : `${baseCmd} 是互動式程式，無法在 exec 中執行`;
                console.warn(`⚠️ Sandbox: 攔截互動式指令 ${baseCmd} — ${hint}`);
                return Promise.reject(`⚠️ ${baseCmd} 是互動式程式，無法在 exec 中執行。${baseCmd === 'top' ? ' 改用: top -bn1' : ''}`);
            }
        }

        // cd 指令：JS 層追蹤 cwd
        const cdMatch = cmd.match(/^cd\s+(.+)$/);
        if (cdMatch) {
            const target = cdMatch[1].trim().replace(/^["']|["']$/g, '');
            const resolved = path.resolve(this.cwd, target);

            // 禁止 cd 進入 Golem repo 或系統敏感目錄
            for (const forbidden of this.FORBIDDEN_PATHS) {
                if (resolved === forbidden || resolved.startsWith(forbidden + '/')) {
                    console.warn(`⚠️ Sandbox: 禁止 cd 進入 ${resolved}`);
                    return Promise.reject(`⚠️ 安全限制：不允許進入 ${resolved}`);
                }
            }

            if (fs.existsSync(resolved)) {
                this.cwd = resolved;
                console.log(`⚡ Exec: cd ${target} → cwd=${this.cwd}`);
                return Promise.resolve(`Changed directory to ${this.cwd}`);
            } else {
                return Promise.reject(`cd: no such directory: ${resolved}`);
            }
        }

        return new Promise((resolve, reject) => {
            console.log(`⚡ Exec: ${cmd}  (cwd: ${this.cwd})`);
            exec(cmd, {
                cwd: this.cwd,
                timeout: 30000,
                maxBuffer: 1024 * 512,    // 512KB stdout 上限
                env: { ...process.env, HOME: this.WORKSPACE }  // HOME 也指向沙盒
            }, (err, stdout, stderr) => {
                if (err) {
                    if (err.killed) reject('⏱️ 指令超時（30 秒限制）');
                    else reject(stderr || err.message);
                }
                else resolve(stdout);
            });
        });
    }

    /** 取得沙盒工作目錄路徑 */
    getWorkspace() { return this.WORKSPACE; }

    /** 清理沙盒目錄 */
    cleanup() {
        try {
            fs.rmSync(this.WORKSPACE, { recursive: true, force: true });
            console.log(`🧹 Sandbox cleanup: ${this.WORKSPACE}`);
        } catch (e) { /* 忽略清理失敗 */ }
    }
}

// ============================================================
// 🕰️ Autonomy Manager (自主進化 & Agentic News)
// ============================================================
// ============================================================
// ⏰ ChronosManager (時間排程系統)
// ============================================================
class ChronosManager {
    constructor() {
        this.schedulePath = path.join(process.cwd(), 'memory', 'schedules.json');
        this.timers = new Map(); // id -> setTimeout handle
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

    /**
     * 啟動時重建所有未過期的 timer
     */
    rebuild() {
        // 清除舊 timer
        for (const [id, handle] of this.timers) {
            clearTimeout(handle);
        }
        this.timers.clear();

        const now = Date.now();
        const alive = [];
        let expiredCount = 0;

        for (const s of this.schedules) {
            if (s.fireAt <= now) {
                // 已過期——立即觸發（重啟後補發）
                expiredCount++;
                this._fire(s, true);
            } else {
                alive.push(s);
                this._arm(s);
            }
        }

        this.schedules = alive;
        this._save();

        const total = alive.length + expiredCount;
        if (total > 0) {
            console.log(`⏰ [Chronos] 重建完成: ${alive.length} 個排程待觸發, ${expiredCount} 個過期補發`);
        }
    }

    /**
     * 設定單一排程的 setTimeout
     */
    _arm(schedule) {
        const delay = schedule.fireAt - Date.now();
        if (delay <= 0) {
            this._fire(schedule, false);
            return;
        }
        const handle = setTimeout(() => {
            this._fire(schedule, false);
        }, delay);
        this.timers.set(schedule.id, handle);
    }

    /**
     * 觸發排程：發送 TG 訊息 + 清除
     */
    _fire(schedule, isLate) {
        const lateNote = isLate ? ' (重啟後補發)' : '';
        const msg = `⏰ **定時提醒**${lateNote}\n${schedule.message}`;
        console.log(`⏰ [Chronos] 觸發: ${schedule.message}${lateNote}`);

        // 發送 TG 訊息
        if (tgBot && CONFIG.ADMIN_IDS[0]) {
            tgBot.api.sendMessage(CONFIG.ADMIN_IDS[0], msg).catch(e => {
                console.error('[Chronos] 發送失敗:', e.message);
            });
        }

        // 清除
        this.timers.delete(schedule.id);
        this.schedules = this.schedules.filter(s => s.id !== schedule.id);
        this._save();
    }

    /**
     * 新增排程
     * @param {number} minutes - 幾分鐘後
     * @param {string} message - 提醒內容
     * @returns {string} 確認訊息
     */
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

    /**
     * 列出所有排程
     */
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

    /**
     * 取消排程
     */
    cancel(id) {
        const idx = this.schedules.findIndex(s => s.id === id);
        if (idx === -1) return `❌ 找不到排程: ${id}`;
        const removed = this.schedules.splice(idx, 1)[0];
        const handle = this.timers.get(id);
        if (handle) {
            clearTimeout(handle);
            this.timers.delete(id);
        }
        this._save();
        return `✅ 已取消排程: ${removed.message} [id: ${id}]`;
    }
}

const AutonomyManager = require('./src/autonomy');
// ============================================================
// 🎮 Hydra Main Loop
// ============================================================
const ModelRouter = require('./src/model-router');
const modelRouter = new ModelRouter();

// 📟 Dashboard 注入 ModelRouter 參照
try {
    const dash = require.cache[require.resolve('./src/dashboard')];
    if (dash && dash.exports && dash.exports._modelRouter === undefined) {
        dash.exports._modelRouter = modelRouter;
    }
} catch(e) { /* dashboard 未載入時靜默跳過 */ }
const brain = new GolemBrain(modelRouter);
const controller = new TaskController();
const chronos = new ChronosManager();
const autonomy = new AutonomyManager({
    brain, chronos, tgBot, dcClient, memory, skills,
    CONFIG, loadPrompt, loadFeedbackPrompt,
    Introspection, PatchManager, TriStreamParser, ResponseParser, InputFile
});

// 📟 Dashboard 注入 Autonomy 參照（倒數計時用）
try {
    const dash = require.cache[require.resolve('./src/dashboard')];
    if (dash && dash.exports && dash.exports._autonomy === undefined) {
        dash.exports._autonomy = autonomy;
    }
} catch(e) { /* dashboard 未載入時靜默跳過 */ }

(async () => {
    // 測試模式攔截器：防止在 CI/CD 或純邏輯測試時啟動瀏覽器
    if (process.env.GOLEM_TEST_MODE === 'true') {
        console.log('🚧 [System] GOLEM_TEST_MODE is active.');
        console.log('🛑 Brain initialization & Browser launch skipped.');
        console.log('✅ System syntax check passed.');
        return;
    }

    await brain.init();
    autonomy.start();
    console.log(`📡 Golem v${GOLEM_VERSION} is Online.`);
    if (dcClient) dcClient.login(CONFIG.DC_TOKEN);
})();
// --- 統一事件處理 ---
// 🛡️ [Flood Guard] 過期訊息檢測（啟動前的訊息一律丟棄）
function isStaleMessage(ctx) {
    const msgTime = ctx.messageTime;
    if (!msgTime) return false;
    return msgTime < BOOT_TIME;
}

// 📦 [Titan Queue] 全域 buffer 實例
const titanQueue = new MessageBuffer({
    debounceMs: 1500,
    onFlush: async (ctx, mergedText, hasMedia) => {
        await _handleUnifiedMessageCore(ctx, mergedText, hasMedia);
    }
});

async function handleUnifiedMessage(ctx) {
    // 🛡️ [Flood Guard] 第一層防線：丟棄啟動前的離線堆積訊息
    if (isStaleMessage(ctx)) {
        const ageSec = ((Date.now() - ctx.messageTime) / 1000).toFixed(0);
        console.log(`⏭️ [FloodGuard] 丟棄過期訊息 (${ctx.platform}, age: ${ageSec}s)`);
        return;
    }

    // 快速判斷是否有附件（同步檢查，不用 await）
    let hasMedia = false;
    if (ctx.platform === 'telegram') {
        const msg = ctx.event.message || ctx.event.msg;
        hasMedia = !!(msg && (msg.photo || msg.document));
    } else if (ctx.platform === 'discord') {
        hasMedia = !!(ctx.event.attachments && ctx.event.attachments.size > 0);
    }

    if (!ctx.text && !hasMedia) return;

    // 推入 Titan Queue：有附件跳過 debounce，純文字走 1.5s 合併
    titanQueue.push(ctx, hasMedia);
}

async function _handleUnifiedMessageCore(ctx, mergedText, hasMedia) {
    // 📦 [Titan Queue] 用合併後的文字覆蓋 ctx.text getter
    if (mergedText !== undefined) {
        Object.defineProperty(ctx, 'text', {
            get() { return mergedText; },
            configurable: true
        });
    }

    if (!ctx.text && !hasMedia) return; // 沒文字也沒附件就退出
    if (!ctx.isAdmin) return;

    // 📬 通知 Autonomy：老哥回訊息了（社交回應追蹤）
    if (ctx.text && autonomy.onAdminReply) autonomy.onAdminReply(ctx.text);
    if (await NodeRouter.handle(ctx, brain)) return;
    if (global.pendingPatch && ['ok', 'deploy', 'y', '部署'].includes(ctx.text.toLowerCase())) return executeDeploy(ctx);
    if (global.pendingPatch && ['no', 'drop', 'n', '丟棄'].includes(ctx.text.toLowerCase())) return executeDrop(ctx);
    if (global.pendingPatch) {
        const { name, description } = global.pendingPatch;
        await ctx.reply(`🔔 **待部署提案**\n目標：\`${name}\`\n內容：${description}\n請輸入 \`部署\` 或 \`丟棄\`。`);
    }

    if (ctx.text.startsWith('/patch') || ctx.text.includes('優化代碼')) {
        const req = ctx.text.replace('/patch', '').trim() || "優化代碼";
        await ctx.reply(`🧬 收到進化請求: ${req}`);
        const currentCode = Introspection.readSelf();
        const prompt = loadFeedbackPrompt('HOTFIX', { REQUEST: req, SOURCE_CODE: currentCode.slice(0, 15000) }) || `熱修復：${req}\n源碼前15000字\n輸出 JSON Array`;
        const raw = await brain.sendMessage(prompt);
        const patches = ResponseParser.extractJson(raw);
        if (patches.length > 0) {
            const patch = patches[0];
            const targetName = patch.file === 'skills.js' ? 'skills.js' : 'index.js';
            const targetPath = targetName === 'skills.js' ? path.join(process.cwd(), 'skills.js') : __filename;
            const testFile = PatchManager.createTestClone(targetPath, patches);
            let isVerified = false;
            if (targetName === 'skills.js') { try { require(path.resolve(testFile)); isVerified = true; } catch (e) { console.error(e); } }
            else { isVerified = PatchManager.verify(testFile); }
            if (isVerified) {
                global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
                await ctx.reply(`💡 提案就緒 (目標: ${targetName})。`, { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } });
                await ctx.sendDocument(testFile);
            }
        }
        return;
    }

    // [Round 1: 接收指令]
    await ctx.sendTyping();
    try {
        let finalInput = ctx.text;
        let tainted = false; // 🛡️ 汙染追蹤：是否包含外部不可信內容

        // 📎 Reply 上下文注入：如果使用者引用了一則訊息，把被引用的內容加入 prompt
        const replyCtx = ctx.replyText;
        if (replyCtx) {
            finalInput = loadPrompt('reply-context.md', {
                REPLY_TEXT: replyCtx.substring(0, 2000),
                USER_TEXT: ctx.text
            }) || `[引用] ${replyCtx.substring(0, 2000)}\n[回覆] ${ctx.text}`;
            console.log(`📎 [Reply] 注入被引用訊息 (${replyCtx.length} chars)`);
        }
        // 👁️ 視覺/檔案處理檢查 [✨ New Vision Logic]
        const attachment = await ctx.getAttachment();
        if (attachment) {
            await ctx.reply("👁️ 正在透過 OpticNerve 分析檔案，請稍候...");
            const analysis = await OpticNerve.analyze(attachment.url, attachment.mimeType, modelRouter);
            finalInput = loadPrompt('vision-injection.md', {
                MIME_TYPE: attachment.mimeType,
                ANALYSIS: analysis,
                USER_TEXT: ctx.text || '(無文字)'
            }) || `[視覺分析] ${analysis}\n使用者：${ctx.text || '(無文字)'}`;

            console.log("👁️ [Vision] 分析報告已注入 Prompt");
        }

        if (!finalInput && !attachment) return;
        // 無內容則忽略

        // ✨ [v8.0 RAG] 記憶檢索與注入 (Silent Mode)
        try {
            const queryForMemory = ctx.text || "image context";
            const memories = await brain.recall(queryForMemory);
            if (memories.length > 0) {
                const memoryText = memories.map(m => `• ${m.text}`).join('\n');
                finalInput = loadPrompt('rag-injection.md', {
                    MEMORIES: memoryText,
                    USER_INPUT: finalInput
                }) || `[記憶] ${memoryText}\n[訊息] ${finalInput}`;
                console.log(`🧠 [RAG] 已注入 ${memories.length} 條記憶`);
            }
        } catch (e) { console.warn("記憶檢索失敗 (跳過):", e.message); }

        // 🔧 [v9.2] 關鍵字路由：自動注入匹配的低頻技能
        const matchedSkills = skills.skillLoader.matchByKeywords(finalInput);
        if (matchedSkills.length > 0) {
            for (const skillName of matchedSkills) {
                const content = skills.skillLoader.loadSkill(skillName);
                if (content) {
                    await brain.sendMessage(`[系統注入] 偵測到相關技能 ${skillName}，已自動載入:\n${content}`, true);
                    dbg('SkillRouter', `自動注入: ${skillName}`);
                }
            }
        }

        const raw = await brain.sendMessage(finalInput);
        dbg('Raw', raw);

        // ✨ [Consolidated] 共用三流解析
        const parsed = TriStreamParser.parse(raw);

        // 1. 記憶 (靜默)
        if (parsed.memory) {
            await brain.memorize(parsed.memory, { type: 'fact', timestamp: Date.now() });
        }

        // 2. 行動流：信任 TriStreamParser，不一致時自動修正
        let steps = parsed.actions;
        let chatPart = parsed.reply;  // 提前宣告，Coherence 修正可能更新它
        dbg('ActionFlow', `steps.length=${steps.length} hasStructuredTags=${parsed.hasStructuredTags} steps=${JSON.stringify(steps)}`);

        if (steps.length === 0 && parsed.hasStructuredTags) {
            // TriStreamParser 成功解析但 ACTION_PLAN 為空
            // 檢查 REPLY 是否暗示了要執行指令（不一致偵測）
            const shellPrefixes = ['ls', 'cd', 'cat', 'echo', 'pwd', 'mkdir', 'rm', 'cp', 'mv',
                'git', 'node', 'npm', 'python', 'pip', 'curl', 'wget', 'find', 'grep',
                'chmod', 'chown', 'tail', 'head', 'df', 'free', 'ps', 'kill', 'pkill',
                'whoami', 'uname', 'date', 'golem-check', 'lsof', 'top', 'which',
                'touch', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'docker', 'ffmpeg',
                'fastfetch', 'neofetch', 'htop', 'systemctl', 'journalctl'];
            const impliedCmds = [...(parsed.reply || '').matchAll(/`([^`]+)`/g)]
                .map(m => m[1].trim())
                .filter(cmd => {
                    if (cmd.length < 2 || cmd.length > 200) return false;
                    if (/^[\u4e00-\u9fff]/.test(cmd)) return false;
                    const base = cmd.split(/\s+/)[0].toLowerCase();
                    return shellPrefixes.includes(base);
                });

            if (impliedCmds.length > 0) {
                dbg('Coherence', `偵測到 REPLY/ACTION 不一致: REPLY 提到 [${impliedCmds.join(', ')}] 但 ACTION_PLAN 為空`);
                await ctx.reply("⚠️ 偵測到回應格式異常（行動計劃為空但回覆中提到指令），正在自我修正...");
                await ctx.sendTyping();

                // 自動重試：要求 Gemini 修正格式
                const impliedCmdsStr = impliedCmds.map(c => '`' + c + '`').join(', ');
                const correctionPrompt = loadFeedbackPrompt('COHERENCE_CORRECTION', {
                    IMPLIED_CMDS: impliedCmdsStr,
                    FIRST_CMD: impliedCmds[0]
                }) || `[Format Correction] 把 ${impliedCmdsStr} 放進 ACTION_PLAN JSON Array。`;

                try {
                    const retryRaw = await brain.sendMessage(correctionPrompt);
                    dbg('Retry', retryRaw.substring(0, 400));
                    const retryParsed = TriStreamParser.parse(retryRaw);

                    if (retryParsed.actions.length > 0) {
                        console.log(`✅ [Coherence] 自我修正成功，取得 ${retryParsed.actions.length} 個行動`);
                        steps = retryParsed.actions;
                        // 如果重試有新的 reply，用它取代
                        if (retryParsed.reply) {
                            chatPart = retryParsed.reply;
                        }
                    } else {
                        console.warn("⚠️ [Coherence] 自我修正失敗，ACTION_PLAN 仍為空");
                        await ctx.reply(`⚠️ 自我修正未成功。如果你需要我執行指令，可以直接說「執行 ${impliedCmds[0]}」。`);
                    }
                } catch (retryErr) {
                    console.error("❌ [Coherence] 重試失敗:", retryErr.message);
                    await ctx.reply("❌ 自我修正時發生錯誤，請重新下達指令。");
                }
            }
        } else if (steps.length === 0 && !parsed.hasStructuredTags) {
            // 完全沒有三流標籤 — 舊版 fallback（僅此情況使用）
            steps = ResponseParser.extractJson(raw);
            if (steps.length > 0) dbg('Fallback', `No tri-stream tags, extractJson got ${steps.length} cmds`);
        }

        // 3. 回覆
        if (chatPart) await ctx.reply(chatPart);

        if (steps.length > 0) {
            // [Action: 汙染感知執行]
            const observation = await controller.runSequence(ctx, steps, 0, tainted);
            // [Round 2: 感知回饋 (Observation Loop)]
            if (observation) {
                await ctx.sendTyping();
                const feedbackPrompt = loadFeedbackPrompt('ROUND2_FEEDBACK', { OBSERVATION: observation })
                    || `[Observation Report]\n${observation}\nReply in Traditional Chinese.`;
                const finalResponse = await brain.sendMessage(feedbackPrompt);
                const r2 = TriStreamParser.parse(finalResponse);
                if (r2.memory) await brain.memorize(r2.memory, { type: 'fact', timestamp: Date.now() });
                const r2Reply = r2.reply || finalResponse;

                // Round 2 action 解析：允許新指令，阻止重複（防迴圈）
                const r2Steps = r2.actions || [];
                const r1Cmds = new Set(steps.map(s => s.cmd));
                const newR2Steps = r2Steps.filter(s => s && s.cmd && !r1Cmds.has(s.cmd));

                if (newR2Steps.length > 0) {
                    dbg('Round2', `New actions: ${JSON.stringify(newR2Steps)} (R1 had: ${JSON.stringify([...r1Cmds])})`);
                    await ctx.reply(r2Reply);
                    // 執行 Round 2 的新指令
                    const r2Observation = await controller.runSequence(ctx, newR2Steps, 0, tainted);
                    // Round 3: 只回覆，絕不再解析 action（硬上限 2 輪）
                    if (r2Observation) {
                        await ctx.sendTyping();
                        const r3Prompt = loadFeedbackPrompt('ROUND3_FINAL', { OBSERVATION: r2Observation }) || `[Final Report]\n${r2Observation}\nSummarize in Traditional Chinese.`;
                        const r3Response = await brain.sendMessage(r3Prompt);
                        const r3 = TriStreamParser.parse(r3Response);
                        if (r3.memory) await brain.memorize(r3.memory, { type: 'fact', timestamp: Date.now() });
                        dbg('Round3', `Final reply: ${(r3.reply || r3Response).substring(0, 80)}`);
                        await ctx.reply(r3.reply || r3Response);
                    }
                } else {
                    if (r2Steps.length > 0) {
                        dbg('Round2', `Blocked duplicate actions: ${JSON.stringify(r2Steps.map(s=>s.cmd))}`);
                    } else {
                        dbg('Round2', `Reply only: ${r2Reply.substring(0, 80)}`);
                    }
                    await ctx.reply(r2Reply);
                }
            }
        } else if (!chatPart) {
            // 如果既沒有 Action 也沒有 chatPart (極端狀況)，回傳原始訊息避免空窗
            await ctx.reply(raw);
        }
    } catch (e) { console.error(e); await ctx.reply(`❌ 錯誤: ${e.message}`); }

    // === 閉環：對話摘要寫入 journal，讓 Autonomy 感知互動 ===
    try {
        if (ctx.isAdmin && ctx.text && autonomy) {
            autonomy.appendJournal({
                action: 'conversation',
                preview: ctx.text.substring(0, 80)
            });
        }
    } catch (_) { /* 靜默失敗 */ }
}

// --- 統一 Callback 處理 ---
async function handleUnifiedCallback(ctx, actionData) {
    if (!ctx.isAdmin) return;
    if (actionData === 'PATCH_DEPLOY') return executeDeploy(ctx);
    if (actionData === 'PATCH_DROP') return executeDrop(ctx);

    // OTA 按鈕處理
    if (actionData === 'SYSTEM_FORCE_UPDATE') {
        try {
            if (ctx.platform === 'telegram') await ctx.instance.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ctx.chatId, message_id: ctx.event.message.message_id });
            else await ctx.event.update({ components: [] });
        } catch (e) { }
        return SystemUpgrader.performUpdate(ctx);
    }
    if (actionData === 'SYSTEM_UPDATE_CANCEL') return ctx.reply("已取消更新操作。");
    if (actionData.includes(':')) {
        const [action, taskId] = actionData.split(':');
        const task = pendingTasks.get(taskId);
        try {
            if (ctx.platform === 'telegram') await ctx.instance.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ctx.chatId, message_id: ctx.event.message.message_id });
            else await ctx.event.update({ components: [] });
        } catch (e) { }
        if (!task) return ctx.reply('⚠️ 任務已失效');
        if (action === 'DENY') {
            pendingTasks.delete(taskId);
            await ctx.reply('🛡️ 操作駁回');
        } else if (action === 'APPROVE') {
            const { steps, nextIndex, tainted } = task;
            pendingTasks.delete(taskId);
            await ctx.reply("✅ 授權通過，執行中...");
            await ctx.sendTyping();

            // 先執行被批准的那一步（跳過 security check）
            const approvedStep = steps[nextIndex];
            let approvedResult = '';
            try {
                if (approvedStep.cmd.startsWith('golem-skill')) {
                    const parts = approvedStep.cmd.split(/\s+/);
                    const subCmd = parts[1];
                    if (subCmd === 'list') {
                        approvedResult = `📦 [技能目錄]\n${skills.skillLoader.listSkills()}`;
                    } else if (subCmd === 'load' && parts[2]) {
                        const content = skills.skillLoader.loadSkill(parts[2]);
                        if (content) {
                            await brain.sendMessage(`[系統注入] 已載入技能 ${parts[2]}:\n${content}`, true);
                            approvedResult = `✅ 技能 ${parts[2]} 已載入`;
                        } else {
                            approvedResult = `❌ 找不到技能: ${parts[2]}`;
                        }
                    } else if (subCmd === 'reload') {
                        skills.skillLoader.reload();
                        approvedResult = '✅ 技能索引已重新掃描';
                    }
                } else if (approvedStep.cmd.startsWith('golem-check')) {
                    const toolName = approvedStep.cmd.split(' ')[1];
                    approvedResult = toolName ? `🔍 [ToolCheck] ${ToolScanner.check(toolName)}` : '⚠️ [ToolCheck] 缺少參數';
                } else {
                    if (!controller.internalExecutor) controller.internalExecutor = new Executor();
                    const output = await controller.internalExecutor.run(approvedStep.cmd);
                    approvedResult = `[Approved Step Success] cmd: ${approvedStep.cmd}\nResult/Output:\n${output.trim() || "(No stdout)"}`;
                }
            } catch (err) {
                approvedResult = `[Approved Step Failed] cmd: ${approvedStep.cmd}\nError:\n${err.message}`;
            }

            // 繼續執行剩餘步驟（從 nextIndex+1 開始，正常 security check）
            const remainingResult = await controller.runSequence(ctx, steps, nextIndex + 1, tainted || false);
            const observation = [approvedResult, remainingResult].filter(Boolean).join('\n\n----------------\n\n');

            if (observation) {
                const feedbackPrompt = loadFeedbackPrompt('APPROVED_FEEDBACK', { OBSERVATION: observation }) || `[Approved]\n${observation}\nReport in Traditional Chinese.`;
                const finalResponse = await brain.sendMessage(feedbackPrompt);
                // Round 2 只取回覆，不再解析 action（防止迴圈）
                const r2 = TriStreamParser.parse(finalResponse);
                if (r2.memory) await brain.memorize(r2.memory, { type: 'fact', timestamp: Date.now() });
                const r2Reply = r2.reply || finalResponse;
                dbg('Round2-CB', `Reply only: ${r2Reply.substring(0, 80)}`);
                await ctx.reply(r2Reply);
            }
        }
    }
}

async function executeDeploy(ctx) {
    if (!global.pendingPatch) return;
    try {
        const { path: patchPath, target: targetPath, name: targetName } = global.pendingPatch;
        fs.copyFileSync(targetPath, `${targetName}.bak-${Date.now()}`);
        fs.writeFileSync(targetPath, fs.readFileSync(patchPath));
        fs.unlinkSync(patchPath);
        const patchDesc = global.pendingPatch.description || '(no description)';
        global.pendingPatch = null;
        memory.recordSuccess();
        autonomy.appendJournal({ action: 'self_reflection_feedback', outcome: 'deployed', target: targetName, description: patchDesc });
        await ctx.reply(`🚀 ${targetName} 升級成功！正在重啟...`);
        const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore' });
        subprocess.unref();
        process.exit(0);
    } catch (e) { await ctx.reply(`❌ 部署失敗: ${e.message}`); }
}

async function executeDrop(ctx) {
    if (!global.pendingPatch) return;
    try { fs.unlinkSync(global.pendingPatch.path); } catch (e) { }
    const patchDesc = global.pendingPatch ? global.pendingPatch.description || '(no description)' : '?';
    global.pendingPatch = null;
    memory.recordRejection();
    autonomy.appendJournal({ action: 'self_reflection_feedback', outcome: 'dropped', description: patchDesc });
    await ctx.reply("🗑️ 提案已丟棄");
}

if (tgBot) {
    tgBot.on('message', (ctx) => handleUnifiedMessage(new UniversalContext('telegram', ctx, tgBot)));
    tgBot.on('callback_query:data', (ctx) => {
        handleUnifiedCallback(new UniversalContext('telegram', ctx, tgBot), ctx.callbackQuery.data);
        ctx.answerCallbackQuery();
    });
    tgBot.catch((err) => console.error(`⚠️ [TG] ${err.message}`));
    tgBot.start();
}
if (dcClient) {
    dcClient.on('messageCreate', (msg) => { if (!msg.author.bot) handleUnifiedMessage(new UniversalContext('discord', msg, dcClient)); });
    dcClient.on('interactionCreate', (interaction) => { if (interaction.isButton()) handleUnifiedCallback(new UniversalContext('discord', interaction, dcClient), interaction.customId); });
}

// ============================================================
// 🛡️ 全域異常守護 — 防止 crash 退出
// ============================================================
// crash_guard v2: EPIPE/pipe 錯誤最先擋、reentry guard、journal size guard
const _crashGuardSeen = new Map();
let _crashGuardBusy = false;
process.on('uncaughtException', (err) => {
    const msg = err.message || String(err);
    // 1) pipe 錯誤最先擋 — 在任何 I/O（含 console.error）之前 return
    if (msg.includes('EPIPE') || msg.includes('ECONNRESET') || msg.includes('write after end')) return;
    // 2) reentry guard — 防止 handler 內的 I/O 再觸發異常
    if (_crashGuardBusy) return;
    _crashGuardBusy = true;
    try {
        console.error('🛡️ [Guard] uncaughtException:', msg);
        // 3) 節流：同一 error message 60 秒內只寫一次
        const now = Date.now();
        if (_crashGuardSeen.has(msg) && now - _crashGuardSeen.get(msg) < 60000) return;
        _crashGuardSeen.set(msg, now);
        if (_crashGuardSeen.size > 50) {
            for (const [k, t] of _crashGuardSeen) { if (now - t > 60000) _crashGuardSeen.delete(k); }
        }
        // 4) journal size guard — 超過 1MB 不寫（防爆）
        const jp = require('path').join(process.cwd(), 'memory', 'journal.jsonl');
        try {
            const stat = require('fs').statSync(jp);
            if (stat.size > 1 * 1024 * 1024) return; // 1MB 上限
        } catch (_) {}
        require('fs').appendFileSync(jp, JSON.stringify({
            ts: new Date().toISOString(),
            action: 'crash_guard',
            error: msg,
            stack: (err.stack || '').split('\n').slice(0, 3).join(' | ')
        }) + '\n');
    } catch (_) {
    } finally {
        _crashGuardBusy = false;
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('🛡️ [Guard] unhandledRejection 已攔截:', reason);
});
