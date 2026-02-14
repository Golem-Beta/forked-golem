/**
 * 🔧 patch-titan-queue.js
 * ========================
 * Titan Queue：訊息防抖 + 序列化
 *
 * 功能：
 *   - 1.5 秒 debounce：使用者連發碎片訊息合併成一條再送 API
 *   - Per-chat buffer：每個 chatId 獨立計時
 *   - 圖片/文件訊息跳過 debounce，立即處理（但仍排隊）
 *   - isProcessing flag：同一個 chat 不並發打 API
 *   - 合併時保留最後一條訊息的 UniversalContext（確保 reply 回到正確 chat）
 *
 * 用法：
 *   cd ~/forked-golem && node patch-titan-queue.js
 *
 * 前提：grammy 遷移已完成 (v9.0.0+)
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(process.cwd(), 'index.js');

console.log("🔧 [Patch] Titan Queue 訊息防抖");
console.log("================================\n");

if (!fs.existsSync(TARGET)) {
    console.error("❌ 找不到 index.js");
    process.exit(1);
}

let code = fs.readFileSync(TARGET, 'utf-8');

// ============================================================
// 檢查是否已經套用過
// ============================================================
if (code.includes('class MessageBuffer')) {
    console.log("⏭️  Titan Queue 已存在，無需再次修補。");
    process.exit(0);
}

// ============================================================
// Step 0: 更新檔頭版號和特性說明
// ============================================================
console.log("[0/4] 更新檔頭版號...");

const OLD_HEADER = `/**
 * 🦞 Project Golem v8.5 (Neuro-Link Edition) - Donation Edition
 * ---------------------------------------------------
 * 架構：[Universal Context] -> [Node.js 反射層 + 雙模記憶引擎] <==> [Web Gemini 主大腦]
 * 特性：
 * 1. 🐍 Hydra Link: 同時支援 Telegram 與 Discord 雙平台 (Dual-Stack)。
 * 2. 🧠 Tri-Brain: 結合反射神經 (Node)、無限大腦 (Web Gemini)、精準技師 (API)。
 * 3. 🛡️ High Availability: 實作 DOM Doctor 自癒 (v2.0 緩存版) 與 KeyChain 輪動。
 * 4. ☁️ OTA Upgrader: 支援 \`/update\` 指令，自動從 GitHub 拉取最新代碼並熱重啟。
 * 5. 💰 Sponsor Core: 內建贊助連結與 \`/donate\` 指令，支持創造者。
 * 6. 👁️ Agentic Grazer: 利用 LLM 自主聯網搜尋新聞/趣聞，具備情緒與觀點分享能力。
 * 7. ⚓ Tri-Stream Anchors: (v8.0) 採用「三流協定」(Memory/Action/Reply)，實現多工並行。
 * 8. 🔍 Auto-Discovery: 實作工具自動探測協定，Gemini 可主動確認環境工具是否存在。
 * 9. 🔮 OpticNerve: 整合 Gemini 2.5 Flash 視神經，支援圖片與文件解讀。
 * 10. 🌗 Dual-Engine Memory: (v8.2) 支援 Browser (Transformers.js) 與 System (qmd) 兩種記憶核心切換。
 * 11. ⚡ Neuro-Link: (v8.5) 導入 CDP 網路神經直連，與 DOM 視覺進行雙軌並行監聽 (Dual-Track)，穩定性提升 99%。
 */`;

const NEW_HEADER = `/**
 * 🦞 Forked-Golem v9.1.0 (Direct-Link Edition)
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
 */`;

if (!code.includes('Project Golem v8.5 (Neuro-Link Edition)')) {
    console.log("⏭️  檔頭已非 v8.5 版本，跳過版號更新。");
} else {
    code = code.replace(OLD_HEADER, NEW_HEADER);
    console.log("✅ 檔頭已更新至 Forked-Golem v9.1.0");
}

// ============================================================
// Step 1: 在 GolemBrain class 之前插入 MessageBuffer class
// ============================================================
console.log("[1/4] 插入 MessageBuffer class...");

const BRAIN_MARKER = `// ============================================================
// 🧠 Golem Brain (API Direct) - Headless Edition
// ============================================================`;

if (!code.includes(BRAIN_MARKER)) {
    console.error("❌ 找不到 GolemBrain 區塊標記");
    console.error("   預期: '// 🧠 Golem Brain (API Direct) - Headless Edition'");
    process.exit(1);
}

const MESSAGE_BUFFER_CLASS = `// ============================================================
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
                this._enqueue(chatId, buf.texts.join('\\n'), buf.latestCtx, false);
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
            const merged = buf.texts.join('\\n');
            if (buf.texts.length > 1) {
                console.log(\`📦 [TitanQ] 合併 \${buf.texts.length} 條碎片訊息 → \${merged.length} chars (chat: \${chatId})\`);
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
            console.error(\`❌ [TitanQ] 處理失敗 (chat: \${chatId}): \${e.message}\`);
        } finally {
            buf.isProcessing = false;
            if (buf.queue.length > 0) {
                this._processNext(chatId);
            } else {
                this.buffers.delete(chatId);
            }
        }
    }
}

`;

code = code.replace(BRAIN_MARKER, MESSAGE_BUFFER_CLASS + BRAIN_MARKER);
console.log("✅ MessageBuffer class 已插入");

// ============================================================
// Step 2: 把 handleUnifiedMessage 改名，插入 wrapper
// ============================================================
console.log("\n[2/4] 改寫訊息入口...");

// 精確匹配原始函數頭（包含 stale check 和附件檢查）
const OLD_HANDLER_HEAD = `async function handleUnifiedMessage(ctx) {
    // 🛡️ [Flood Guard] 第一層防線：丟棄啟動前的離線堆積訊息
    if (isStaleMessage(ctx)) {
        const ageSec = ((Date.now() - ctx.messageTime) / 1000).toFixed(0);
        console.log(\`⏭️ [FloodGuard] 丟棄過期訊息 (\${ctx.platform}, age: \${ageSec}s)\`);
        return;
    }

    if (!ctx.text && !ctx.getAttachment()) return; // 沒文字也沒附件就退出`;

if (!code.includes(OLD_HANDLER_HEAD)) {
    console.error("❌ 找不到 handleUnifiedMessage 的函數頭");
    console.error("   請確認 index.js 裡的 handleUnifiedMessage 沒有被其他 patch 修改過");
    process.exit(1);
}

const NEW_HANDLER = `// 📦 [Titan Queue] 全域 buffer 實例
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
        console.log(\`⏭️ [FloodGuard] 丟棄過期訊息 (\${ctx.platform}, age: \${ageSec}s)\`);
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

    if (!ctx.text && !hasMedia) return; // 沒文字也沒附件就退出`;

code = code.replace(OLD_HANDLER_HEAD, NEW_HANDLER);
console.log("✅ handleUnifiedMessage 已拆分為 wrapper + core");

// ============================================================
// Step 3: 語法檢查
// ============================================================
console.log("\n[3/4] 驗證語法...");

const tempFile = TARGET + '.tmp_titan_check.js';
fs.writeFileSync(tempFile, code, 'utf-8');

try {
    require('child_process').execSync(`node -c "${tempFile}"`, { stdio: 'pipe' });
    console.log("✅ 語法檢查通過");
    fs.unlinkSync(tempFile);
} catch (e) {
    console.error("❌ 語法檢查失敗！不會寫入 index.js。");
    console.error("   錯誤內容：");
    const errMsg = e.stderr?.toString() || e.message;
    console.error(errMsg);
    console.error(`\n   暫存檔保留在: ${tempFile}`);
    console.error("   你可以用 node -c 手動檢查，或直接把錯誤訊息貼給我。");
    process.exit(1);
}

// ============================================================
// 寫入
// ============================================================
fs.writeFileSync(TARGET, code, 'utf-8');

console.log("\n🚀 Titan Queue 修補完成！");
console.log("   📋 檔頭版號已更新至 Forked-Golem v9.1.0 (Direct-Link Edition)");
console.log("   📦 MessageBuffer class 已加入");
console.log("   📦 handleUnifiedMessage → wrapper (debounce) + _handleUnifiedMessageCore");
console.log("   📦 1.5 秒合併窗口，碎片訊息自動合併");
console.log("   📦 圖片/附件跳過 debounce，立即處理");
console.log("   📦 Per-chat 序列化，同一 chat 不並發打 API");
console.log("\n📊 預期效果：");
console.log("   - 使用者連發 3 條碎片訊息 → 合併為 1 次 API 呼叫");
console.log("   - rate limit 消耗降低（碎片場景下）");
console.log("   - 回覆延遲 +1.5 秒（合併窗口等待時間）");
console.log("\n⚙️  可調參數（在 index.js 搜尋 titanQueue）：");
console.log("   debounceMs: 1500  →  調整合併窗口（毫秒）");
console.log("\n🧪 測試方式：");
console.log("   1. npm start");
console.log("   2. 在 Telegram 快速連發 3 條訊息（例如：「你好」「今天天氣」「如何」）");
console.log("   3. 觀察 console 是否出現：📦 [TitanQ] 合併 3 條碎片訊息");
console.log("   4. Golem 應該只回覆一次（合併後的內容）");
console.log("   5. 測試發圖片 → 應立即處理，不 debounce");
