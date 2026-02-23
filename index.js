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
// 用法：npm start dashboard (開啟)
//       npm start           (關閉)
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
// ==========================================
const GOLEM_VERSION = require('./package.json').version;
require('dotenv').config();
const { Bot, InputFile } = require('grammy');
const { autoRetry } = require('@grammyjs/auto-retry');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const skills = require('./src/skills');
const SecurityManager = require('./src/security');
const { TriStreamParser, ResponseParser, dbg } = require('./src/parsers');
const { loadPrompt, loadFeedbackPrompt } = require('./src/prompt-loader');

// --- ⚙️ 全域配置 (已搬至 src/config.js) ---
const CONFIG = require("./src/config");

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
// Phase 3 模組 (已搬至 src/)
// ============================================================
const NodeRouter = require('./src/node-router');
const TaskController = require('./src/task-controller');
const ChronosManager = require('./src/chronos');

const AutonomyManager = require('./src/autonomy');
// ============================================================
// 🎮 Hydra Main Loop
// ============================================================
const ModelRouter = require('./src/model-router');
const modelRouter = new ModelRouter();

// 📟 Dashboard 注入 ModelRouter
if (dashboard) dashboard.inject({ modelRouter });
const brain = new GolemBrain(modelRouter);
const chronos = new ChronosManager({ tgBot, adminChatId: CONFIG.ADMIN_IDS[0] });
const controller = new TaskController({ chronos, brain, skills, pendingTasks });
const autonomy = new AutonomyManager({
    brain, chronos, tgBot, dcClient, memory, skills,
    CONFIG, loadPrompt, loadFeedbackPrompt,
    Introspection, PatchManager, TriStreamParser, ResponseParser, InputFile
});

// 📟 Dashboard 注入 Autonomy
if (dashboard) dashboard.inject({ autonomy });

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

// ============================================================
// ReAct Loop helpers
// ============================================================

function buildStepSummary(stepLog) {
    if (!stepLog || stepLog.length === 0) return "(no steps yet)";
    return stepLog.map(function(s, i) {
        var sm = s.outputSummary ? " (" + s.outputSummary.replace(/\n/g, " ").substring(0, 60) + ")" : "";
        return "Step " + (i + 1) + ": " + s.cmd + " -> " + (s.ok ? "OK" : "FAILED") + sm;
    }).join("\n");
}

function buildObservation(outputs, stepLog, OBS_FULL_WINDOW) {
    var lines = [];
    var oldSteps = stepLog.slice(0, -OBS_FULL_WINDOW);
    if (oldSteps.length > 0) {
        lines.push("[History]");
        for (var si = 0; si < oldSteps.length; si++) {
            var s = oldSteps[si];
            lines.push("- " + s.cmd + " -> " + (s.ok ? "OK" : "FAILED") + (s.outputSummary ? " (" + s.outputSummary + ")" : ""));
        }
    }
    lines.push("[Latest]");
    for (var oi = 0; oi < outputs.length; oi++) {
        var o = outputs[oi];
        lines.push("$ " + o.cmd);
        lines.push(o.output + (o.truncated ? "...(truncated)" : ""));
        lines.push("---");
    }
    return lines.join("\n");
}

function writeLoopJournal(loopState, autonomy) {
    if (!autonomy) return;
    var successSteps = loopState.stepLog.filter(function(s){return s.ok;}).length;
    var failedSteps = loopState.stepLog.filter(function(s){return !s.ok;}).length;
    var summary = loopState.stepLog.slice(0, 10).map(function(s){return s.cmd.substring(0,30)+(s.ok?"":" [F]");}).join(" | ");
    autonomy.appendJournal({
        action: "conversation",
        loop_steps: loopState.stepCount,
        loop_success: successSteps,
        loop_failed: failedSteps,
        step_summary: summary || undefined,
        skipped_cmds: loopState.skippedCmds.length > 0 ? loopState.skippedCmds : undefined,
        outcome: loopState.stepCount > 0 ? "loop_completed" : "done",
        duration_ms: Date.now() - loopState.startTs
    });
}

async function runReActLoop(ctx, initialSteps, tainted, _autonomy, loopState) {
    var MAX_AUTO_STEPS = 10;
    var OBS_FULL_WINDOW = 3;
    if (!loopState) {
        loopState = { stepCount: 0, consecutiveFails: 0, executedCmds: new Set(), stepLog: [], skippedCmds: [], startTs: Date.now() };
    }
    var steps = initialSteps;
    while (true) {
        var batchResult = await controller.runStepBatch(ctx, steps, loopState, tainted);
        if (batchResult.halted) break;
        if (batchResult.paused) return;
        if (batchResult.failedTooMuch) {
            await ctx.reply("⚠️ 3 consecutive failures, pausing. Steps done: " + loopState.stepCount);
            break;
        }
        if (loopState.stepCount >= MAX_AUTO_STEPS) {
            var taskId = require("crypto").randomUUID();
            pendingTasks.set(taskId, { type: "REACT_CONTINUE", steps: [], loopState: loopState, tainted: tainted, expireAt: Date.now() + 30 * 60 * 1000 });
            await ctx.reply("⏸️ " + loopState.stepCount + " steps done, continue?",
                { reply_markup: { inline_keyboard: [[
                    { text: "▶️ Continue", callback_data: "REACT_CONTINUE:" + taskId },
                    { text: "⏹️ Stop", callback_data: "REACT_STOP:" + taskId }
                ]]}});
            return;
        }
        var observation = buildObservation(batchResult.outputs, loopState.stepLog, OBS_FULL_WINDOW);
        var stepSummary = buildStepSummary(loopState.stepLog);
        var reactPrompt = loadFeedbackPrompt("REACT_STEP", { STEP_COUNT: String(loopState.stepCount), OBSERVATION: observation, STEP_SUMMARY: stepSummary });
        if (!reactPrompt) reactPrompt = "[Observation] " + observation + " Reply in Traditional Chinese.";
        var response = await brain.sendMessage(reactPrompt);
        var parsed = TriStreamParser.parse(response);
        if (parsed.memory) await brain.memorize(parsed.memory, { type: "fact", timestamp: Date.now() });
        var replyText = parsed.reply || (parsed.hasStructuredTags ? null : response);
        if (replyText) await ctx.reply(replyText);
        if (!parsed.actions || parsed.actions.length === 0) break;
        var newSteps = parsed.actions.filter(function(s){ return s && s.cmd && !loopState.executedCmds.has(s.cmd); });
        if (newSteps.length === 0) break;
        steps = newSteps;
        await ctx.sendTyping();
    }
    writeLoopJournal(loopState, _autonomy);
    if (loopState.skippedCmds.length > 0) {
        var skippedList = loopState.skippedCmds.map(function(c){ return "- " + c; }).join("\n");
        await ctx.reply("⚠️ WARNING cmds skipped (manual confirm needed):\n" + skippedList);
    }
}

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
            // [Hallucination Guard] flash-lite 過濾幻覺指令
            try {
                const userMsg = (ctx._text || "").substring(0, 300);
                const cmds = steps.map((s, i) => i + ": " + s.cmd).join("\n");
                const guardPrompt = [
                    "User message: \"" + userMsg.replace(/"/g, "\x27") + "\"",
                    "AI generated these commands:", cmds, "",
                    "Which commands did the user EXPLICITLY request or clearly imply?",
                    "Commands the AI invented on its own (not requested) should be dropped.",
                    "Reply ONLY a JSON object: {\"keep\":[indices],\"drop\":[indices]}",
                    "Example: {\"keep\":[0],\"drop\":[1,2]}"
                ].join("\n");
                const guardResult = await modelRouter.route(guardPrompt, { intent: "chat", maxOutputTokens: 100, temperature: 0 });
                const guardJson = (guardResult || "").replace(/```json|```/g, "").trim();
                try {
                    const verdict = JSON.parse(guardJson);
                    const dropSet = new Set(verdict.drop || []);
                    if (dropSet.size > 0) {
                        const dropped = steps.filter((_, i) => dropSet.has(i));
                        steps = steps.filter((_, i) => !dropSet.has(i));
                        console.log("\ud83d\udee1\ufe0f [HallucinationGuard] 過濾 " + dropped.length + " 個幻覺指令: " + dropped.map(s => s.cmd).join(", "));
                    }
                } catch (parseErr) {
                    dbg("HallucinationGuard", "JSON parse failed, executing all:", parseErr.message);
                }
            } catch (guardErr) {
                console.warn("\u26a0\ufe0f [HallucinationGuard] 判斷失敗，照常執行:", guardErr.message);
            }
        }

        if (steps.length > 0) {
            // [ReAct Loop] 取代原本硬編碼的 R1→R2→R3
            await runReActLoop(ctx, steps, tainted, autonomy);
        } else if (!chatPart) {
            // 既沒有 Action 也沒有 chatPart，回傳原始訊息避免空窗
            await ctx.reply(raw);
        }
    } catch (e) { console.error(e); await ctx.reply(`❌ 錯誤: ${e.message}`); }

    // === 閉環：對話摘要寫入 journal ===
    // 有 loop 的情況由 runReActLoop → writeLoopJournal 負責
    // 純對話（無 action）才在這裡記錄
    try {
        if (ctx.isAdmin && ctx.text && autonomy) {
            // 只記錄純對話（steps=0），有 loop 已由 writeLoopJournal 寫入
            if (steps.length === 0) {
                autonomy.appendJournal({
                    action: 'conversation',
                    preview: ctx.text.substring(0, 80)
                });
            }
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

        // ReAct Loop — 繼續執行
        if (action === 'REACT_CONTINUE') {
            if (!task || task.type !== 'REACT_CONTINUE') return ctx.reply('⚠️ 任務已失效');
            pendingTasks.delete(taskId);
            task.loopState.stepCount = 0; // 重置計數，再跑 MAX_AUTO_STEPS 步
            await ctx.reply('▶️ 繼續執行中...');
            await runReActLoop(ctx, task.steps || [], task.tainted, autonomy, task.loopState);
            return;
        }

        // ReAct Loop — 停止並彙整
        if (action === 'REACT_STOP') {
            if (!task) return ctx.reply('⚠️ 任務已失效');
            pendingTasks.delete(taskId);
            writeLoopJournal(task.loopState, autonomy);
            const summary = (task.loopState.stepLog || []).map(s => (s.ok ? '✅' : '❌') + ' ' + s.cmd).join('\n') || '(無執行記錄)';
            await ctx.reply('⏹️ 已停止。執行摘要：\n' + summary);
            return;
        }

        // ReAct Loop — DANGER 審批後繼續
        if (action === 'APPROVE' && task && task.type === 'REACT_DANGER_RESUME') {
            pendingTasks.delete(taskId);
            await ctx.reply('✅ 授權通過，繼續執行...');
            await ctx.sendTyping();
            await runReActLoop(ctx, task.steps, task.tainted, autonomy, task.loopState);
            return;
        }

        if (!task) return ctx.reply('⚠️ 任務已失效');
        if (action === 'DENY') {
            pendingTasks.delete(taskId);
            await ctx.reply('🛡️ 操作駁回');
        } else if (action === 'APPROVE') {
            // 舊式單步審批（非 ReAct）
            const { steps, nextIndex, tainted } = task;
            pendingTasks.delete(taskId);
            await ctx.reply('✅ 授權通過，執行中...');
            await ctx.sendTyping();
            const observation = await controller.runSequence(ctx, steps, nextIndex, tainted || false, nextIndex);
            if (observation) {
                const feedbackPrompt = loadFeedbackPrompt('APPROVED_FEEDBACK', { OBSERVATION: observation }) || `[Approved]\n${observation}\nReport in Traditional Chinese.`;
                const finalResponse = await brain.sendMessage(feedbackPrompt);
                const r2 = TriStreamParser.parse(finalResponse);
                if (r2.memory) await brain.memorize(r2.memory, { type: 'fact', timestamp: Date.now() });
                const r2Reply = r2.reply || (r2.hasStructuredTags ? null : finalResponse);
                if (r2Reply) await ctx.reply(r2Reply);
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
