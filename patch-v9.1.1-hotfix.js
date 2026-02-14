/**
 * 🔧 patch-v9.1.1-hotfix.js
 * ===========================
 * v9.1.0 Hotfix：修復三個問題
 *
 * Fix 1: Titan Queue debounce 競爭條件
 *   症狀：連發 4 條碎片訊息，只有前 2 條合併，後 2 條各自獨立觸發 API
 *   原因：_processNext 完成後立刻出隊下一個，沒等 debounce timer 合併新碎片
 *   修正：完成後檢查 texts buffer，有碎片在等就暫停出隊
 *
 * Fix 2: Tri-Stream Protocol 改用純 ASCII 標籤
 *   症狀：Gemini 把 [💬 REPLY] 寫成 [🤖 REPLY]，parser 誤歸為 ACTION，
 *         raw response 洩漏給使用者
 *   根因：emoji 標籤是機器對機器協定，Gemini 對 emoji 處理不穩定
 *   修正：system prompt 改用 [GOLEM_MEMORY] / [GOLEM_ACTION] / [GOLEM_REPLY]
 *         parser 保留 emoji 格式 fallback（雙保險）
 *         type 判斷順序改為 REPLY 優先於 ACTION
 *
 * Fix 3: TAG_RE 擴展 + type 判斷順序修正（fallback 保險）
 *
 * 用法：
 *   cd ~/forked-golem && node patch-v9.1.1-hotfix.js
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(process.cwd(), 'index.js');

console.log("🔧 [Hotfix] v9.1.1 — Titan Queue + Tri-Stream ASCII 協定");
console.log("============================================================\n");

if (!fs.existsSync(TARGET)) {
    console.error("❌ 找不到 index.js");
    process.exit(1);
}

let code = fs.readFileSync(TARGET, 'utf-8');

// ============================================================
// 檢查前提
// ============================================================
if (!code.includes('class MessageBuffer')) {
    console.error("❌ 找不到 MessageBuffer class，請先套用 patch-titan-queue.js");
    process.exit(1);
}

let fixCount = 0;

// ============================================================
// Fix 1: Titan Queue — 重寫 _processNext 邏輯
// ============================================================
console.log("[1/4] 修正 Titan Queue debounce 競爭條件...");

const OLD_PROCESS_NEXT = `    async _processNext(chatId) {
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
    }`;

const NEW_PROCESS_NEXT = `    async _processNext(chatId) {
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

            // 🔧 [v9.1.1] 修正競爭條件：
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
    }`;

if (!code.includes(OLD_PROCESS_NEXT)) {
    console.error("❌ 找不到 _processNext 原始程式碼");
    process.exit(1);
}

code = code.replace(OLD_PROCESS_NEXT, NEW_PROCESS_NEXT);
console.log("✅ _processNext 競爭條件已修正");
fixCount++;

// ============================================================
// Fix 2: System Prompt — Tri-Stream 改用純 ASCII 標籤
// ============================================================
console.log("\n[2/4] 遷移 Tri-Stream Protocol 至 ASCII 標籤...");

const OLD_PROTOCOL = `const protocol = \`
【⚠️ 系統通訊協定 v9.0 - API Direct Mode】
1. **Tri-Stream Anchors (三流協定)**:
你的每一個回應都必須包含以下三個區塊（若該區塊無內容可留空，但標籤務必保留）：

[🧠 MEMORY_IMPRINT]
(長期記憶寫入。若無則留空。)

[🤖 ACTION_PLAN]
(JSON Array，每個步驟只有 "cmd" 欄位。嚴禁使用 "command"、"shell"、"action" 等其他欄位名。)
(範例：[{"cmd": "ls -la ~"}, {"cmd": "golem-check python"}])
(若無操作：[])

[💬 REPLY]
(回覆給使用者的內容。)

2. **Auto-Discovery Protocol**: 使用 golem-check <工具名> 來確認環境。
3. 不需要任何開頭或結尾錨點標記，直接輸出三流內容即可。
\`;`;

const NEW_PROTOCOL = `const protocol = \`
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
\`;`;

if (!code.includes(OLD_PROTOCOL)) {
    console.error("❌ 找不到 Tri-Stream protocol 字串");
    console.error("   預期在 GolemBrain.init() 內的 const protocol = ...");
    process.exit(1);
}

code = code.replace(OLD_PROTOCOL, NEW_PROTOCOL);
console.log("✅ Tri-Stream 協定已遷移至 ASCII 標籤");
console.log("   [GOLEM_MEMORY] / [GOLEM_ACTION] / [GOLEM_REPLY]");
fixCount++;

// ============================================================
// Fix 3: TriStreamParser — TAG_RE 擴展 + type 判斷修正 (fallback)
// ============================================================
console.log("\n[3/4] 強化 TriStreamParser fallback 容錯...");

// Part 3a: TAG_RE — 增加 [🤖 REPLY] 作為 fallback（萬一 Gemini 不聽話還是用 emoji）
const OLD_TAG_RE = `const TAG_RE = /\\[(?:🧠\\s*MEMORY_IMPRINT|🤖\\s*ACTION_PLAN|💬\\s*REPLY|GOLEM_MEMORY|GOLEM_ACTION|GOLEM_REPLY)\\]([\\s\\S]*?)(?=\\[(?:🧠\\s*MEMORY_IMPRINT|🤖\\s*ACTION_PLAN|💬\\s*REPLY|GOLEM_MEMORY|GOLEM_ACTION|GOLEM_REPLY)\\]|$)/gi;`;

const NEW_TAG_RE = `const TAG_RE = /\\[(?:🧠\\s*MEMORY_IMPRINT|🤖\\s*ACTION_PLAN|(?:💬|🤖)\\s*REPLY|GOLEM_MEMORY|GOLEM_ACTION|GOLEM_REPLY)\\]([\\s\\S]*?)(?=\\[(?:🧠\\s*MEMORY_IMPRINT|🤖\\s*ACTION_PLAN|(?:💬|🤖)\\s*REPLY|GOLEM_MEMORY|GOLEM_ACTION|GOLEM_REPLY)\\]|$)/gi;`;

if (!code.includes(OLD_TAG_RE)) {
    console.error("❌ 找不到 TAG_RE 原始定義");
    process.exit(1);
}

code = code.replace(OLD_TAG_RE, NEW_TAG_RE);
console.log("✅ TAG_RE 已擴展（emoji fallback 雙保險）");

// Part 3b: type 判斷 — REPLY 優先於 ACTION
const OLD_TYPE_LOGIC = `            // 判斷類型
            let type;
            if (/MEMORY/i.test(header)) type = 'M';
            else if (/ACTION/i.test(header)) type = 'A';
            else type = 'R';`;

const NEW_TYPE_LOGIC = `            // 判斷類型 (v9.1.1: REPLY 優先判斷，避免 [🤖 REPLY] 被誤歸為 ACTION)
            let type;
            if (/MEMORY/i.test(header)) type = 'M';
            else if (/REPLY/i.test(header)) type = 'R';
            else if (/ACTION/i.test(header)) type = 'A';
            else type = 'R';`;

if (!code.includes(OLD_TYPE_LOGIC)) {
    console.error("❌ 找不到 type 判斷邏輯");
    process.exit(1);
}

code = code.replace(OLD_TYPE_LOGIC, NEW_TYPE_LOGIC);
console.log("✅ Type 判斷順序已修正（REPLY > ACTION）");
fixCount++;

// ============================================================
// 更新版號
// ============================================================
if (code.includes('Forked-Golem v9.1.0')) {
    code = code.replace('Forked-Golem v9.1.0', 'Forked-Golem v9.1.1');
    console.log("\n✅ 版號更新至 v9.1.1");
} else if (code.includes('Project Golem v8.5')) {
    console.log("\n⏭️  Header 版號非 v9.1.0，跳過版號更新");
}

// ============================================================
// Step 4: 語法檢查
// ============================================================
console.log("\n[4/4] 驗證語法...");

const tempFile = TARGET + '.tmp_hotfix_check.js';
fs.writeFileSync(tempFile, code, 'utf-8');

try {
    require('child_process').execSync(`node -c "${tempFile}"`, { stdio: 'pipe' });
    console.log("✅ 語法檢查通過");
    fs.unlinkSync(tempFile);
} catch (e) {
    console.error("❌ 語法檢查失敗！不會寫入 index.js。");
    console.error(e.stderr?.toString() || e.message);
    fs.unlinkSync(tempFile);
    process.exit(1);
}

// ============================================================
// 寫入
// ============================================================
fs.writeFileSync(TARGET, code, 'utf-8');

console.log(`\n🚀 v9.1.1 Hotfix 完成！(${fixCount} 項修正)`);
console.log("   🔧 Fix 1: Titan Queue _processNext 不再跟 debounce 競爭");
console.log("   🔧 Fix 2: Tri-Stream Protocol 改用 ASCII 標籤（主路徑不再依賴 emoji）");
console.log("      [GOLEM_MEMORY] / [GOLEM_ACTION] / [GOLEM_REPLY]");
console.log("   🔧 Fix 3: Parser 保留 emoji fallback + REPLY 優先判斷（雙保險）");
console.log("\n🧪 測試方式：");
console.log("   1. npm start");
console.log("   2. 快速連發 5 條單字訊息 → 預期全部合併為 1 次 API 呼叫");
console.log("   3. Golem 回覆不應包含任何 [GOLEM_*] 或 [🧠][🤖][💬] 標籤");
console.log("   4. 觀察 console log 的 [Raw] 區段，標籤應為 [GOLEM_REPLY] 而非 [💬 REPLY]");
console.log("\n👉 git add -A && git commit -m 'fix: TitanQ race + ASCII TriStream protocol' && git tag v9.1.1");
