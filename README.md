# 🤖 Forked-Golem

> **"I perceive, therefore I act."**
> **API 直連自律型 AI Agent，基於 [Project-Golem](https://github.com/Arvincreator/project-golem) 重新設計。**

Forked-Golem 是運行在低功耗硬體上的本機 AI Agent。透過 Gemini API 直連取代原作的 Puppeteer 瀏覽器自動化架構，將 RAM 佔用從 600MB+ 降至 ~80MB，適合在 ThinkPad X200 等老舊硬體上 24/7 運行。

支援 Telegram 與 Discord 雙平台，具備系統指令執行、視覺分析、長期記憶、模組化技能、自主認知循環與多層安全防護等能力。

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
    │   🧠 GolemBrain (Gemini API 直連)
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
    └─→ ♻️ Autonomy v2 (認知循環 + 自主決策)
            │
            ├─ 📖 soul.md (身份錨點)
            ├─ 📓 journal.jsonl (經驗日誌)
            └─ 🔍 GitHub Explorer (自主學習)
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
| 自主行為 | 隨機骰子 | 認知循環 (soul.md + journal + Gemini 決策) |
| 身份系統 | 硬編碼 | soul.md 動態注入 |

---

## 核心功能

**🧠 GolemBrain** — Gemini API 直連推理引擎。主對話使用 `gemini-2.5-flash-lite`，保留完整對話歷史（最近 20 輪）。

**⏳ Titan Queue** — 1.5 秒 debounce 視窗，自動合併使用者連發的碎片訊息為單次 API 呼叫，大幅節省 rate limit 配額。FIFO 序列化確保同時只有一個請求在處理。

**🗝️ KeyChain** — 多 API Key 輪替，帶節流控制（最小 2.5s 間隔）。碰到 429 自動標記冷卻：RPD 限制凍 15 分鐘，RPM 限制凍 90 秒，避免反覆撞牆。

**📜 SkillLoader** — 技能模組化架構。每個技能是 `skills.d/` 目錄下的獨立 `.md` 檔案，透過 YAML front matter 定義 metadata。高頻技能自動載入，低頻技能由關鍵字路由按需注入，減少 ~40% system prompt token 消耗。新增技能只需寫 `.md` 檔，不碰 JavaScript。

**⚓ Tri-Stream Protocol** — 每次回應拆解為記憶寫入（`[GOLEM_MEMORY]`）、行動執行（`[GOLEM_ACTION]`）、對話回覆（`[GOLEM_REPLY]`）三條串流，實現思考與行動並行。

**👁️ OpticNerve** — 透過 Gemini 2.5 Flash 分析圖片與文件。支援截圖解讀、程式碼轉錄、UI 結構分析。

**🛡️ SecurityManager v2** — 白名單/黑名單指令控制、Taint 標記防止 Prompt Injection、Flood Guard 防洪、過期訊息過濾。外部內容自動標記為 tainted，衍生的行動需人工審批。

**♻️ Autonomy v2** — 認知循環系統，取代舊版的隨機骰子。Golem 定期醒來，讀取 soul.md（身份錨點）和 journal（經驗日誌），由 Gemini 根據目標與經驗選擇行動：GitHub 探索、自我反思、主動社交或休息。每次行動後記錄結果到 journal，形成連續的自我敘事。

**📊 Dashboard** — blessed TUI 戰術控制台，即時監控系統狀態與 API 呼叫。支援 F12 detach/reattach，不中斷 Golem 運行。

---

## 身份系統

Forked-Golem 的身份由兩層構成：

**soul.md（基底層）** — Golem 的靈魂文件，定義身份、能力邊界、目標、價值觀與和使用者的關係。每次對話和自主行動時自動注入 system prompt。由使用者手動維護，Golem 不能自行修改。

**PersonaManager（覆蓋層）** — 透過 `/callme <名字>` 指令讓使用者快速自訂稱呼，不需要 SSH 進去改檔案。設定儲存在 `golem_persona.json`，僅覆蓋稱呼，不影響 soul.md 的其他內容。

Fork 後的自訂流程：

1. 編輯 `soul.md`，寫入你自己的身份設定（進階自訂）
2. 或直接在 Telegram 對話中使用 `/callme <你的名字>`（快速設定）

---

## 目錄結構

```
forked-golem/
├── index.js              # 核心邏輯 + 所有 class
├── skills.js             # PersonaManager + CORE_DEFINITION + SkillLoader
├── dashboard.js          # blessed TUI 戰術控制台
├── soul.md               # 靈魂文件（身份錨點，使用者維護）
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
├── memory/
│   ├── journal.jsonl     # 經驗日誌（每次自主行動追加）
│   └── explored-repos.json
├── golem_memory/         # 長期記憶 (Native FS)
├── .env                  # API Key 與 Token (不入版控)
└── package.json          # 版號由 npm version 管理
```

---

## 快速部署

### 1. 取得 Token

- **Gemini API Key**（必備，建議 3 把不同帳號）: [Google AI Studio](https://aistudio.google.com/app/apikey)
- **Telegram Token**（必填）: [@BotFather](https://t.me/BotFather)
- **Discord Token**（選填）: [Discord Developer Portal](https://discord.com/developers/applications)

### 2. 下載與安裝

```bash
git clone https://github.com/Golem-Beta/forked-golem.git
cd forked-golem
cp dotenv-sample .env
# 編輯 .env 填入你的 Token 和 API Key
npm install
```

### 3. 自訂身份

編輯 `soul.md`，把身份資訊改成你自己的設定。這份文件定義了 Golem 的人格、目標和行為準則。

或者跳過這步，啟動後在 Telegram 用 `/callme <你的名字>` 快速設定稱呼。

### 4. 啟動

```bash
# 戰術控制台模式（推薦）
npm start dashboard

# 標準模式
npm start
```

### 5. 技能管理

Golem 支援透過對話管理技能：

- `golem-skill list` — 列出所有已安裝技能
- `golem-skill load <名稱>` — 手動載入指定技能
- `golem-skill reload` — 重新掃描 skills.d/ 目錄

新增技能只需在 `skills.d/` 放入 `.md` 檔案，格式參考現有檔案。

---

## 版號管理

本專案使用 `npm version` 管理版號，一條指令自動更新 package.json、建立 git commit 與 tag：

```bash
npm version patch   # bug fix: 9.3.1 → 9.3.2
npm version minor   # 新功能: 9.3.1 → 9.4.0
npm version major   # 大改版: 9.3.1 → 10.0.0
git push && git push --tags
```

---

## 硬體需求

本專案為低功耗環境設計：

- CPU: Intel Core2 Duo 等級即可
- RAM: 4GB 以上
- OS: Linux（Arch/Debian/Ubuntu），支援 headless 無 GUI 環境
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
| v9.2.1 | 硬編碼版號修正 + README 更新 |
| v9.3.0 | Autonomy v2 Phase 1 — journal 基礎設施 |
| v9.3.1 | Autonomy v2 Phase 2+3 — GitHub 探索 + Gemini 決策引擎 + soul.md 身份系統統一 |

---

## 致謝

本專案基於 [Arvincreator](https://github.com/Arvincreator) 的 [Project-Golem](https://github.com/Arvincreator/project-golem) 發展而來。原作奠定了 Tri-Stream Protocol、雙模記憶引擎與戰術控制台等核心概念。

<a href="https://www.buymeacoffee.com/arvincreator" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee (Original Author)" style="height: 60px !important;width: 217px !important;" ></a>

---

## 免責聲明

1. **自行承擔風險**：本軟體具有執行 Shell 指令的權限，請謹慎授權高風險操作。
2. **帳號安全**：建議使用獨立 Google 帳號的 API Key 運行。
3. **隱私聲明**：所有記憶與資料皆儲存於本機設備。
