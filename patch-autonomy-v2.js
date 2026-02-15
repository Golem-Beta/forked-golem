/**
 * 🔧 patch-autonomy-v2.js — Phase 1: 穩定基礎 + 經驗迴路
 * =========================================================
 *
 * 這個 patch 是 Golem 覺醒架構的第一步。
 *
 * 為什麼這些改動放在一起：
 *   Autonomy 是 Golem 唯一的自主驅動力。要讓它從「隨機行為產生器」
 *   進化為「有記憶的認知循環」，需要同時解決三件事：
 *   1. 基礎要穩（不然循環本身不可靠）
 *   2. 要能記住做過什麼（不然沒有成長）
 *   3. 要停止無意義的行動（不然浪費有限的 API 配額）
 *
 * 改動內容：
 *   [Bug Fix]  setTimeout 多重鏈疊加 — 加 this._timer 防護
 *   [移除]     performNewsChat — Gemini API 沒有 Search Grounding，假新聞沒意義
 *   [新增]     journal.jsonl 經驗迴路 — 每次行動後記錄，醒來時回顧
 *   [限制]     selfReflection — 每天最多 1 次（用 journal 時間戳判斷，重啟不遺忘）
 *   [調整]     醒來間隔 2~5h → 3~7h（降低頻率，每次更有意義）
 *   [準備]     CONFIG 加入 GITHUB_TOKEN（Phase 2 GitHub 探索用）
 *   [衛生]     建立 .gitignore（記憶檔案不推 GitHub）
 *
 * 不改的東西：
 *   - 決策仍用 Math.random()（Phase 3 才換 Gemini 決策）
 *   - soul.md 不在這個 phase（Phase 4）
 *   - performSpontaneousChat 核心邏輯不變（但加入 journal 回顧）
 *   - sendNotification 分流邏輯不變（之前已修好）
 *
 * 用法：cd ~/forked-golem && node patch-autonomy-v2.js
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(process.cwd(), 'index.js');

console.log("🔧 [Patch] Autonomy v2 — Phase 1: 穩定基礎 + 經驗迴路");
console.log("=========================================================\n");

if (!fs.existsSync(TARGET)) {
    console.error("❌ 找不到 index.js");
    process.exit(1);
}

let code = fs.readFileSync(TARGET, 'utf-8');

// ============================================================
// 定位 AutonomyManager class
// ============================================================
const CLASS_START = 'class AutonomyManager {';
const CLASS_END_MARKER = '// ============================================================\n// 🎮 Hydra Main Loop';

const startIdx = code.indexOf(CLASS_START);
const endIdx = code.indexOf(CLASS_END_MARKER);

if (startIdx === -1 || endIdx === -1) {
    console.error("❌ 找不到 AutonomyManager class 邊界");
    process.exit(1);
}

console.log(`[1/5] 找到 AutonomyManager: L${code.substring(0, startIdx).split('\n').length}`);

// ============================================================
// 新版 AutonomyManager
// ============================================================
console.log("[2/5] 替換 AutonomyManager...");

const NEW_AUTONOMY = `class AutonomyManager {
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
        this.scheduleNextAwakening();
    }

    // =========================================================
    // ⏰ 排程：3~7 小時隨機，凌晨休眠
    // =========================================================
    scheduleNextAwakening() {
        // 清除前一個 timer，防止多重鏈疊加
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }

        const waitMs = (3 + Math.random() * 4) * 3600000; // 3~7 小時
        const nextWakeTime = new Date(Date.now() + waitMs);
        const hour = nextWakeTime.getHours();
        let finalWait = waitMs;

        if (hour >= 1 && hour <= 7) {
            console.log("💤 Golem 決定睡個好覺，早上再找你。");
            const morning = new Date(nextWakeTime);
            morning.setHours(8, 0, 0, 0);
            if (morning < nextWakeTime) morning.setDate(morning.getDate() + 1);
            finalWait = morning.getTime() - Date.now();
        }

        console.log(\`♻️ [LifeCycle] 下次醒來: \${(finalWait / 60000).toFixed(1)} 分鐘後\`);
        this._timer = setTimeout(() => {
            this.manifestFreeWill();
            this.scheduleNextAwakening();
        }, finalWait);
    }

    // =========================================================
    // 📓 經驗日誌：讀取 / 寫入
    // =========================================================
    readRecentJournal(n = 10) {
        try {
            if (!fs.existsSync(this.journalPath)) return [];
            const lines = fs.readFileSync(this.journalPath, 'utf-8').trim().split('\\n');
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
            fs.appendFileSync(this.journalPath, JSON.stringify(record) + '\\n');
            console.log(\`📓 [Journal] 記錄: \${entry.action} → \${entry.outcome || 'done'}\`);
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
    // 🎲 自由意志（Phase 1: 仍用隨機，但有 journal 約束）
    // =========================================================
    async manifestFreeWill() {
        try {
            const roll = Math.random();

            if (roll < 0.15 && !this.hasActionToday('self_reflection')) {
                // 15% 機率 + 今天沒做過
                console.log("🧬 Golem 決定進行自我內省 (Evolution)...");
                await this.performSelfReflection();
            } else {
                // 85% 社交（Phase 2 會把一部分改為 GitHub 探索）
                console.log("💬 Golem 決定找主人聊天 (Social)...");
                await this.performSpontaneousChat();
            }
        } catch (e) {
            console.error("自由意志執行失敗 (已靜默):", e.message);
            this.appendJournal({ action: 'error', error: e.message });
        }
    }

    // =========================================================
    // 💬 主動社交
    // =========================================================
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

        const prompt = \`【任務】主動社交\\n【現在時間】\${timeStr} (\${contextNote})\\n【角色】\${skills.persona.get().currentRole}\\n【最近社交紀錄】\${recentSocial || '（無）'}\\n【情境】傳訊息給主人 (\${skills.persona.get().userName})。像真人一樣自然，包含對時間的感知。如果最近已經找過主人，換個話題。\`;
        const msg = await this.brain.sendMessage(prompt);
        await this.sendNotification(msg);

        this.appendJournal({
            action: 'spontaneous_chat',
            context: contextNote,
            outcome: 'sent'
        });
    }

    // =========================================================
    // 🧬 自我進化（每天最多 1 次，用 journal 判斷）
    // =========================================================
    async performSelfReflection(triggerCtx = null) {
        try {
            const currentCode = Introspection.readSelf();
            const advice = memory.getAdvice();
            const prompt = \`【任務】自主進化提案\\n【代碼】\\n\${currentCode.slice(0, 20000)}\\n【記憶】\${advice}\\n【要求】輸出 JSON Array。修改 skills.js 需標註 "file": "skills.js"。\`;
            const raw = await this.brain.sendMessage(prompt);
            const patches = ResponseParser.extractJson(raw);
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
                    const msgText = \`💡 **自主進化提案** (\${proposalType})\\n目標：\${targetName}\\n內容：\${patch.description}\`;
                    const options = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };
                    if (triggerCtx) { await triggerCtx.reply(msgText, options); await triggerCtx.sendDocument(testFile); }
                    else if (tgBot && CONFIG.ADMIN_IDS[0]) { await tgBot.api.sendMessage(CONFIG.ADMIN_IDS[0], msgText, options); await tgBot.api.sendDocument(CONFIG.ADMIN_IDS[0], new InputFile(testFile)); }

                    this.appendJournal({
                        action: 'self_reflection',
                        proposal: proposalType,
                        target: targetName,
                        description: patch.description,
                        outcome: 'proposed'
                    });
                } else {
                    this.appendJournal({
                        action: 'self_reflection',
                        proposal: proposalType,
                        outcome: 'verification_failed'
                    });
                }
            } else {
                this.appendJournal({
                    action: 'self_reflection',
                    outcome: 'no_patches_generated'
                });
            }
        } catch (e) {
            console.error("自主進化失敗:", e);
            this.appendJournal({ action: 'self_reflection', outcome: 'error', error: e.message });
        }
    }

    // =========================================================
    // 📨 發送通知（經過 Tri-Stream 分流）
    // =========================================================
    async sendNotification(msgText) {
        try {
            const parsed = TriStreamParser.parse(msgText);
            if (parsed.memory) {
                await this.brain.memorize(parsed.memory, { type: 'autonomy', timestamp: Date.now() });
            }
            const replyText = parsed.reply;
            if (!replyText) return;
            if (tgBot && CONFIG.ADMIN_IDS[0]) await tgBot.api.sendMessage(CONFIG.ADMIN_IDS[0], replyText);
            else if (dcClient && CONFIG.DISCORD_ADMIN_ID) {
                const user = await dcClient.users.fetch(CONFIG.DISCORD_ADMIN_ID);
                await user.send(replyText);
            }
        } catch (e) {
            console.warn("[Autonomy] 分流失敗，使用原始文字:", e.message);
            if (tgBot && CONFIG.ADMIN_IDS[0]) await tgBot.api.sendMessage(CONFIG.ADMIN_IDS[0], msgText);
        }
    }
}
`;

code = code.substring(0, startIdx) + NEW_AUTONOMY + code.substring(endIdx);
console.log("✅ AutonomyManager 已替換");

// ============================================================
// 確認 GITHUB_TOKEN 環境變數讀取
// ============================================================
console.log("\n[3/5] 確認 CONFIG.GITHUB_TOKEN...");

if (!code.includes('GITHUB_TOKEN')) {
    const dcAdminLine = code.indexOf("DISCORD_ADMIN_ID:");
    if (dcAdminLine !== -1) {
        const lineEnd = code.indexOf('\n', dcAdminLine);
        if (lineEnd !== -1) {
            const insertion = "\n    GITHUB_TOKEN: cleanEnv(process.env.GITHUB_TOKEN || ''),";
            code = code.substring(0, lineEnd) + insertion + code.substring(lineEnd);
            console.log("✅ CONFIG.GITHUB_TOKEN 已加入");
        }
    } else {
        console.log("⚠️  找不到 CONFIG 插入點，請手動加入 GITHUB_TOKEN");
    }
} else {
    console.log("⏭️  GITHUB_TOKEN 已存在");
}

// ============================================================
// 語法檢查
// ============================================================
console.log("\n[4/5] 語法檢查...");

const tempFile = TARGET + '.tmp_autonomy_check.js';
fs.writeFileSync(tempFile, code, 'utf-8');

try {
    require('child_process').execSync(`node -c "${tempFile}"`, { stdio: 'pipe' });
    console.log("✅ 語法檢查通過");
    fs.unlinkSync(tempFile);
} catch (e) {
    console.error("❌ 語法檢查失敗！不寫入。");
    console.error(e.stderr?.toString() || e.message);
    fs.unlinkSync(tempFile);
    process.exit(1);
}

// ============================================================
// 寫入 index.js
// ============================================================
fs.writeFileSync(TARGET, code, 'utf-8');
console.log("✅ index.js 已更新");

// ============================================================
// 建立 .gitignore
// ============================================================
console.log("\n[5/5] 建立 .gitignore + memory/ ...");

const gitignorePath = path.join(process.cwd(), '.gitignore');
const gitignoreContent = `# ============================================================
# Forked-Golem .gitignore
# ============================================================

# 依賴
node_modules/

# 環境設定（含 API keys）
.env

# 記憶與日誌（私人資料，不推 GitHub）
memory/
golem_learning.json
golem.log

# Patch 暫存檔
*.bak_*
*.tmp_*
index.test.js

# OS
.DS_Store
Thumbs.db
`;

if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, gitignoreContent);
    console.log("✅ .gitignore 已建立");
} else {
    const existing = fs.readFileSync(gitignorePath, 'utf-8');
    if (!existing.includes('memory/')) {
        fs.appendFileSync(gitignorePath, '\n# 記憶（私人資料）\nmemory/\n');
        console.log("✅ memory/ 已加入既有 .gitignore");
    } else {
        console.log("⏭️  .gitignore 已包含 memory/");
    }
}

// 建立 memory/ 目錄
const memDir = path.join(process.cwd(), 'memory');
if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
    console.log("✅ memory/ 目錄已建立");
}

// ============================================================
// 完成
// ============================================================
console.log("\n🚀 Autonomy v2 Phase 1 完成！");
console.log("   ✅ setTimeout 多重鏈 bug 修正");
console.log("   ✅ performNewsChat 移除");
console.log("   ✅ journal.jsonl 經驗迴路（讀/寫/每天限制）");
console.log("   ✅ selfReflection 每天最多 1 次");
console.log("   ✅ 醒來間隔 3~7 小時");
console.log("   ✅ CONFIG.GITHUB_TOKEN（Phase 2 準備）");
console.log("   ✅ .gitignore 建立");
console.log("   ✅ memory/ 目錄建立");
console.log("\n📋 部署：");
console.log("   npm start                    # 測試正常後：");
console.log("   git add -A");
console.log('   git commit -m "refactor: Autonomy v2 Phase 1 — journal + bugfix"');
console.log("   git tag v9.3.0");
console.log("   git push && git push origin v9.3.0");
console.log("\n📋 Phase 2 預告：");
console.log("   performGitHubExplore — 用 GitHub REST API 探索 AI/Agent repo");
console.log("   explored-repos.json 持久化");
console.log("   journal 記錄探索結果");
