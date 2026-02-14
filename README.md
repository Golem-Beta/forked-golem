# 🤖 Forked-Golem v9.2

> **"I perceive, therefore I act."**
> **API 直連自律型 AI Agent，基於 [Project-Golem](https://github.com/Arvincreator/project-golem) 重新設計。**

Forked-Golem 是運行在低功耗硬體上的本機 AI Agent。透過 Gemini API 直連取代原作的 Puppeteer 瀏覽器自動化架構，將 RAM 佔用從 600MB+ 降至 ~80MB，適合在 ThinkPad X200 等老舊硬體上 24/7 運行。

支援 Telegram 與 Discord 雙平台，具備系統指令執行、視覺分析、長期記憶、模組化技能、自主排程與多層安全防護等能力。

---

## 系統架構

```
使用者 (TG/DC)
    │
    ▼
⚡ Node.js 反射層 (grammy / discord.js)
    │
    ├─→ ⏳ Titan Queue (1.5s debounce + 序列化)
    │       │
    │       ▼
    │   🗝️ KeyChain (API Key 輪替 + 智慧冷卻)
    │       │
    │       ▼
    │   🧠 GolemBrain (Gemini 2.5 Flash-Lite 直連)
    │       │
    │       ▼
    │   ⚓ Tri-Stream Parser (三流解析)
    │       ├─ 📝 記憶流 → Native FS 記憶引擎
    │       ├─ 🤖 行動流 → Shell Executor (child_process)
    │       └─ 💬 回覆流 → 使用者
    │
    ├─→ 📜 SkillLoader (skills.d/ 按需載入)
    ├─→ 👁️ OpticNerve (Gemini 2.5 Flash 視覺分析)
    ├─→ 🛡️ SecurityManager v2 (白名單/黑名單/Taint 偵測)
    └─→ ♻️ Autonomy (自主排程/生命週期)
```

---

## 與原作的差異

| | Project-Golem (原作) | Forked-Golem |
|---|---|---|
| LLM 介面 | Puppeteer 操控 Web Gemini | Gemini API 直連 |
| RAM 佔用 | ~600MB+ | ~80MB |
| Telegram 庫 | node-telegram-bot-api | grammy + auto-retry |
| 瀏覽器依賴 | Chromium headless | 無 |
| API Key 管理 | 單 key | KeyChain 多 key 輪替 + 429 智慧冷卻 |
| 技能系統 | skills.js 單檔內嵌 | skills.d/ 模組化 .md 按需載入 |
| 訊息處理 | 逐條即時處理 | Titan Queue 防抖合併 |
| 安全防護 | 基礎 | SecurityManager v2 (Taint/Flood Guard) |

---

## 核心功能

**🧠 GolemBrain** — Gemini API 直連推理引擎。主對話使用 `gemini-2.5-flash-lite`（每日 1000 次免費額度），保留完整對話歷史（最近 20 輪）。

**⏳ Titan Queue** — 1.5 秒 debounce 視窗，自動合併使用者連發的碎片訊息為單次 API 呼叫，大幅節省 rate limit 配額。FIFO 序列化確保同時只有一個請求在處理。

**🗝️ KeyChain** — 多 API Key 輪替，帶節流控制（最小 2.5s 間隔）。碰到 429 自動標記冷卻：RPD 限制凍 15 分鐘，RPM 限制凍 90 秒，避免反覆撞牆。

**📜 SkillLoader** — 技能模組化架構。每個技能是 `skills.d/` 目錄下的獨立 `.md` 檔案，透過 YAML front matter 定義 metadata。高頻技能（MEMORY/CODE/SYS/TOOL）自動載入，低頻技能由關鍵字路由按需注入，減少 ~40% system prompt token 消耗。新增技能只需寫 `.md` 檔，不碰 JavaScript。

**⚓ Tri-Stream Protocol** — 每次回應拆解為記憶寫入（`[GOLEM_MEMORY]`）、行動執行（`[GOLEM_ACTION]`）、對話回覆（`[GOLEM_REPLY]`）三條串流，實現思考與行動並行。

**👁️ OpticNerve** — 透過 Gemini 2.5 Flash 分析圖片與文件。支援截圖解讀、程式碼轉錄、UI 結構分析。

**🛡️ SecurityManager v2** — 白名單/黑名單指令控制、Taint 標記防止 Prompt Injection、Flood Guard 防洪、過期訊息過濾。外部內容自動標記為 tainted，衍生的行動需人工審批。

**♻️ Autonomy** — 自主生命週期排程，定時醒來執行自我反思或探索。

**📊 Dashboard** — blessed TUI 戰術控制台，即時監控系統狀態與 API 呼叫。支援 F12 detach/reattach，不中斷 Golem 運行。

---

## 目錄結構

```
forked-golem/
├── index.js              # 核心邏輯 + 關鍵字路由
├── skills.js             # PersonaManager + CORE_DEFINITION + SkillLoader
├── dashboard.js          # blessed TUI 戰術控制台
├── skills.d/             # 模組化技能目錄
│   ├── MEMORY_ARCHITECT.md
│   ├── CODE_WIZARD.md
│   ├── SYS_ADMIN.md
│   ├── TOOL_EXPLORER.md
│   ├── GIT_MASTER.md
│   ├── OPTIC_NERVE.md
│   ├── EVOLUTION.md
│   ├── ACTOR.md
│   └── CLOUD_OBSERVER.md
├── golem_memory/         # 長期記憶 (Native FS)
├── .env                  # API Key 與 Token (不入版控)
└── patch-*.js            # 遷移腳本歸檔
```

---

## 快速部署

### 1. 取得 Token

- **Gemini API Key** (必備，建議 3 把不同帳號): [Google AI Studio](https://aistudio.google.com/app/apikey)
- **Telegram Token** (必填): [@BotFather](https://t.me/BotFather)
- **Discord Token** (選填): [Discord Developer Portal](https://discord.com/developers/applications)

### 2. 下載與安裝

```bash
git clone https://github.com/Golem-Beta/forked-golem.git
cd forked-golem
cp dotenv-sample .env
# 編輯 .env 填入你的 Token 和 API Key
npm install
```

### 3. 啟動

```bash
# 戰術控制台模式 (推薦)
npm start dashboard

# 標準模式 (背景執行)
npm start
```

### 4. 技能管理

Golem 支援透過對話管理技能：

- `golem-skill list` — 列出所有已安裝技能
- `golem-skill load <名稱>` — 手動載入指定技能
- `golem-skill reload` — 重新掃描 skills.d/ 目錄

新增技能只需在 `skills.d/` 放入 `.md` 檔案，格式參考現有檔案。

---

## 硬體需求

本專案為低功耗環境設計：

- CPU: Intel Core2 Duo 等級即可
- RAM: 4GB 以上
- OS: Linux (Arch/Debian/Ubuntu)，支援 headless 無 GUI 環境
- 網路: 需連接外網（Gemini API + Telegram/Discord）

---

## 版本歷程

| 版本 | 重點 |
|------|------|
| v8.5-final | 回退基準 (pre-grammy) |
| v9.0.0 | grammy 遷移，移除 Puppeteer (-4000 行) |
| v9.1.0 | SecurityManager v2 + Flood Guard |
| v9.1.1 | 429 智慧退避 + hotfix |
| v9.2.0 | skills.d/ 模組化 + Titan Queue + ASCII Tri-Stream |

---

## 致謝

本專案基於 [Arvincreator](https://github.com/Arvincreator) 的 [Project-Golem](https://github.com/Arvincreator/project-golem) 發展而來。原作奠定了 Tri-Stream Protocol、雙模記憶引擎與戰術控制台等核心概念。

<a href="https://www.buymeacoffee.com/arvincreator" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee (Original Author)" style="height: 60px !important;width: 217px !important;" ></a>

---

## 免責聲明

1. **自行承擔風險**：本軟體具有執行 Shell 指令的權限，請謹慎授權高風險操作。
2. **帳號安全**：建議使用獨立 Google 帳號的 API Key 運行。
3. **隱私聲明**：所有記憶與資料皆儲存於本機設備。
