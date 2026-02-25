# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概覽

Forked-Golem 是一個模組化自律 AI Agent（Telegram/Discord 機器人），專為低資源硬體（ThinkPad X200，4GB RAM）設計。使用 LLM API 直連（非瀏覽器自動化），透過多供應商路由跨越 5 家以上 LLM 服務商。以純 JavaScript（CommonJS，Node.js >=18）撰寫，無 TypeScript。

## 指令

```bash
npm start                # 生產模式（512MB heap 上限）
npm start dashboard      # 附 blessed 終端儀表板
npm run dev              # nodemon 熱重載開發模式
node test-smoke.js       # 煙霧測試：模組可 require、export 合約、關鍵方法存在（exit 0=通過）
```

無正式測試框架（無 Jest/Mocha）。`test-smoke.js` 是唯一的自動驗證——確認 17 個模組可被 require、export 結構正確、關鍵方法存在，並對 `dashboard.js` 做語法驗證。

## 架構

### 入口點與模組組裝

`index.js` 是總協調器（~32KB）。負責串接所有 `src/` 模組、初始化 Telegram（grammy）+ Discord 客戶端，並管理「訊息 → brain → parser → action」整條流水線。

### 三流協定（核心通訊格式）

每個 LLM 回應由 `src/parsers.js` 解析為三個區段：

```
[GOLEM_MEMORY]    → 長期記憶寫入
[GOLEM_ACTION]    → JSON 陣列指令：[{"cmd": "..."}]
[GOLEM_REPLY]     → 使用者可見回覆
```

只有 Gemini 能可靠遵循此格式。此約束由 `src/model-router/intents.js` 強制執行：三流 intent（`chat`、`creative`、`reflection`、`code_edit`）僅走 Gemini，無其他 provider 的 fallback。非三流 intent（`decision`、`utility`、`analysis`）則可使用任意 provider（Groq、DeepSeek、Mistral、OpenRouter）。

### `src/` 關鍵模組

- **config.js** — 所有環境變數的唯一真相來源。所有模組皆從此 import。
- **brain.js** — `GolemBrain` 類別：LLM 對話、記憶讀寫、系統提示組裝。
- **model-router/** — 多供應商 LLM 路由（Gemini/Groq/DeepSeek/Mistral/OpenRouter）。以 Task Intent 選路，每家 provider 獨立健康追蹤，RPD 限制、429 退避。關鍵檔案：`intents.js`（intent→provider 矩陣）、`configs.js`（provider 設定）、`health.js`（健康追蹤器）、`adapters/`（Gemini 及 OpenAI 相容轉接器）。
- **autonomy/** — 自主行為系統（Composition 架構）。`AutonomyManager` 協調 `DecisionEngine`、`JournalManager`、`Notifier`、`ActionRunner`。`actions/` 子目錄有 6 種行動類型：`explore.js`（GitHub 探索）、`social.js`（主動社交）、`digest.js`（消化歸納），以及自我反思流水線分為 3 個檔案：`reflect.js`（協調器）→ `reflect-diag.js`（Phase 1：讀取程式碼並診斷）→ `reflect-patch.js`（Phase 2：以 `code_edit` intent 生成 patch）。
- **security.js** — `SecurityManager` v2：指令白名單/黑名單，外部內容 Taint 追蹤，危險等級分類。
- **executor.js** — `Executor`：沙盒 shell 指令執行器，per-session cwd 追蹤，封鎖禁用路徑（`/etc`、`/boot` 等）及互動式指令（`vim`、`htop` 等）。
- **parsers.js** — `TriStreamParser`（支援 emoji/ASCII 雙格式標籤、模糊 JSON 恢復）和 `ResponseParser`。
- **task-controller.js** — `TaskController`：循序指令執行、虛擬指令（`golem-schedule`、`golem-skill`）、審批工作流程。
- **node-router.js** — `NodeRouter`：快速路徑 slash 指令攔截器（`/help`、`/update`、`/donate`、`/status`）。在 LLM 流水線之前執行，零延遲回應內建指令。
- **context.js** — `UniversalContext`（跨平台訊息抽象）、`OpticNerve`（視覺）、`MessageManager`。
- **message-buffer.js** — Titan Queue：1.5 秒 debounce、per-chat 序列化、洪水防護。
- **chronos.js** — 排程管理器：setTimeout + JSON 持久化於 `memory/schedules.json`。
- **skills.js** — SkillLoader：從 `skills.d/` 載入帶有 YAML front matter 的 `.md` 技能檔。高頻自動載入，低頻按需路由。
- **memory-drivers.js** — `ExperienceMemory`、`SystemNativeDriver`、`SystemQmdDriver`。
- **upgrader.js** — `Introspection`（讀取自身源碼供自省用）、`PatchManager`（帶 `[KERNEL PROTECTED]` 區域保護的搜尋/替換）、`SystemUpgrader`（從 GitHub git pull）。
- **tools.js** — `ToolScanner`（透過 `which`/`where` 偵測系統工具）、`HelpManager`（反射 NodeRouter 源碼動態產生 `/help` 說明）。
- **prompt-loader.js** — 載入並渲染 `prompts/*.md` 模板，支援 `{{VAR}}` 替換。
- **dashboard.js** — blessed 終端儀表板（5 個面板：對話、三流協定、自主/Chronos 雷達、狀態列）。煙霧測試只做語法驗證，不 `require()`。

### 重要非程式碼檔案

- **soul.md** — 身份錨點文件。定義 Golem 的人格、價值觀、行動邊界。自主循環時由 DecisionEngine 讀取。
- **skills.d/*.md** — 10 個模組化技能（YAML front matter + markdown）。例如：`EVOLUTION.md`（自我修補）、`ACTOR.md`（人格扮演）、`CHRONOS.md`（排程）。
- **prompts/*.md** — 外部化 prompt 模板，支援 `{{VAR}}` 替換。`system-core.md` 為主系統指令。每個自主行為動作都有對應的獨立 prompt 檔（如 `spontaneous-chat.md`、`github-analysis.md`、`decision.md`、`web-research-topic.md`、`observation-feedback.md`）。`tristream-protocol.md` 標記為 PROTECTED，原文注入。
- **config/autonomy.json** — 自主行為時序設定（喚醒間隔、靜音時段、冷卻時間、行動權重）。
- **memory/** — 持久化執行時資料：`journal.jsonl`、`explored-repos.json`、`schedules.json`、`synthesis/`、`reflections/`。

## 程式碼慣例

- 4 空格縮排，CommonJS（`require`/`module.exports`）
- 註解與 commit message 使用繁體中文
- log 訊息使用 emoji 前綴（🧠 brain、🛡️ security、⚡ router 等）
- 變數/函數 camelCase，類別 PascalCase，常數 UPPERCASE
- 設定值一律透過 `src/config.js` 取得——其他模組不直接讀取 `process.env`
- 除錯日誌透過 `dbg()` 函數，以 `GOLEM_DEBUG=true` 啟用

## 如何擴展

- **新增 LLM 供應商**：在 `src/model-router/adapters/` 新增轉接器，在 `configs.js` 註冊，在 `intents.js` 加入相關 intent
- **新增自主行為動作**：在 `src/autonomy/actions/` 建立模組並 export 類別，在 `ActionRunner` 中註冊
- **新增 Intent**：在 `src/model-router/intents.js` 加入條目，附上 provider 偏好陣列
- **新增技能**：在 `skills.d/` 建立 `.md` 檔，附上 YAML front matter（`name`、`summary`、`auto_load`、`keywords`）
- **修改系統提示**：編輯 `prompts/system-core.md`（使用 `{{SOUL}}`、`{{PERSONA}}`、`{{VERSION}}` 替換）
