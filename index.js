/**
 * 🦞 Forked-Golem v9.8.0 (Composition Architecture)
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
// ==========================================
let dashboard = null;
if (process.argv.includes('dashboard')) {
    try {
        dashboard = require('./src/dashboard');
        console.log("✅ 戰術控制台已啟動 (繁體中文版)");
    } catch (e) {
        console.error("❌ 無法載入 Dashboard:", e.message);
    }
} else {
    console.log("ℹ️  以標準模式啟動 (無 Dashboard)。若需介面請輸入 'npm start dashboard'");
}

const GOLEM_VERSION = require('./package.json').version;
require('dotenv').config();
const { Bot, InputFile } = require('grammy');
const { autoRetry } = require('@grammyjs/auto-retry');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const skills = require('./src/skills');
const SecurityManager = require('./src/security');
const { TriStreamParser, ResponseParser, dbg } = require('./src/parsers');
const { loadPrompt, loadFeedbackPrompt } = require('./src/prompt-loader');
const CONFIG = require("./src/config");

const BOOT_TIME = Date.now();
const API_MIN_INTERVAL_MS = 2500;

// ─── Bot 實例 ───────────────────────────────────────────────
const tgBot = CONFIG.TG_TOKEN ? new Bot(CONFIG.TG_TOKEN) : null;
if (tgBot) { tgBot.api.config.use(autoRetry({ maxRetryAttempts: 5, maxDelaySeconds: 60 })); }

const dcClient = CONFIG.DC_TOKEN ? new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
}) : null;

const pendingTasks = new Map();
global.pendingPatch = null;

// ─── Phase 2 模組 ───────────────────────────────────────────
const { OpticNerve, UniversalContext, MessageManager } = require('./src/context');
const { ExperienceMemory, SystemQmdDriver, SystemNativeDriver } = require('./src/memory-drivers');
const { GolemBrain, getSystemFingerprint } = require('./src/brain');
const { Introspection, PatchManager, SystemUpgrader } = require('./src/upgrader');
const { ToolScanner, HelpManager } = require('./src/tools');
const memory = new ExperienceMemory();

// ─── Phase 3 模組 ───────────────────────────────────────────
const NodeRouter = require('./src/node-router');
const TaskController = require('./src/task-controller');
const ChronosManager = require('./src/chronos');
const AutonomyManager = require('./src/autonomy');
const GCPAuth = require('./src/gcp-auth');
const GoogleServices = require('./src/google-services');

// ─── 核心服務實例 ────────────────────────────────────────────
const ModelRouter = require('./src/model-router');
const modelRouter = new ModelRouter();
if (dashboard) dashboard.inject({ modelRouter });

const brain = new GolemBrain(modelRouter);
const chronos = new ChronosManager({ tgBot, adminChatId: CONFIG.ADMIN_IDS[0] });
const gcpAuth = new GCPAuth();
const googleServices = new GoogleServices(gcpAuth);
const controller = new TaskController({ chronos, brain, skills, pendingTasks });

const PendingPatches = require('./src/autonomy/pending-patches');
const pendingPatches = new PendingPatches();

const autonomy = new AutonomyManager({
    brain, chronos, tgBot, dcClient, memory, skills,
    CONFIG, loadPrompt, loadFeedbackPrompt,
    Introspection, PatchManager, TriStreamParser, ResponseParser, InputFile,
    PendingPatches: pendingPatches,
    googleServices,
});
if (dashboard) dashboard.inject({ autonomy });

// ─── 業務邏輯模組 ────────────────────────────────────────────
const ReactLoop = require('./src/react-loop');
const DeployActions = require('./src/deploy-actions');
const GoogleCommands = require('./src/google-commands');
const CallbackHandler = require('./src/callback-handler');
const MessageHandler = require('./src/message-handler');

const reactLoop = new ReactLoop({ controller, brain, pendingTasks });
const deployActions = new DeployActions({ memory, autonomy, pendingPatches, brain });
const googleCmds = new GoogleCommands({ googleServices, gcpAuth });
const callbackHandler = new CallbackHandler({ deployActions, reactLoop, pendingTasks, brain, controller, autonomy });
const messageHandler = new MessageHandler({
    brain, skills, autonomy, controller, deployActions, googleCmds,
    reactLoop, memory, modelRouter, pendingTasks, BOOT_TIME
});

// ─── 啟動序列 ────────────────────────────────────────────────
(async () => {
    if (process.env.GOLEM_TEST_MODE === 'true') {
        console.log('🚧 [System] GOLEM_TEST_MODE is active.');
        console.log('🛑 Brain initialization & Browser launch skipped.');
        console.log('✅ System syntax check passed.');
        return;
    }

    // ─── Phase 0：Codebase 索引重建（非阻塞，失敗不中止啟動）──────
    try {
        const CodebaseIndexer = require('./src/codebase-indexer');
        let needRebuild = true;
        try {
            const idx = CodebaseIndexer.load();
            needRebuild = CodebaseIndexer.isStale(idx);
        } catch (e) { /* 索引不存在 → 直接 rebuild */ }
        if (needRebuild) {
            console.log('🔍 [Indexer] 建立 codebase 索引...');
            CodebaseIndexer.rebuild();
        }
    } catch (e) {
        console.warn('⚠️ [Indexer] 索引建立失敗（不影響啟動）:', e.message);
    }

    await brain.init();
    autonomy.start();
    console.log(`📡 Golem v${GOLEM_VERSION} is Online.`);

    // GCP OAuth 初始化（非阻塞，失敗不影響主流程）
    (async () => {
        try {
            if (!gcpAuth.isAuthenticated()) {
                await gcpAuth.startLoopbackFlow(async (authUrl) => {
                    const msg = `🔑 Google 授權需要你的操作（10 分鐘內有效）\n\n請在瀏覽器開啟以下連結：\n${authUrl}`;
                    if (tgBot && CONFIG.ADMIN_ID) {
                        await tgBot.api.sendMessage(CONFIG.ADMIN_ID, msg).catch(e => console.warn('[GCP] 授權通知發送失敗:', e.message));
                    }
                });
                if (tgBot && CONFIG.ADMIN_ID) {
                    await tgBot.api.sendMessage(CONFIG.ADMIN_ID, '✅ Google 授權完成！Gmail / Calendar / Drive / Tasks 已就緒').catch(() => {});
                }
            }
        } catch (e) {
            console.error('[GCP] OAuth init 失敗:', e.message);
            if (tgBot && CONFIG.ADMIN_ID) {
                tgBot.api.sendMessage(CONFIG.ADMIN_ID, `⚠️ Google 授權失敗：${e.message}`).catch(() => {});
            }
        }
    })();

    if (dcClient) dcClient.login(CONFIG.DC_TOKEN);
})();

// ─── 事件綁定 ────────────────────────────────────────────────
if (tgBot) {
    tgBot.on('message', (ctx) => messageHandler.handleMessage(new UniversalContext('telegram', ctx, tgBot)));
    tgBot.on('callback_query:data', (ctx) => {
        callbackHandler.handle(new UniversalContext('telegram', ctx, tgBot), ctx.callbackQuery.data)
            .catch(e => console.error('❌ [Callback] handle 失敗:', e.stack || e.message || String(e)));
        ctx.answerCallbackQuery().catch(() => {});
    });
    tgBot.catch((err) => console.error(`⚠️ [TG] ${err.message}`));
    tgBot.start();
}
if (dcClient) {
    dcClient.on('messageCreate', (msg) => { if (!msg.author.bot) messageHandler.handleMessage(new UniversalContext('discord', msg, dcClient)); });
    dcClient.on('interactionCreate', (interaction) => { if (interaction.isButton()) callbackHandler.handle(new UniversalContext('discord', interaction, dcClient), interaction.customId); });
}

// ─── 全域異常守護 ────────────────────────────────────────────
// crash_guard v2: EPIPE/pipe 錯誤最先擋、reentry guard、journal size guard
const _crashGuardSeen = new Map();
let _crashGuardBusy = false;
process.on('uncaughtException', (err) => {
    const msg = err.message || String(err);
    if (msg.includes('EPIPE') || msg.includes('ECONNRESET') || msg.includes('write after end')) return;
    if (_crashGuardBusy) return;
    _crashGuardBusy = true;
    try {
        console.error('🛡️ [Guard] uncaughtException:', msg);
        const now = Date.now();
        if (_crashGuardSeen.has(msg) && now - _crashGuardSeen.get(msg) < 60000) return;
        _crashGuardSeen.set(msg, now);
        if (_crashGuardSeen.size > 50) {
            for (const [k, t] of _crashGuardSeen) { if (now - t > 60000) _crashGuardSeen.delete(k); }
        }
        const jp = require('path').join(process.cwd(), 'memory', 'journal.jsonl');
        try {
            const stat = require('fs').statSync(jp);
            if (stat.size > 1 * 1024 * 1024) return;
        } catch (_) {}
        require('fs').appendFileSync(jp, JSON.stringify({
            ts: new Date().toISOString(), action: 'crash_guard', error: msg,
            stack: (err.stack || '').split('\n').slice(0, 3).join(' | ')
        }) + '\n');
    } catch (_) {
    } finally {
        _crashGuardBusy = false;
    }
});

process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? (reason.stack || reason.message) : (JSON.stringify(reason) || String(reason));
    console.error('🛡️ [Guard] unhandledRejection 已攔截:', msg);
});

let _isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (_isShuttingDown) return;
    _isShuttingDown = true;
    console.log(`\n🛑 [Shutdown] 收到 ${signal}，正在關閉...`);
    try {
        if (tgBot) await tgBot.stop();
        console.log('✅ [Shutdown] Telegram 長輪詢已關閉');
    } catch (e) {
        console.warn('⚠️ [Shutdown] tgBot.stop() 失敗:', e.message);
    }
    process.exit(0);
}
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
