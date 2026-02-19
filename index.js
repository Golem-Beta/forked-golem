/**
 * 🦞 Forked-Golem v9.2.0 (Direct-Link Edition)
 * ---------------------------------------------------
 * 基於 Arvincreator/project-golem 分支，重構為 API 直連 + 輕量 headless 架構
 * 目標硬體：ThinkPad X200, 4-8GB RAM, Arch Linux headless (TTY + SSH)
 *
 * 架構：[Universal Context] -> [Node.js 反射層 + 雙模記憶引擎] <==> [Gemini API 直連]
 * 特性：
 *   1. 🐍 Hydra Link — Telegram (grammy) + Discord 雙平台
 *   2. 🧠 Gemini API Direct — 移除 Puppeteer/CDP，直連 @google/generative-ai SDK
 *   3. 🗝️ KeyChain v2 — 多 Key 輪替 + 429 智慧冷卻 + 指數退避
 *   4. ⚓ Tri-Stream Protocol — Memory/Action/Reply 三流並行
 *   5. 🔮 OpticNerve — Gemini Flash 視覺解析（圖片/文件）
 *   6. 🌗 Dual-Engine Memory — Native FS / QMD 雙模記憶核心
 *   7. 🔍 Auto-Discovery — 環境工具自動探測
 *   8. 🛡️ SecurityManager v2 — 白名單/黑名單 + Taint 偵測 + Flood Guard
 *   9. 📦 Titan Queue — 訊息防抖合併 + Per-chat 序列化（v9.1）
 *  10. 📟 Dashboard — blessed 戰術控制台（支援 detach/reattach）
 */

// ==========================================
// 📟 儀表板外掛 (Dashboard Switch)
// 用法：npm start dashboard (開啟)
//       npm start           (關閉)
// ==========================================
if (process.argv.includes('dashboard')) {
    try {
        require('./dashboard');
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
const skills = require('./skills');

// --- ⚙️ 全域配置 ---
const cleanEnv = (str, allowSpaces = false) => {
    if (!str) return "";
    // 只保留可列印的 ASCII 字元 (32-126)
    let cleaned = str.replace(/[^\x20-\x7E]/g, "");
    if (!allowSpaces) cleaned = cleaned.replace(/\s/g, "");
    return cleaned.trim();
};

const isPlaceholder = (str) => {
    if (!str) return true;
    return /你的|這裡|YOUR_|TOKEN/i.test(str) || str.length < 10;
};

const CONFIG = {
    TG_TOKEN: cleanEnv(process.env.TELEGRAM_TOKEN),
    DC_TOKEN: cleanEnv(process.env.DISCORD_TOKEN),
    USER_DATA_DIR: cleanEnv(process.env.USER_DATA_DIR || './golem_memory', true),
    API_KEYS: (process.env.GEMINI_API_KEYS || '').split(',').map(k => cleanEnv(k)).filter(k => k),
    SPLIT_TOKEN: '---GOLEM_ACTION_PLAN---',
    ADMIN_ID: cleanEnv(process.env.ADMIN_ID),
    DISCORD_ADMIN_ID: cleanEnv(process.env.DISCORD_ADMIN_ID),
    GITHUB_TOKEN: cleanEnv(process.env.GITHUB_TOKEN || ''),
    ADMIN_IDS: [process.env.ADMIN_ID, process.env.DISCORD_ADMIN_ID]
        .map(k => cleanEnv(k))
        .filter(k => k),
    // OTA 設定
    GITHUB_REPO: cleanEnv(process.env.GITHUB_REPO || 'https://raw.githubusercontent.com/Arvincreator/project-golem/main/', true),
    QMD_PATH: cleanEnv(process.env.GOLEM_QMD_PATH || 'qmd', true),
    // ✨ [贊助 設定] 您的 BuyMeACoffee 連結
    DONATE_URL: 'https://buymeacoffee.com/arvincreator'
};

// 驗證關鍵 Token
if (isPlaceholder(CONFIG.TG_TOKEN)) { console.warn("⚠️ [Config] TELEGRAM_TOKEN 看起來是預設值或無效，TG Bot 將不啟動。"); CONFIG.TG_TOKEN = ""; }
if (isPlaceholder(CONFIG.DC_TOKEN)) { console.warn("⚠️ [Config] DISCORD_TOKEN 看起來是預設值或無效，Discord Bot 將不啟動。"); CONFIG.DC_TOKEN = ""; }
if (CONFIG.API_KEYS.some(isPlaceholder)) {
    console.warn("⚠️ [Config] 偵測到部分 API_KEYS 為無效預設值，已自動過濾。");
    CONFIG.API_KEYS = CONFIG.API_KEYS.filter(k => !isPlaceholder(k));
}

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
// 👁️ OpticNerve (視神經 - Gemini 2.5 Flash Bridge)
// ============================================================
class OpticNerve {
    static async analyze(fileUrl, mimeType, apiKey) {
        console.log(`👁️ [OpticNerve] 正在透過 Gemini 2.5 Flash 分析檔案 (${mimeType})...`);
        try {
            // 1. 下載檔案為 Buffer
            const buffer = await new Promise((resolve, reject) => {
                https.get(fileUrl, (res) => {
                    const data = [];
                    res.on('data', (chunk) => data.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(data)));
                    res.on('error', reject);
                });
            });
            // 2. 呼叫 Gemini API (使用 2.5-flash)
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const prompt = mimeType.startsWith('image/')
                ? "請詳細描述這張圖片的視覺內容。如果包含文字或程式碼，請完整轉錄。如果是介面截圖，請描述UI元件。請忽略無關的背景雜訊。"
                : "請閱讀這份文件，並提供詳細的摘要、關鍵數據與核心內容。";

            const result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: mimeType
                    }
                }
            ]);

            const text = result.response.text();
            console.log("✅ [OpticNerve] 分析完成 (長度: " + text.length + ")");
            return text;
        } catch (e) {
            console.error("❌ [OpticNerve] 解析失敗:", e.message);
            return `(系統錯誤：視神經無法解析此檔案。原因：${e.message})`;
        }
    }
}

// ============================================================
// 🔌 Universal Context (通用語境層)
// ============================================================
class UniversalContext {
    constructor(platform, event, instance) {
        this.platform = platform; // 'telegram' | 'discord'
        this.event = event; // TG: msg/query, DC: message/interaction
        this.instance = instance; // TG: bot, DC: client
    }

    get userId() {
        if (this.platform === 'telegram') {
            const from = this.event.from || this.event.callbackQuery?.from;
            return String(from.id);
        }
        return this.event.user ? this.event.user.id : this.event.author.id;
    }

    get chatId() {
        if (this.platform === 'telegram') {
            return this.event.chat?.id || this.event.callbackQuery?.message?.chat?.id;
        }
        return this.event.channelId || this.event.channel.id;
    }

    get text() {
        // ✨ 優化：支援讀取圖片的 Caption (grammy: ctx.message)
        if (this.platform === 'telegram') {
            const msg = this.event.message || this.event.msg;
            return msg?.text || msg?.caption || "";
        }
        return this.event.content || "";
    }

    // 🛡️ [Flood Guard] 取得訊息時間戳 (毫秒)
    get messageTime() {
        if (this.platform === 'telegram' && this.event.message?.date) {
            return this.event.message.date * 1000; // TG 是秒，轉毫秒
        }
        if (this.platform === 'discord' && this.event.createdTimestamp) {
            return this.event.createdTimestamp;
        }
        return null;
    }

    // ✨ [New] 取得附件資訊 (回傳 { url, type } 或 null)
    async getAttachment() {
        if (this.platform === 'telegram') {
            const msg = this.event.message || this.event.msg;
            if (!msg) return null;
            let fileId = null;
            let mimeType = 'image/jpeg'; // 預設

            if (msg.photo) fileId = msg.photo[msg.photo.length - 1].file_id;
            else if (msg.document) {
                fileId = msg.document.file_id;
                mimeType = msg.document.mime_type;
            }

            if (fileId) {
                try {
                    const file = await this.instance.api.getFile(fileId);
                    return {
                        url: `https://api.telegram.org/file/bot${CONFIG.TG_TOKEN}/${file.file_path}`,
                        mimeType: mimeType
                    };
                } catch (e) { console.error("TG File Error:", e); }
            }
        } else {
            // Discord
            const attachment = this.event.attachments && this.event.attachments.first();
            if (attachment) {
                return {
                    url: attachment.url,
                    mimeType: attachment.contentType || 'application/octet-stream'
                };
            }
        }
        return null;
    }

    get isAdmin() {
        if (CONFIG.ADMIN_IDS.length === 0) return true;
        return CONFIG.ADMIN_IDS.includes(this.userId);
    }

    async reply(content, options = {}) {
        return await MessageManager.send(this, content, options);
    }

    async sendDocument(filePath) {
        try {
            if (this.platform === 'telegram') {
                await this.instance.api.sendDocument(this.chatId, new InputFile(filePath));
            } else {
                const channel = await this.instance.channels.fetch(this.chatId);
                await channel.send({ files: [filePath] });
            }
        } catch (e) {
            if (e.message.includes('Request entity too large')) {
                await this.reply(`⚠️ 檔案過大，無法上傳 (Discord 限制 25MB)。\n路徑：\`${filePath}\``);
            } else {
                console.error(`[Context] 傳送檔案失敗: ${e.message}`);
                await this.reply(`❌ 傳送失敗: ${e.message}`);
            }
        }
    }

    async sendTyping() {
        if (this.platform === 'telegram') {
            this.instance.api.sendChatAction(this.chatId, 'typing');
        } else {
            const channel = await this.instance.channels.fetch(this.chatId);
            await channel.sendTyping();
        }
    }
}

// ============================================================
// 📨 Message Manager (雙模版訊息切片器)
// ============================================================
class MessageManager {
    static async send(ctx, text, options = {}) {
        if (!text) return;
        const MAX_LENGTH = ctx.platform === 'telegram' ? 4000 : 1900;
        const chunks = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= MAX_LENGTH) {
                chunks.push(remaining);
                break;
            }
            let splitIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
            if (splitIndex === -1) splitIndex = MAX_LENGTH;
            chunks.push(remaining.substring(0, splitIndex));
            remaining = remaining.substring(splitIndex).trim();
        }

        for (const chunk of chunks) {
            try {
                if (ctx.platform === 'telegram') {
                    await ctx.instance.api.sendMessage(ctx.chatId, chunk, options);
                } else {
                    const channel = await ctx.instance.channels.fetch(ctx.chatId);
                    const dcOptions = { content: chunk };
                    if (options.reply_markup && options.reply_markup.inline_keyboard) {
                        const row = new ActionRowBuilder();
                        options.reply_markup.inline_keyboard[0].forEach(btn => {
                            row.addComponents(new ButtonBuilder().setCustomId(btn.callback_data).setLabel(btn.text).setStyle(ButtonStyle.Primary));
                        });
                        dcOptions.components = [row];
                    }
                    await channel.send(dcOptions);
                }
            } catch (e) { console.error(`[MessageManager] 發送失敗 (${ctx.platform}):`, e.message); }
        }
    }
}

// ============================================================
// 🧠 Experience Memory (經驗記憶體 - Legacy)
// ============================================================
class ExperienceMemory {
    constructor() {
        this.memoryFile = path.join(process.cwd(), 'golem_learning.json');
        this.data = this._load();
    }
    _load() {
        try { if (fs.existsSync(this.memoryFile)) return JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8')); } catch (e) { }
        return { lastProposalType: null, rejectedCount: 0, avoidList: [], nextWakeup: 0 };
    }
    save() { fs.writeFileSync(this.memoryFile, JSON.stringify(this.data, null, 2)); }
    recordProposal(type) { this.data.lastProposalType = type; this.save(); }
    recordRejection() {
        this.data.rejectedCount++;
        if (this.data.lastProposalType) {
            this.data.avoidList.push(this.data.lastProposalType);
            if (this.data.avoidList.length > 3) this.data.avoidList.shift();
        }
        this.save();
        return this.data.rejectedCount;
    }
    recordSuccess() { this.data.rejectedCount = 0; this.data.avoidList = []; this.save(); }
    getAdvice() {
        if (this.data.avoidList.length > 0) return `⚠️ 注意：最近被拒絕的提案：[${this.data.avoidList.join(', ')}]。請避開。`;
        return "";
    }
}
const memory = new ExperienceMemory();

// ============================================================
// 🪞 Introspection (內省模組)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class Introspection {
    static readSelf() {
        try {
            let main = fs.readFileSync(__filename, 'utf-8');
            main = main.replace(/TOKEN: .*,/, 'TOKEN: "HIDDEN",').replace(/API_KEYS: .*,/, 'API_KEYS: "HIDDEN",');
            let skills = "";
            try { skills = fs.readFileSync(path.join(process.cwd(), 'skills.js'), 'utf-8'); } catch (e) { }
            return `=== index.js ===\n${main}\n\n=== skills.js ===\n${skills}`;
        } catch (e) { return `無法讀取自身代碼: ${e.message}`; }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

// ============================================================
// 🩹 Patch Manager (神經補丁)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class PatchManager {
    static apply(originalCode, patch) {
        const protectedPattern = /\/\/ =+ \[KERNEL PROTECTED START\] =+([\s\S]*?)\/\/ =+ \[KERNEL PROTECTED END\] =+/g;
        let match;
        while ((match = protectedPattern.exec(originalCode)) !== null) {
            if (match[1].includes(patch.search)) throw new Error(`⛔ 權限拒絕：試圖修改系統核心禁區。`);
        }
        // 僅精確匹配，不做模糊替換 — LLM 產生的 patch 不精確就直接拒絕
        if (!originalCode.includes(patch.search)) {
            throw new Error(`❌ 精確匹配失敗：找不到目標代碼段落 (長度:${patch.search.length})。請確認 patch 內容與原始碼完全一致。`);
        }
        // 確認唯一性：同一段代碼只能出現一次
        const firstIdx = originalCode.indexOf(patch.search);
        const secondIdx = originalCode.indexOf(patch.search, firstIdx + 1);
        if (secondIdx !== -1) {
            throw new Error(`❌ 匹配不唯一：目標段落出現多次，無法安全替換。`);
        }
        return originalCode.replace(patch.search, patch.replace);
    }
    static createTestClone(originalPath, patchContent) {
        try {
            const originalCode = fs.readFileSync(originalPath, 'utf-8');
            let patchedCode = originalCode;
            const patches = Array.isArray(patchContent) ? patchContent : [patchContent];
            patches.forEach(p => { patchedCode = this.apply(patchedCode, p); });
            const ext = path.extname(originalPath);
            const name = path.basename(originalPath, ext);
            const testFile = `${name}.test${ext}`;
            fs.writeFileSync(testFile, patchedCode, 'utf-8');
            return testFile;
        } catch (e) { throw new Error(`補丁應用失敗: ${e.message}`); }
    }
    static verify(filePath) {
        try {
            execSync(`node -c "${filePath}"`);
            if (filePath.includes('index.test.js')) {
                execSync(`node "${filePath}"`, { env: { ...process.env, GOLEM_TEST_MODE: 'true' }, timeout: 5000, stdio: 'pipe' });
            }
            console.log(`✅ [PatchManager] ${filePath} 驗證通過`);
            return true;
        } catch (e) {
            console.error(`❌ [PatchManager] 驗證失敗: ${e.message}`);
            // 清理失敗的測試檔案，避免殘留
            try { fs.unlinkSync(filePath); console.log(`🗑️ [PatchManager] 已清理: ${filePath}`); } catch (_) {}
            return false;
        }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

// ============================================================
// 🛡️ Security Manager v2.0 (白名單 + 汙染追蹤)
// ============================================================
// ==================== [KERNEL PROTECTED START] ====================
class SecurityManager {
    constructor() {
        // ✅ 白名單：這些指令 base command 可以自動執行（不需人工審批）
        this.WHITELIST = [
            'ls', 'dir', 'pwd', 'date', 'echo', 'cat', 'grep', 'find',
            'whoami', 'tail', 'head', 'df', 'free', 'wc', 'sort', 'uniq',
            'uname', 'uptime', 'hostname', 'which', 'file', 'stat',
            'Get-ChildItem', 'Select-String',
            'golem-check',  // 虛擬指令，不走 exec
            'golem-skill',  // 虛擬指令，技能管理
            'git',          // git 操作 (status/log/diff/add/commit/push)
            'node', 'python', 'python3',  // 執行腳本
            'npm',          // npm 操作
            'mkdir', 'touch', 'cp',       // 建立/複製 (非破壞性)
            'fastfetch', 'neofetch', 'htop', 'lsof', 'top', 'ps',  // 系統資訊 (唯讀)
            'systemctl',  // systemd 查詢 (status/list 等)
            'journalctl', // 日誌查看
        ];

        // ⛔ 黑名單 pattern：無論如何都攔截
        this.BLOCK_PATTERNS = [
            /rm\s+-rf\s+\//, /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/,
            />\s*\/dev\/sd/, /:(){.*:|.*:&.*;:/, /mkfs/, /Format-Volume/,
            /dd\s+if=/, /chmod\s+[-]x\s+/,
            /curl[^|]*\|\s*(bash|sh|zsh)/, // curl pipe to shell
            /wget[^|]*\|\s*(bash|sh|zsh)/,
            /eval\s*\(/,                    // eval() injection
            /\bsudo\b/,                     // sudo 一律攔截
            /\bsu\s/,                       // su 切換用戶
        ];

        // 🔴 高風險 base command：需人工審批
        this.DANGER_COMMANDS = [
            'rm', 'mv', 'chmod', 'chown', 'reboot', 'shutdown',
            'kill', 'killall', 'pkill',
            'npm uninstall', 'Remove-Item', 'Stop-Computer',
            'dd', 'mkfs', 'fdisk', 'parted',
        ];

        // 🌐 curl/wget 白名單域名 (只有這些域名可以自動執行)
        this.ALLOWED_DOMAINS = [
            // 基礎安全域名
            'api.github.com', 'raw.githubusercontent.com',
            'registry.npmjs.org',
            // 未來可在此加入 moltbook:
            // 'www.moltbook.com',
        ];
    }

    /**
     * 評估指令風險
     * @param {string} cmd - Shell 指令
     * @param {boolean} tainted - 是否包含外部 (不可信) 內容的上下文
     * @returns {{ level: 'SAFE'|'WARNING'|'DANGER'|'BLOCKED', reason?: string }}
     */
    assess(cmd, tainted = false) {
        if (!cmd || typeof cmd !== 'string') return { level: 'BLOCKED', reason: '空指令' };

        const trimmed = cmd.trim();
        const baseCmd = trimmed.split(/\s+/)[0];

        // 1. 黑名單 pattern 一律攔截
        if (this.BLOCK_PATTERNS.some(regex => regex.test(trimmed))) {
            return { level: 'BLOCKED', reason: '危險指令 pattern' };
        }

        // 2. curl/wget 特殊處理：檢查域名白名單
        if (/^(curl|wget)\b/.test(baseCmd)) {
            return this._assessNetwork(trimmed, tainted);
        }

        // 3. 高風險指令一律需審批
        if (this.DANGER_COMMANDS.includes(baseCmd)) {
            return { level: 'DANGER', reason: `高風險操作: ${baseCmd}` };
        }

        // 4. 白名單內的指令
        if (this.WHITELIST.includes(baseCmd)) {
            // 即使在白名單內，如果上下文被汙染，降級為 WARNING
            if (tainted) {
                return { level: 'WARNING', reason: '指令安全但上下文含外部內容，需確認' };
            }
            return { level: 'SAFE' };
        }

        // 5. 不在白名單也不在黑名單 → 需審批
        return { level: 'WARNING', reason: `未知指令: ${baseCmd}` };
    }

    /**
     * 網路請求專用評估
     */
    _assessNetwork(cmd, tainted) {
        // 提取 URL
        const urlMatch = cmd.match(/https?:\/\/[^\s"']+/);
        if (!urlMatch) {
            return { level: 'WARNING', reason: 'curl/wget 未包含明確 URL' };
        }

        try {
            const url = new URL(urlMatch[0]);
            const domain = url.hostname;

            // 檢查域名白名單
            if (this.ALLOWED_DOMAINS.includes(domain)) {
                if (tainted) {
                    return { level: 'WARNING', reason: `域名 ${domain} 已授權，但上下文含外部內容` };
                }
                return { level: 'SAFE' };
            }

            // 不在白名單的域名一律需審批
            return { level: 'WARNING', reason: `網路請求目標未授權: ${domain}` };
        } catch (e) {
            return { level: 'WARNING', reason: 'URL 解析失敗' };
        }
    }

    /**
     * 新增允許的網路域名
     */
    addAllowedDomain(domain) {
        if (!this.ALLOWED_DOMAINS.includes(domain)) {
            this.ALLOWED_DOMAINS.push(domain);
            console.log(`🛡️ [Security] 已新增授權域名: ${domain}`);
        }
    }
}
// ==================== [KERNEL PROTECTED END] ====================

// ============================================================
// 🔍 ToolScanner (工具自動探測器)
// ============================================================
class ToolScanner {
    static check(toolName) {
        const isWin = os.platform() === 'win32';
        const checkCmd = isWin ? `where ${toolName}` : `which ${toolName}`;
        try {
            const path = execSync(checkCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0];
            return `✅ **已安裝**: \`${toolName}\`\n路徑: ${path}`;
        } catch (e) {
            return `❌ **未安裝**: \`${toolName}\`\n(系統找不到此指令)`;
        }
    }
}

// ============================================================
// 📖 Help Manager (動態說明書)
// ============================================================
class HelpManager {
    static getManual() {
        const source = Introspection.readSelf();
        const routerPattern = /text\.(?:startsWith|match)\(['"]\/?([a-zA-Z0-9_|]+)['"]\)/g;
        const foundCmds = new Set(['help', 'callme', 'patch', 'update', 'donate']);
        let match;
        while ((match = routerPattern.exec(source)) !== null) {
            foundCmds.add(match[1].replace(/\|/g, '/').replace(/[\^\(\)]/g, ''));
        }
        let skillList = "基礎系統操作";
        try { skillList = Object.keys(skills).filter(k => k !== 'persona' && k !== 'getSystemPrompt').join(', '); } catch (e) { }

        return `
🤖 **Golem v8.5 (Neuro-Link)**
---------------------------
⚡ **Node.js**: Reflex Layer + Action Executor
🧠 **Web Gemini**: Infinite Context Brain
🌗 **Dual-Memory**: ${cleanEnv(process.env.GOLEM_MEMORY_MODE || 'browser')} mode
⚓ **Sync Mode**: Tri-Stream Protocol (Memory/Action/Reply)
🔍 **Auto-Discovery**: Active
🚑 **DOM Doctor**: v2.0 (Self-Healing)
👁️ **OpticNerve**: Vision Enabled
🔌 **Neuro-Link**: CDP Network Interception Active
📡 **連線狀態**: TG(${CONFIG.TG_TOKEN ? '✅' : '⚪'}) / DC(${CONFIG.DC_TOKEN ? '✅' : '⚪'})

🛠️ **可用指令:**
${Array.from(foundCmds).map(c => `• \`/${c}\``).join('\n')}
🧠 **技能模組:** ${skillList}

☕ **支持開發者:**
${CONFIG.DONATE_URL}
`;
    }
}

// ============================================================
// 🗝️ KeyChain (API Key 輪替 + 節流)
// ============================================================
class KeyChain {
    constructor() {
        this.keys = CONFIG.API_KEYS;
        this.currentIndex = 0;
        // 🛡️ [Flood Guard] API 節流
        this._lastCallTime = 0;
        this._minInterval = API_MIN_INTERVAL_MS || 2500;
        this._throttleQueue = Promise.resolve();
        // 🧊 [Smart Cooldown] 每把 key 的冷卻時間戳
        this._cooldownUntil = new Map(); // key -> timestamp
        console.log(`🗝️ [KeyChain] 已載入 ${this.keys.length} 把 API Key (節流: ${this._minInterval}ms)。`);
    }
    // 標記某把 key 進入冷卻 (預設 15 分鐘)
    markCooldown(key, durationMs = 15 * 60 * 1000) {
        const until = Date.now() + durationMs;
        this._cooldownUntil.set(key, until);
        const idx = this.keys.indexOf(key);
        console.log(`🧊 [KeyChain] Key #${idx} 進入冷卻，${Math.round(durationMs / 1000)}s 後解除`);
    }
    // 檢查 key 是否在冷卻中
    _isCooling(key) {
        const until = this._cooldownUntil.get(key);
        if (!until) return false;
        if (Date.now() >= until) {
            this._cooldownUntil.delete(key);
            return false;
        }
        return true;
    }
    // 同步版：跳過冷卻中的 key
    getKeySync() {
        if (this.keys.length === 0) return null;
        const startIdx = this.currentIndex;
        for (let i = 0; i < this.keys.length; i++) {
            const idx = (startIdx + i) % this.keys.length;
            const key = this.keys[idx];
            if (!this._isCooling(key)) {
                this.currentIndex = (idx + 1) % this.keys.length;
                return key;
            }
        }
        // 全部冷卻中：回傳最快解除的那把，並清除其冷卻
        console.warn('⚠️ [KeyChain] 所有 Key 都在冷卻中，強制使用最早解除的');
        let earliest = null, earliestTime = Infinity;
        for (const [k, t] of this._cooldownUntil) {
            if (t < earliestTime) { earliest = k; earliestTime = t; }
        }
        if (earliest) this._cooldownUntil.delete(earliest);
        return earliest || this.keys[0];
    }
    // 非同步版：帶節流，確保 API 呼叫之間有最小間隔
    async getKey() {
        return new Promise((resolve) => {
            this._throttleQueue = this._throttleQueue.then(async () => {
                const now = Date.now();
                const elapsed = now - this._lastCallTime;
                if (elapsed < this._minInterval) {
                    const waitMs = this._minInterval - elapsed;
                    dbg('KeyChain', `節流等待 ${waitMs}ms`);
                    await new Promise(r => setTimeout(r, waitMs));
                }
                this._lastCallTime = Date.now();
                resolve(this.getKeySync());
            });
        });
    }
    // 取得狀態摘要
    getStatus() {
        const cooling = [];
        for (const [k, t] of this._cooldownUntil) {
            const idx = this.keys.indexOf(k);
            const remain = Math.max(0, Math.round((t - Date.now()) / 1000));
            if (remain > 0) cooling.push(`#${idx}(${remain}s)`);
        }
        return cooling.length > 0 ? `冷卻中: ${cooling.join(', ')}` : '全部可用';
    }
}

// [已移除] DOMDoctor — API 直連模式不需要 DOM 自癒
// [已移除] BrowserMemoryDriver — API 直連模式不需要瀏覽器記憶驅動

// ============================================================
// 🧠 Memory Drivers (雙模記憶驅動 - Strategy Pattern)
// ============================================================

// 2. 系統驅動 (Qmd Mode: 高效能、混合搜尋)
class SystemQmdDriver {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        this.qmdCmd = 'qmd'; // 預設
    }

    async init() {
        console.log("🔍 [Memory:Qmd] 啟動引擎探測...");
        try {
            const checkCmd = (c) => {
                try {
                    const findCmd = os.platform() === 'win32' ? `where ${c}` : `command -v ${c}`;
                    execSync(findCmd, { stdio: 'ignore', env: process.env });
                    return true;
                } catch (e) { return false; }
            };

            // 1. 優先查看是否有手動指定路徑
            if (CONFIG.QMD_PATH !== 'qmd' && fs.existsSync(CONFIG.QMD_PATH)) {
                this.qmdCmd = `"${CONFIG.QMD_PATH}"`;
            }
            // 2. 嘗試直接執行 qmd
            else if (checkCmd('qmd')) {
                this.qmdCmd = 'qmd';
            }
            // 3. 嘗試常見的絕對路徑
            else {
                const homeQmd = path.join(os.homedir(), '.bun', 'bin', 'qmd');
                if (fs.existsSync(homeQmd)) {
                    this.qmdCmd = `"${homeQmd}"`;
                } else if (os.platform() !== 'win32') {
                    // 4. 最後一搏：嘗試透過 bash 登入檔尋找
                    try {
                        const bashFound = execSync('bash -lc "which qmd"', { encoding: 'utf8', env: process.env }).trim();
                        if (bashFound) this.qmdCmd = `"${bashFound}"`;
                        else throw new Error();
                    } catch (e) { throw new Error("QMD_NOT_FOUND"); }
                } else {
                    throw new Error("QMD_NOT_FOUND");
                }
            }

            console.log(`🧠 [Memory:Qmd] 引擎連線成功: ${this.qmdCmd}`);

            // 嘗試初始化 Collection
            try {
                const target = path.join(this.baseDir, '*.md');
                execSync(`${this.qmdCmd} collection add "${target}" --name golem-core`, {
                    stdio: 'ignore', env: process.env, shell: true
                });
            } catch (e) { }
        } catch (e) {
            console.error(`❌ [Memory:Qmd] 找不到 qmd 指令。如果您已安裝，請在 .env 加入 GOLEM_QMD_PATH=/path/to/qmd`);
            throw new Error("QMD_MISSING");
        }
    }

    async recall(query) {
        return new Promise((resolve) => {
            const safeQuery = query.replace(/"/g, '\\"');
            const cmd = `${this.qmdCmd} search golem-core "${safeQuery}" --hybrid --limit 3`;

            exec(cmd, (err, stdout) => {
                if (err) { resolve([]); return; }
                const result = stdout.trim();
                if (result) {
                    resolve([{ text: result, score: 0.95, metadata: { source: 'qmd' } }]);
                } else { resolve([]); }
            });
        });
    }

    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        const fileContent = `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`;
        fs.writeFileSync(filepath, fileContent, 'utf8');

        exec(`${this.qmdCmd} embed golem-core "${filepath}"`, (err) => {
            if (err) console.error("⚠️ [Memory:Qmd] 索引更新失敗:", err.message);
            else console.log(`🧠 [Memory:Qmd] 已寫入知識庫: ${filename}`);
        });
    }
}

// 3. 系統原生驅動 (Native FS Mode: 純 Node.js，不依賴外部指令，適合 Windows)
class SystemNativeDriver {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    }

    async init() {
        console.log("🧠 [Memory:Native] 系統原生核心已啟動 (Pure Node.js Mode)");
    }

    async recall(query) {
        try {
            const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.md'));
            const results = [];
            for (const file of files) {
                const content = fs.readFileSync(path.join(this.baseDir, file), 'utf8');
                // 簡單關鍵字匹配評分
                const keywords = query.toLowerCase().split(/\s+/);
                let score = 0;
                keywords.forEach(k => { if (content.toLowerCase().includes(k)) score += 1; });

                if (score > 0) {
                    results.push({
                        text: content.replace(/---[\s\S]*?---/, '').trim(),
                        score: score / keywords.length,
                        metadata: { source: file }
                    });
                }
            }
            return results.sort((a, b) => b.score - a.score).slice(0, 3);
        } catch (e) { return []; }
    }

    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        const fileContent = `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`;
        fs.writeFileSync(filepath, fileContent, 'utf8');
        console.log(`🧠 [Memory:Native] 已寫入知識庫: ${filename}`);
    }
}

// ============================================================
// 📦 Titan Queue (訊息防抖 + 序列化)
// ============================================================
class MessageBuffer {
    constructor(options = {}) {
        this.DEBOUNCE_MS = options.debounceMs || 1500;  // 1.5 秒合併窗口
        this.buffers = new Map();  // chatId → { texts[], latestCtx, timer, isProcessing, queue[] }
        this.processCallback = options.onFlush || (() => {});
    }

    /**
     * 推入一條新訊息
     * @param {UniversalContext} ctx
     * @param {boolean} hasMedia - 是否有附件（圖片/文件），有的話跳過 debounce
     */
    push(ctx, hasMedia = false) {
        const chatId = ctx.chatId;
        const text = ctx.text || '';

        if (!this.buffers.has(chatId)) {
            this.buffers.set(chatId, {
                texts: [],
                latestCtx: null,
                timer: null,
                isProcessing: false,
                queue: []
            });
        }

        const buf = this.buffers.get(chatId);

        // 有附件 → 先 flush 已緩存的純文字，再立即排入帶附件的訊息
        if (hasMedia) {
            if (buf.texts.length > 0) {
                this._enqueue(chatId, buf.texts.join('\n'), buf.latestCtx, false);
                buf.texts = [];
                buf.latestCtx = null;
                if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
            }
            this._enqueue(chatId, text, ctx, true);
            return;
        }

        // 純文字 → 加入 buffer，重置 debounce 計時器
        if (text.trim()) {
            buf.texts.push(text);
        }
        buf.latestCtx = ctx;

        if (buf.timer) clearTimeout(buf.timer);
        buf.timer = setTimeout(() => this._flush(chatId), this.DEBOUNCE_MS);
    }

    _flush(chatId) {
        const buf = this.buffers.get(chatId);
        if (!buf) return;
        buf.timer = null;

        if (buf.texts.length > 0 && buf.latestCtx) {
            const merged = buf.texts.join('\n');
            if (buf.texts.length > 1) {
                console.log(`📦 [TitanQ] 合併 ${buf.texts.length} 條碎片訊息 → ${merged.length} chars (chat: ${chatId})`);
            }
            this._enqueue(chatId, merged, buf.latestCtx, false);
            buf.texts = [];
            buf.latestCtx = null;
        }
    }

    _enqueue(chatId, mergedText, ctx, hasMedia) {
        const buf = this.buffers.get(chatId);
        buf.queue.push({ text: mergedText, ctx, hasMedia });
        this._processNext(chatId);
    }

    async _processNext(chatId) {
        const buf = this.buffers.get(chatId);
        if (!buf || buf.isProcessing || buf.queue.length === 0) return;

        buf.isProcessing = true;
        const item = buf.queue.shift();

        try {
            await this.processCallback(item.ctx, item.text, item.hasMedia);
        } catch (e) {
            console.error(`❌ [TitanQ] 處理失敗 (chat: ${chatId}): ${e.message}`);
        } finally {
            buf.isProcessing = false;

            // 🔧 [v9.2.0] 修正競爭條件：
            // 如果 texts buffer 還有待合併的碎片（timer 正在跑），
            // 不要立刻處理 queue 下一個，等 _flush timer 到期後自然排入。
            if (buf.texts.length > 0 && buf.timer) {
                return;
            }

            if (buf.queue.length > 0) {
                this._processNext(chatId);
            } else if (buf.texts.length === 0) {
                this.buffers.delete(chatId);
            }
        }
    }
}

// ============================================================
// 🧠 Golem Brain (API Direct) - Headless Edition
// ============================================================
// ✨ [API Brain] 直連 Gemini API，移除所有 Puppeteer 依賴
function getSystemFingerprint() { return `OS: ${os.platform()} | Arch: ${os.arch()} | Mode: ${cleanEnv(process.env.GOLEM_MEMORY_MODE || 'native')}`; }

class GolemBrain {
    constructor() {
        this.keyChain = new KeyChain();
        // 保留 doctor 物件供 OpticNerve 借用 keyChain
        this.doctor = { keyChain: this.keyChain };
        this.chatHistory = [];
        this.model = null;
        this._initialized = false;

        // 記憶引擎 (只保留 native/qmd，移除 browser 模式)
        const mode = cleanEnv(process.env.GOLEM_MEMORY_MODE || 'native').toLowerCase();
        console.log(`⚙️ [System] 記憶引擎模式: ${mode.toUpperCase()}`);

        if (mode === 'qmd') {
            this.memoryDriver = new SystemQmdDriver();
        } else {
            // native / system / browser 全部降級為 native
            this.memoryDriver = new SystemNativeDriver();
        }
    }

    async init(forceReload = false) {
        if (this._initialized && !forceReload) return;

        // 1. 初始化 Gemini API
        const apiKey = this.keyChain.getKeySync();
        if (!apiKey) {
            throw new Error("❌ 沒有可用的 GEMINI_API_KEYS，無法啟動。");
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        this.model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
            generationConfig: {
                maxOutputTokens: 8192,
                temperature: 0.7,
            }
        });

        // 2. 啟動記憶驅動
        try {
            await this.memoryDriver.init();
        } catch (e) {
            console.warn(`🔄 [System] 記憶引擎啟動失敗 (${e.message})，降級為 Native FS...`);
            this.memoryDriver = new SystemNativeDriver();
            await this.memoryDriver.init();
        }

        // 3. 注入系統提示詞
        const systemPrompt = skills.getSystemPrompt(getSystemFingerprint());
        const protocol = `
【⚠️ 系統通訊協定 v9.1 - API Direct Mode】
1. **Tri-Stream Protocol (三流協定)**:
你的每一個回應都必須嚴格包含以下三個純文字標籤區塊。
標籤使用全大寫 ASCII，不要加 emoji。若該區塊無內容可留空，但標籤務必保留。

[GOLEM_MEMORY]
(長期記憶寫入。若無則留空。)

[GOLEM_ACTION]
(JSON Array，每個步驟只有 "cmd" 欄位。嚴禁使用 "command"、"shell"、"action" 等其他欄位名。)
(範例：[{"cmd": "ls -la ~"}, {"cmd": "golem-check python"}])
(若無操作：[])

[GOLEM_REPLY]
(回覆給使用者的內容。)

2. **Auto-Discovery Protocol**: 使用 golem-check <工具名> 來確認環境。
3. 不需要任何開頭或結尾錨點標記，直接輸出三流內容即可。
4. 標籤格式嚴格為 [GOLEM_MEMORY]、[GOLEM_ACTION]、[GOLEM_REPLY]，禁止使用 emoji 版本。
`;

        // 設定 system instruction 作為對話起點
        this.systemInstruction = systemPrompt + protocol;
        this.chatHistory = [];
        this._initialized = true;

        console.log("🧠 [Brain] Gemini API 直連已就緒 (無瀏覽器模式)");
        console.log(`🗝️ [Brain] 使用模型: gemini-2.5-flash-lite`);
    }

    async recall(queryText) {
        if (!queryText) return [];
        try {
            console.log(`🧠 [Memory] 正在檢索: "${queryText.substring(0, 20)}..."`);
            return await this.memoryDriver.recall(queryText);
        } catch (e) {
            console.error("記憶讀取失敗:", e.message);
            return [];
        }
    }

    async memorize(text, metadata = {}) {
        try {
            await this.memoryDriver.memorize(text, metadata);
            console.log("🧠 [Memory] 已寫入長期記憶");
        } catch (e) {
            console.error("記憶寫入失敗:", e.message);
        }
    }

    async sendMessage(text, isSystem = false) {
        if (!this._initialized) await this.init();

        // 系統訊息只加入歷史，不需要回應
        if (isSystem) {
            this.chatHistory.push({ role: 'user', parts: [{ text }] });
            this.chatHistory.push({ role: 'model', parts: [{ text: '(系統指令已接收)' }] });
            return "";
        }

        console.log(`📡 [Brain] 發送至 Gemini API (${text.length} chars)...`);

        // 🛡️ [Flood Guard] 智慧退避：指數退避 + retryDelay 感知
        const BACKOFF_SCHEDULE = [15000, 60000, 120000]; // 15s → 60s → 120s
        let lastError = null;
        const maxAttempts = Math.max(this.keyChain.keys.length, 1) + BACKOFF_SCHEDULE.length;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let apiKey = null;
            try {
                apiKey = await this.keyChain.getKey();
                if (!apiKey) throw new Error("沒有可用的 API Key");

                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash-lite",
                    systemInstruction: this.systemInstruction,
                    generationConfig: {
                        maxOutputTokens: 8192,
                        temperature: 0.7,
                    }
                });

                const chat = model.startChat({
                    history: this.chatHistory,
                });

                const result = await chat.sendMessage(text);
                const response = result.response.text();

                // 更新對話歷史 (保留最近 20 輪防止 context 爆炸)
                this.chatHistory.push({ role: 'user', parts: [{ text }] });
                this.chatHistory.push({ role: 'model', parts: [{ text: response }] });

                if (this.chatHistory.length > 40) {
                    this.chatHistory = this.chatHistory.slice(-40);
                }

                console.log(`✅ [Brain] 回應接收完成 (${response.length} chars)`);

                // 清理舊版錨點 (相容性)
                return response
                    .replace('—-回覆開始—-', '')
                    .replace('—-回覆結束—-', '')
                    .trim();

            } catch (e) {
                lastError = e;
                console.warn(`⚠️ [Brain] API 呼叫失敗 (attempt ${attempt + 1}/${maxAttempts}): ${e.message}`);

                // 429 / RESOURCE_EXHAUSTED — 智慧退避
                if (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED')) {
                    // 🧊 標記這把 key 冷卻 (RPD 用完就凍 15 分鐘，RPM 用完凍 90 秒)
                    if (apiKey) {
                        const isDaily = e.message.includes('per day') || e.message.includes('RPD');
                        this.keyChain.markCooldown(apiKey, isDaily ? 15 * 60 * 1000 : 90 * 1000);
                    }
                    let waitMs;
                    const retryMatch = e.message.match(/retryDelay['":\s]*(\d+)/i);
                    if (retryMatch) {
                        waitMs = parseInt(retryMatch[1]) * 1000;
                        console.log(`⏳ [Brain] 使用 API 建議的 retryDelay: ${waitMs / 1000}s`);
                    } else {
                        const backoffIdx = Math.min(attempt, BACKOFF_SCHEDULE.length - 1);
                        waitMs = BACKOFF_SCHEDULE[backoffIdx];
                        console.log(`⏳ [Brain] 指數退避 (level ${backoffIdx + 1}): ${waitMs / 1000}s`);
                    }
                    await new Promise(r => setTimeout(r, waitMs));
                }
            }
        }

        throw new Error(`所有 API Key 都失敗 (嘗試 ${maxAttempts} 次): ${lastError?.message}`);
    }
}

// ============================================================
// 🔍 DebugLog (無頭除錯 — GOLEM_DEBUG=true 啟用)
// ============================================================
// ✨ [Consolidated Patch]
const _DBG = process.env.GOLEM_DEBUG === 'true';
function dbg(tag, ...args) {
    if (!_DBG) return;
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`🐛 [${ts}] [${tag}]`, ...args);
}

// ============================================================
// ⚓ TriStreamParser (共用三流解析器 — Lookahead 版)
// ============================================================
class TriStreamParser {
    /**
     * 解析 Gemini 回應為 { memory, actions, reply }
     * 支援 Emoji 標籤 [🧠 MEMORY_IMPRINT] 和 ASCII 標籤 [GOLEM_MEMORY]
     * 用 lookahead 切段，不依賴閉合標籤
     */
    static parse(raw) {
        if (!raw) return { memory: null, actions: [], reply: '', hasStructuredTags: false };

        const result = { memory: null, actions: [], reply: '', hasStructuredTags: false };

        // Lookahead regex：捕獲標籤類型 + 內容直到下一個標籤或 EOF
        const TAG_RE = /\[(?:🧠\s*MEMORY_IMPRINT|🤖\s*ACTION_PLAN|(?:💬|🤖)\s*REPLY|GOLEM_MEMORY|GOLEM_ACTION|GOLEM_REPLY)\]([\s\S]*?)(?=\[(?:🧠\s*MEMORY_IMPRINT|🤖\s*ACTION_PLAN|(?:💬|🤖)\s*REPLY|GOLEM_MEMORY|GOLEM_ACTION|GOLEM_REPLY)\]|$)/gi;

        let m;
        let hasAnyTag = false;

        while ((m = TAG_RE.exec(raw)) !== null) {
            hasAnyTag = true;
            result.hasStructuredTags = true;
            const header = m[0];
            const body = m[1].trim();

            // 判斷類型 (v9.2.0: REPLY 優先判斷，避免 [🤖 REPLY] 被誤歸為 ACTION)
            let type;
            if (/MEMORY/i.test(header)) type = 'M';
            else if (/REPLY/i.test(header)) type = 'R';
            else if (/ACTION/i.test(header)) type = 'A';
            else type = 'R';

            if (type === 'M') {
                if (body && body !== '(無)' && body !== 'null' && body.length > 0) {
                    result.memory = body;
                }
            } else if (type === 'A') {
                const jsonStr = body.replace(/```json/g, '').replace(/```/g, '').trim();
                const jsonStrNormalized = jsonStr.replace(/\s+/g, '');
                dbg('ActionRaw', `len=${jsonStr.length} normalized=${JSON.stringify(jsonStrNormalized)}`);
                if (jsonStr && jsonStr !== 'null' && jsonStrNormalized !== '[]' && jsonStrNormalized !== '{}' && jsonStr.length > 2) {
                    try {
                        const parsed = JSON.parse(jsonStr);
                        let steps = Array.isArray(parsed) ? parsed : (parsed.steps || [parsed]);
                        // 正規化：command/shell/action → cmd
                        steps = steps.map(s => {
                            if (!s.cmd && (s.command || s.shell || s.action)) {
                                s.cmd = s.command || s.shell || s.action;
                            }
                            return s;
                        }).filter(s => s && s.cmd); // 過濾 null/undefined/無 cmd
                        if (steps.length > 0) {
                            result.actions.push(...steps);
                            dbg('ActionPush', `Pushed ${steps.length} steps: ${JSON.stringify(steps)}`);
                        } else {
                            dbg('ActionPush', `JSON parsed but no valid steps (empty after filter)`);
                        }                    } catch (e) {
                        // Fuzzy: 嘗試從中間挖 JSON
                        const fb = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/) || jsonStr.match(/\{[\s\S]*\}/);
                        if (fb) {
                            try {
                                const fixed = JSON.parse(fb[0]);
                                result.actions.push(...(Array.isArray(fixed) ? fixed : [fixed]));
                                dbg('ActionPush-Fuzzy', `Fuzzy pushed: ${JSON.stringify(fixed)}`);
                            } catch (_) {}
                        }
                        dbg('Parser', 'ACTION JSON parse fail:', e.message);
                    }
                }
            } else {
                // REPLY — 清理殘留錨點
                result.reply = body
                    .replace('—-回覆開始—-', '')
                    .replace('—-回覆結束—-', '')
                    .replace(/\[G_ID:\d+\]/g, '')
                    .trim();
            }
        }

        // Fallback: 完全沒標籤 → 整段當回覆
        if (!hasAnyTag) {
            dbg('Parser', 'No tags found — raw reply fallback');
            result.reply = raw
                .replace('—-回覆開始—-', '')
                .replace('—-回覆結束—-', '')
                .trim();
        }

        // 有標籤但 REPLY 空 → 撈殘餘文字
        if (hasAnyTag && !result.reply) {
            const leftover = raw
                .replace(/\[(?:🧠[^\]]*|🤖[^\]]*|💬[^\]]*|GOLEM_\w+)\][\s\S]*?(?=\[(?:🧠|🤖|💬|GOLEM_)|$)/gi, '')
                .replace('—-回覆開始—-', '')
                .replace('—-回覆結束—-', '')
                .trim();
            if (leftover) result.reply = leftover;
        }

        dbg('TriStream', `M:${result.memory ? 'Y' : 'N'} A:${result.actions.length} R:${result.reply.length}ch`);
        return result;
    }
}

// ============================================================
// ⚡ ResponseParser (JSON 解析器)
// ============================================================
class ResponseParser {
    static extractJson(text) {
        if (!text) return [];
        try {
            // 1. 標準 JSON 區塊
            const match = text.match(/```json([\s\S]*?)```/);
            if (match) {
                const parsed = JSON.parse(match[1]);
                return parsed.steps || (Array.isArray(parsed) ? parsed : [parsed]);
            }
            // 2. 裸 JSON Array
            const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (arrayMatch) return JSON.parse(arrayMatch[0]);
        } catch (e) { console.error("解析 JSON 失敗:", e.message); }

        // 3. Fallback: 從自然語言中提取 `command` 格式的指令
        // Gemini 常常不輸出 JSON，而是寫「我正在執行 `ls -la ~` 指令」
        const cmdMatches = [...text.matchAll(/`([^`]+)`/g)]
            .map(m => m[1].trim())
            .filter(cmd => {
                // 過濾掉不像指令的東西（純標籤名、太短、含中文）
                if (cmd.length < 2 || cmd.length > 200) return false;
                if (/^[\u4e00-\u9fff]/.test(cmd)) return false; // 中文開頭的不是指令
                if (/^\[|^#|^\*/.test(cmd)) return false; // markdown 語法
                // 必須以常見指令開頭
                const shellPrefixes = ['ls', 'cd', 'cat', 'echo', 'pwd', 'mkdir', 'rm', 'cp', 'mv',
                    'git', 'node', 'npm', 'python', 'pip', 'curl', 'wget', 'find', 'grep',
                    'chmod', 'chown', 'tail', 'head', 'df', 'free', 'ps', 'kill', 'pkill',
                    'whoami', 'uname', 'date', 'golem-check', 'golem-schedule', 'lsof', 'top', 'which',
                    'touch', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'docker', 'ffmpeg'];
                const base = cmd.split(/\s+/)[0].toLowerCase();
                return shellPrefixes.includes(base);
            })
            .map(cmd => ({ cmd }));

        if (cmdMatches.length > 0) {
            console.log(`🔧 [Parser] JSON 解析失敗，Fallback 提取到 ${cmdMatches.length} 條指令: ${cmdMatches.map(c => c.cmd).join(', ')}`);
        }
        return cmdMatches;
    }
}

// ============================================================
// ☁️ System Upgrader (OTA 空中升級)
// ============================================================
class SystemUpgrader {
    static async performUpdate(ctx) {
        if (!CONFIG.GITHUB_REPO) return ctx.reply("❌ 未設定 GitHub Repo 來源，無法更新。");
        await ctx.reply("☁️ 連線至 GitHub 母體，開始下載最新核心...");
        await ctx.sendTyping();

        const filesToUpdate = ['index.js', 'skills.js'];
        const downloadedFiles = [];
        try {
            // 1. 下載並檢疫
            for (const file of filesToUpdate) {
                const url = `${CONFIG.GITHUB_REPO}${file}?t=${Date.now()}`;
                const tempPath = path.join(process.cwd(), `${file}.new`);
                console.log(`📥 Downloading ${file} from ${url}...`);
                const response = await fetch(url);

                if (!response.ok) throw new Error(`無法下載 ${file} (Status: ${response.status})`);
                const code = await response.text();
                fs.writeFileSync(tempPath, code);
                downloadedFiles.push({ file, tempPath });
            }

            // 2. 安全驗證
            await ctx.reply("🛡️ 下載完成，正在進行語法完整性掃描...");
            for (const item of downloadedFiles) {
                const isValid = PatchManager.verify(item.tempPath);
                if (!isValid) throw new Error(`檔案 ${item.file} 驗證失敗，更新已終止以保護系統。`);
            }

            // 3. 備份與覆蓋
            await ctx.reply("✅ 驗證通過。正在寫入系統...");
            for (const item of downloadedFiles) {
                const targetPath = path.join(process.cwd(), item.file);
                if (fs.existsSync(targetPath)) {
                    fs.copyFileSync(targetPath, `${targetPath}.bak`);
                }
                fs.renameSync(item.tempPath, targetPath);
            }

            // 4. 重啟
            await ctx.reply("🚀 系統更新成功！Golem 正在重啟以套用新靈魂...");
            const subprocess = spawn(process.argv[0], process.argv.slice(1), {
                detached: true,
                stdio: 'ignore',
                cwd: process.cwd()
            });
            subprocess.unref();
            process.exit(0);
        } catch (e) {
            console.error(e);
            downloadedFiles.forEach(item => {
                if (fs.existsSync(item.tempPath)) fs.unlinkSync(item.tempPath);
            });
            await ctx.reply(`❌ 更新失敗：${e.message}\n系統已回滾至安全狀態。`);
        }
    }
}

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
        this.executor = new Executor();
        this.security = new SecurityManager();
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
    run(cmd) {
        return new Promise((resolve, reject) => {
            console.log(`⚡ Exec: ${cmd}`);
            exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
                if (err) reject(stderr || err.message);
                else resolve(stdout);
            });
        });
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

const chronos = new ChronosManager();
class AutonomyManager {
    constructor(brain) {
        this.brain = brain;
        this._timer = null;  // 防止多重 setTimeout 疊加
        this.journalPath = path.join(process.cwd(), 'memory', 'journal.jsonl');
    }

    start() {
        if (!CONFIG.TG_TOKEN && !CONFIG.DC_TOKEN) return;
        // 確保 memory/ 目錄存在
        const memDir = path.join(process.cwd(), 'memory');
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        chronos.rebuild();
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
        const cfg = this._loadAutonomyConfig().awakening;
        const range = cfg.maxHours - cfg.minHours;
        const waitMs = (cfg.minHours + Math.random() * range) * 3600000;
        const nextWakeTime = new Date(Date.now() + waitMs);
        const hour = nextWakeTime.getHours();
        let finalWait = waitMs;
        if (cfg.sleepHours.includes(hour)) {
            console.log("\u{1F4A4} Golem 決定睡個好覺，早上再找你。");
            const morning = new Date(nextWakeTime);
            morning.setHours(cfg.morningWakeHour, 0, 0, 0);
            if (morning < nextWakeTime) morning.setDate(morning.getDate() + 1);
            finalWait = morning.getTime() - Date.now();
        }
        console.log("\u267B\uFE0F [LifeCycle] 下次醒來: " + (finalWait / 60000).toFixed(1) + " 分鐘後");
        this._timer = setTimeout(() => {
            this.manifestFreeWill();
            this.scheduleNextAwakening();
        }, finalWait);
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
                    await this.performSpontaneousChat();
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
            try {
                const apiKey = await this.brain.keyChain.getKey();
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
                if (is429) {
                    const keyIdx = (this.brain.keyChain.currentIndex - 1 + this.brain.keyChain.keys.length) % this.brain.keyChain.keys.length;
                    const failedKey = this.brain.keyChain.keys[keyIdx];
                    this.brain.keyChain.markCooldown(failedKey, 90 * 1000);
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

        const decisionPrompt = [
            '你是 Golem。以下是你的靈魂文件和最近經驗。',
            '',
            '【靈魂文件】',
            soul,
            '',
            '【最近經驗】',
            journalSummary,
            '',
            '',
            diversitySummary ? '【行動分佈統計】' : '',
            diversitySummary || '',
            '',
            '【當前時間】' + timeStr,
            '',
            '【可選行動】（已排除不可選的項目）',
            actionList,
            '',
            '【要求】',
            '從上面的可選行動中選一個。',
            '用 JSON 回覆：{"action": "xxx", "reason": "為什麼選這個"}',
            '',
            '注意：',
            '- action 只能是: ' + validActionStr,
            '- 括號裡的資訊是事實，參考它來做更好的選擇',
            '- 如果上次某個行動失敗了，考慮換一個方向',
            '- 多樣化的行動模式比重複單一行動更有價值。如果連續多次執行同一行動，優先考慮其他選項',
            '- 只輸出 JSON，不要加其他文字'
        ].join('\n');

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
        const prompt = `【你的身份與價值觀】
${soul}

【任務】主動社交
【現在時間】${timeStr} (${contextNote})
【最近社交紀錄】${recentSocial || '（無）'}
【要求】根據你的靈魂文件，用你自己的口吻跟老哥說話。自然、簡短、有溫度。包含對時間的感知。如果最近已經找過對方，換個話題。控制在 100 字以內。

⚠️ 直接輸出要說的話，不要輸出 JSON、不要輸出標籤、不要輸出程式碼。`;
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
            if (CONFIG.GITHUB_TOKEN) {
                headers['Authorization'] = `token ${CONFIG.GITHUB_TOKEN}`;
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
            const analysisPrompt = [
                '【你的身份與價值觀】',
                soul,
                '',
                '【任務】GitHub 專案探索報告',
                `【專案】${newRepo.full_name} (⭐ ${newRepo.stargazers_count})`,
                `【描述】${newRepo.description || '(無)'}`,
                `【語言】${newRepo.language || '(未標示)'}`,
                '【README 節錄】',
                readmeText,
                '',
                '【要求】',
                '1. 用你自己的口吻（根據靈魂文件的身份和價值觀）寫一段探索心得，像是在跟老哥分享你發現的東西',
                '2. 說明這個專案做什麼、有什麼特色',
                '3. 對你（ThinkPad X200 上的 Agent）有什麼可借鏡之處？有沒有能用的想法？',
                '4. 如果跟你的方向無關，誠實說，不要硬湊',
                '5. 整段回覆控制在 200 字以內，用繁體中文，語氣自然不制式',
                '',
                '⚠️ 直接輸出心得文字，不要輸出 JSON、不要輸出程式碼修改建議、不要輸出任何標籤格式'
            ].join('\n');

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
            const currentCode = Introspection.readSelf();
            const advice = memory.getAdvice();
            // Load EVOLUTION skill as prompt template (single source of truth)
            const evolutionSkill = skills.skillLoader.loadSkill("EVOLUTION") || "Output a JSON Array of patches with search/replace fields.";
            const prompt = [
                evolutionSkill,
                "",
                "## TARGET CODE (first 18000 chars of index.js)",
                "",
                currentCode.slice(0, 18000),
                "",
                "## CONTEXT FROM MEMORY",
                "",
                advice || "(none)",
                "",
                "Now analyse the code above and output ONLY a JSON Array. No other text.",
            ].join("\n");
            const raw = await this._callGeminiDirect(prompt, { maxOutputTokens: 2048, temperature: 0.3 });
            const reflectionFile = this._saveReflection('self_reflection', raw);
            let patches = ResponseParser.extractJson(raw);
            // Validate: must have search+replace fields, reject cmd fallback results
            patches = patches.filter(p => p && typeof p.search === "string" && typeof p.replace === "string");
            if (patches.length > 0) {
                const patch = patches[0];
                const proposalType = patch.type || 'unknown';
                memory.recordProposal(proposalType);
                const targetName = patch.file === 'skills.js' ? 'skills.js' : 'index.js';
                const targetPath = targetName === 'skills.js' ? path.join(process.cwd(), 'skills.js') : __filename;
                const testFile = PatchManager.createTestClone(targetPath, patches);
                let isVerified = false;
                if (targetName === 'skills.js') { try { require(path.resolve(testFile)); isVerified = true; } catch (e) { console.error(e); } }
                else { isVerified = PatchManager.verify(testFile); }

                if (isVerified) {
                    global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: patch.description };
                    const msgText = `💡 **自主進化提案** (${proposalType})\n目標：${targetName}\n內容：${patch.description}`;
                    const options = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };
                    if (triggerCtx) { await triggerCtx.reply(msgText, options); await triggerCtx.sendDocument(testFile); }
                    else if (tgBot && CONFIG.ADMIN_IDS[0]) { await tgBot.api.sendMessage(CONFIG.ADMIN_IDS[0], msgText, options); await tgBot.api.sendDocument(CONFIG.ADMIN_IDS[0], new InputFile(testFile)); }

                    this.appendJournal({
                        action: 'self_reflection',
                        proposal: proposalType,
                        target: targetName,
                        description: patch.description,
                        outcome: 'proposed',
                        reflection_file: reflectionFile
                    });
                } else {
                    this.appendJournal({
                        action: 'self_reflection',
                        proposal: proposalType,
                        outcome: 'verification_failed',
                        reflection_file: reflectionFile
                    });
                }
            } else {
                this.appendJournal({
                    action: 'self_reflection',
                    outcome: 'no_patches_generated',
                    reflection_file: reflectionFile
                });
            }
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
            if (tgBot && CONFIG.ADMIN_IDS[0]) {
                if (text.length <= TG_MAX) {
                    await tgBot.api.sendMessage(CONFIG.ADMIN_IDS[0], text);
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
                        await tgBot.api.sendMessage(CONFIG.ADMIN_IDS[0], chunk);
                    }
                }
            } else if (dcClient && CONFIG.DISCORD_ADMIN_ID) {
                const user = await dcClient.users.fetch(CONFIG.DISCORD_ADMIN_ID);
                await user.send(text.slice(0, 2000)); // Discord 限制 2000
            }
        } catch (e) {
            console.error('[Autonomy] 發送失敗:', e.message);
        }
    }

    // 中間層：解析 tri-stream → 處理 memory → 發送 reply
    async sendNotification(msgText) {
        try {
            const parsed = TriStreamParser.parse(msgText);
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
// ============================================================
// 🎮 Hydra Main Loop
// ============================================================
const brain = new GolemBrain();
const controller = new TaskController();
const autonomy = new AutonomyManager(brain);

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
        const prompt = `【任務】代碼熱修復\n【需求】${req}\n【源碼】\n${currentCode.slice(0, 15000)}\n【格式】輸出 JSON Array。`;
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
        // 👁️ 視覺/檔案處理檢查 [✨ New Vision Logic]
        const attachment = await ctx.getAttachment();
        if (attachment) {
            await ctx.reply("👁️ 正在透過 OpticNerve (Gemini 2.5 Flash) 分析檔案，請稍候...");
            const apiKey = await brain.doctor.keyChain.getKey();
            // 借用 Doctor 的 KeyChain

            if (!apiKey) {
                await ctx.reply("⚠️ 系統錯誤：找不到可用的 API Key，無法啟動視覺模組。");
                return;
            }

            const analysis = await OpticNerve.analyze(attachment.url, attachment.mimeType, apiKey);
            finalInput = `
【系統通知：視覺訊號輸入】
使用者上傳了一個檔案。
檔案類型：${attachment.mimeType}

【Gemini 2.5 Flash 分析報告】
${analysis}

----------------
使用者隨附訊息：${ctx.text || "(無文字)"}
----------------
【指令】
1. 請根據「分析報告」的內容來回應使用者，就像你親眼看到了檔案一樣。
2. 如果報告中包含程式碼錯誤，請直接提供修復建議。
3. 請明確告知使用者你收到的是「分析報告」而非實體檔案，若使用者要求修圖，請誠實婉拒。`;

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
                finalInput = `
【相關記憶 (系統提示：這是你的長期記憶，請參考但不需特別提及)】
${memoryText}
----------------------------------
[使用者訊息]
${finalInput}`;
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
                const correctionPrompt = `[System Format Correction]
你剛才的回應中，REPLY 提到要執行 ${impliedCmds.map(c => '`' + c + '`').join(', ')}，但 ACTION_PLAN 是空的 []。
這是格式錯誤。請重新輸出，確保要執行的指令放在 ACTION_PLAN 的 JSON Array 中。
範例：[{"cmd": "${impliedCmds[0]}"}]
請直接輸出修正後的三流格式，不需要解釋。`;

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
                const feedbackPrompt = `
[System Observation Report]
Here are the results of the actions I executed.
${observation}

[Response Guidelines]
1. If successful, summarize the result helpfully.
2. If failed (Error), do NOT panic.
Explain what went wrong in simple language and suggest a next step.
3. Reply in Traditional Chinese naturally.
4. If you need to run follow-up commands, include them in ACTION_PLAN.
`;
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
                        const r3Prompt = `[System Observation Report - Final Round]\n${r2Observation}\n\nSummarize the result to the user in Traditional Chinese. Do NOT suggest running any new commands.`;
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
                    const executor = new Executor();
                    const output = await executor.run(approvedStep.cmd);
                    approvedResult = `[Approved Step Success] cmd: ${approvedStep.cmd}\nResult/Output:\n${output.trim() || "(No stdout)"}`;
                }
            } catch (err) {
                approvedResult = `[Approved Step Failed] cmd: ${approvedStep.cmd}\nError:\n${err.message}`;
            }

            // 繼續執行剩餘步驟（從 nextIndex+1 開始，正常 security check）
            const remainingResult = await controller.runSequence(ctx, steps, nextIndex + 1, tainted || false);
            const observation = [approvedResult, remainingResult].filter(Boolean).join('\n\n----------------\n\n');

            if (observation) {
                const feedbackPrompt = `[System Observation Report - Approved Actions]\nUser approved high-risk actions.
Result:\n${observation}\n\nReport this to the user naturally in Traditional Chinese. Do NOT suggest running any new commands.`;
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
        global.pendingPatch = null;
        memory.recordSuccess();
        await ctx.reply(`🚀 ${targetName} 升級成功！正在重啟...`);
        const subprocess = spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore' });
        subprocess.unref();
        process.exit(0);
    } catch (e) { await ctx.reply(`❌ 部署失敗: ${e.message}`); }
}

async function executeDrop(ctx) {
    if (!global.pendingPatch) return;
    try { fs.unlinkSync(global.pendingPatch.path); } catch (e) { }
    global.pendingPatch = null;
    memory.recordRejection();
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
