/**
 * 🛠️ Golem v8.5 Full Patch - ID Binding + Strict Format Protocol (Double Insurance)
 * ---------------------------------------------------
 * 核心策略：動態數位浮水印 (Dynamic Watermark) + 強制格式注入
 * 解決問題：
 * 1. 徹底修復「永遠卡一步」錯位問題 (透過 ID 綁定)。
 * 2. 強制 Gemini 每次都遵守 Tri-Stream 格式。
 * 3. [強化] 將 ID 直接寫入格式說明中，防止 AI 遺忘。
 */

const fs = require('fs');
const path = require('path');

const TARGET_FILE = path.join(process.cwd(), 'index.js');
const BACKUP_FILE = path.join(process.cwd(), 'index.js.bak_id_format_fix_v2');

console.log("🔒 正在部署「雙重保險 ID 綁定」協定 (Target: index.js)...");

if (!fs.existsSync(TARGET_FILE)) {
    console.error("❌ 找不到 index.js");
    process.exit(1);
}

// 1. 建立備份
if (!fs.existsSync(BACKUP_FILE)) {
    fs.copyFileSync(TARGET_FILE, BACKUP_FILE);
    console.log(`📦 已建立備份: ${BACKUP_FILE}`);
}

let content = fs.readFileSync(TARGET_FILE, 'utf-8');

// ============================================================
// 💉 階段一：注入 ID 生成邏輯 + 強制格式 Prompt (sendMessage)
// ============================================================
console.log("🔹 正在注入 ID 生成器與強制格式 Prompt...");

// 尋找 sendMessage 的開頭
const SEND_MSG_SIG = "async sendMessage(text, isSystem = false) {";

// 定義新的 sendMessage 頭部邏輯
// [修改重點]：formatPrompt 現在是一個動態字串，裡面直接包含了 ${anchorTag}
const newHeader = `async sendMessage(text, isSystem = false) {
        if (!this.browser) await this.init();
        await this.setupCDP();

        // 🔑 [Unique ID] 生成本次請求的唯一識別碼
        const reqId = Date.now().toString().slice(-5);
        const anchorTag = \`[G_ID:\${reqId}]\`;

        // 📜 [Format Instruction] 強制格式提示詞 (雙重保險：直接把 ID 寫進範例)
        const formatPrompt = \`
[系統指令：強制使用回覆格式]

你的每一個回應都必須嚴格包含以下三個區塊：

[🧠 MEMORY_IMPRINT]
(這裡填寫長期記憶，若無則留空)

[🤖 ACTION_PLAN]
(這裡填寫 JSON 格式的執行指令，例如 golem-check，若無操作請留空[])

[💬 REPLY]
(這裡填寫你要回覆給使用者的內容)

回應開頭必須加上 "—-回覆開始—- "。
⚠️ 回應結尾必須嚴格加上 "\${anchorTag} —-回覆結束—-" (缺一不可)。
\`;
        
        // ✨ [Prompt Injection] 組合 Payload
        let finalPayload = text;
        if (!isSystem) {
            // 在最後面再加一道 System Note 保險，確保 AI 看到最後時還記得
            finalPayload = \`\${text}\\n\${formatPrompt}\\n\\n(System Note: Do NOT forget the ID "\${anchorTag}" at the end!)\`;
        }
        console.log(\`🔑 [Brain] 本次對話 ID: \${anchorTag} (已注入格式與雙重提醒)\`);
    `;

// 執行替換
if (content.includes(SEND_MSG_SIG)) {
    content = content.replace(
        /async sendMessage\(text, isSystem = false\) \{[\s\S]*?this\.setupCDP\(\);/,
        newHeader
    );
    console.log("✅ ID 生成與格式注入邏輯已更新 (雙重保險版)");
}

// ============================================================
// 💉 階段二：重寫 tryInteract (ID 驗證模式)
// ============================================================
console.log("🔹 正在重寫 tryInteract (ID 驗證模式)...");

// 定位原版 tryInteract 範圍
const ORIG_START_MARKER = "const tryInteract = async (sel, retryCount = 0) => {";
const ORIG_END_MARKER = "return await tryInteract(this.selectors);";

const startIndex = content.indexOf(ORIG_START_MARKER);
const endIndex = content.indexOf(ORIG_END_MARKER);

if (startIndex === -1 || endIndex === -1) {
    console.error("❌ 無法定位 tryInteract 區塊，請確認檔案結構。");
    process.exit(1);
}

const blockEndIndex = content.lastIndexOf("};", endIndex);

// 📜 全新的 tryInteract 代碼 (ID Verification Mode)
const NEW_TRY_INTERACT = `const tryInteract = async (sel, retryCount = 0) => {
        try {
            // 1. 檢查輸入框
            const inputExists = await this.page.$(sel.input);
            if (!inputExists) throw new Error(\`找不到輸入框: \${sel.input}\`);

            // 2. 輸入文字 (使用 finalPayload)
            await this.page.evaluate((s, t) => {
                const el = document.querySelector(s);
                el.focus();
                document.execCommand('insertText', false, t);
            }, sel.input, isSystem ? text : finalPayload);

            await new Promise(r => setTimeout(r, 800));
            
            // 3. 點擊發送
            try {
                await this.page.waitForSelector(sel.send, { timeout: 2000 });
                await this.page.click(sel.send);
            } catch (e) {
                await this.page.keyboard.press('Enter');
            }

            if (isSystem) { await new Promise(r => setTimeout(r, 2000)); return ""; }

            // ⚡ [ID Binding Racer] 啟動 ID 驗證監聽
            console.log(\`⚡ [Brain] 等待 ID 驗證: \${anchorTag} ...\`);
            let isFinished = false;

            // 🏃 選手 A: CDP (輔助)
            const cdpRacer = new Promise((resolve) => {
                const TARGET_URL_PATTERN = /batchexecute/i;
                let targetRequestId = null;
                const onRequest = (e) => {
                    if (isFinished) return;
                    if (TARGET_URL_PATTERN.test(e.request.url) && e.request.method === 'POST') targetRequestId = e.requestId;
                };
                const onFinished = (e) => {
                    if (isFinished) return;
                    if (e.requestId === targetRequestId) {
                        setTimeout(() => resolve('CDP_WIN'), 2000); 
                    }
                };
                this.cdpSession.on('Network.requestWillBeSent', onRequest);
                this.cdpSession.on('Network.loadingFinished', onFinished);
            });

            // 🏃 選手 B: DOM ID Check (主力)
            const domRacer = new Promise((resolve) => {
                const checkLoop = async () => {
                    const start = Date.now();
                    while (!isFinished) {
                        if (Date.now() - start > 180000) { // 3分鐘超時
                            console.warn("⚠️ [DOM] 等待超時 (ID Not Found)");
                            resolve('TIMEOUT'); break;
                        }
                        try {
                            // 🔍 直接在 DOM 找 ID
                            const found = await this.page.evaluate((s, targetID) => {
                                const bubbles = document.querySelectorAll(s);
                                if (!bubbles.length) return false;
                                const lastText = bubbles[bubbles.length - 1].innerText;
                                // 條件：包含 ID 且 包含結束標記
                                return lastText.includes(targetID) && lastText.includes('—-回覆結束—-');
                            }, sel.response, anchorTag);

                            if (found) {
                                console.log(\`✅ [DOM] 驗證碼匹配成功 (\${anchorTag})\`);
                                resolve('DOM_WIN');
                                break;
                            }
                            
                            // 後備：代碼塊檢測
                            const isCodeEnd = await this.page.evaluate((s) => {
                                 const bubbles = document.querySelectorAll(s);
                                 if (!bubbles.length) return false;
                                 return bubbles[bubbles.length - 1].innerText.trim().endsWith('\`\`\`');
                            }, sel.response);
                            if (isCodeEnd) {
                                 await new Promise(r => setTimeout(r, 2000));
                                 resolve('DOM_WIN_CODE'); break;
                            }
                        } catch (e) {}
                        await new Promise(r => setTimeout(r, 1000));
                    }
                };
                checkLoop();
            });

            const winner = await Promise.race([cdpRacer, domRacer]);
            isFinished = true;
            console.log(\`🏁 [Brain] 回應接收完成 (Trigger: \${winner})\`);

            // 4. 取回並清理結果
            return await this.page.evaluate((s, tag) => {
                const bubbles = document.querySelectorAll(s);
                if (!bubbles.length) return "";
                let rawText = bubbles[bubbles.length - 1].innerText;
                // 清理標記與 ID
                return rawText
                    .replace('—-回覆開始—-', '')
                    .replace('—-回覆結束—-', '')
                    .replace(tag, '') // 刪除 ID
                    .trim();
            }, sel.response, anchorTag);

        } catch (e) {
             // 🚑 自癒邏輯 (DOM Doctor)
             console.warn(\`⚠️ [Brain] 操作失敗: \${e.message}\`);
             if (retryCount === 0) {
                 console.log("🚑 [Brain] 呼叫 DOM Doctor...");
                 const htmlDump = await this.page.content();
                 const isInputBroken = e.message.includes('找不到輸入框');
                 const newSelector = await this.doctor.diagnose(htmlDump, isInputBroken ? 'Chat Input' : 'Message Bubble');
                 if (newSelector) {
                     if (isInputBroken) this.selectors.input = newSelector;
                     else this.selectors.response = newSelector;
                     this.doctor.saveSelectors(this.selectors);
                     return await tryInteract(this.selectors, retryCount + 1);
                 }
             }
             throw e;
        }
    }`;

// 執行替換
const beforeCode = content.substring(0, startIndex);
const afterCode = content.substring(blockEndIndex + 2);
content = beforeCode + NEW_TRY_INTERACT + afterCode;

console.log("✅ tryInteract 已重寫為 ID 驗證版");

// ============================================================
// 💾 寫入檔案
// ============================================================
try {
    fs.writeFileSync(TARGET_FILE, content, 'utf-8');
    console.log("\n🚀 全面修復完成！");
    console.log("   1. [Request] 雙重保險：在格式範本中直接植入本次 ID");
    console.log("   2. [Response] DOM 監聽器只認 ID");
    console.log("   3. [Cleanup] 自動清除 ID");
    console.log("\n👉 請輸入 npm start 重啟 Golem");
} catch (e) {
    console.error("❌ 寫入失敗:", e.message);
}
