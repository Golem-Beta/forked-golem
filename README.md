# 🤖 Forked-Golem

> **自律型 AI Agent — 運行在 ThinkPad X200 上的多模型驅動本地代理人**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Forked from [Arvincreator/project-golem](https://github.com/Arvincreator/project-golem) — 從 Puppeteer 瀏覽器自動化完全重構為 **API 直連 + 多供應商路由架構**，專為低資源硬體設計。

---

## 與原版的關鍵差異

| | 原版 Project-Golem v8.6 | Forked-Golem v9.8 |
|---|---|---|
| **LLM 連線** | Puppeteer → Web Gemini | 5 家 API 直連 + 智慧路由 |
| **Telegram** | node-telegram-bot-api | grammy (auto-retry) |
| **RAM 佔用** | ~600MB (Chrome + Puppeteer) | ~80MB |
| **架構** | 2000+ 行單檔 | 模組化 `src/` (18 個模組) |
| **安全** | 無 | SecurityManager v2 (白名單/黑名單/Taint) |
| **技能系統** | 單一 skills.js | skills.d/ 模組化 + 動態載入 |
| **自主行為** | 無 | Autonomy v2 — Gemini 決策引擎 + Composition 架構 |
| **身份系統** | 無 | soul.md 靈魂文件 + journal 經驗迴路 + 消化歸納 |
| **時間排程** | IndexedDB (瀏覽器) | Chronos — setTimeout + JSON 持久化 |
| **LLM 供應商** | Gemini 單一 | Gemini / Groq / DeepSeek / Mistral / OpenRouter |
| **網路搜尋** | 無 | Google Search grounding + 自主 web_research |
| **日誌搜尋** | 無 | FlexSearch 全文索引 |

---

## 系統架構

```
                    ┌──────────────┐
                    │  👤 使用者    │
                    │  (Telegram)  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  grammy Bot  │
                    │  + Titan Q   │ ← 1.5s debounce 防抖
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  GolemBrain  │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │      ModelRouter        │
              │  (Task Intent 路由)     │
              ├─────┬─────┬─────┬──────┤
              │Gemini│Groq │Deep │Mistr │ ← 5 provider 自動選路
              │     │     │Seek │al/OR │
              └─────┴─────┴─────┴──────┘
                           │
                    ┌──────▼───────┐
                    │ TriStream    │
                    │ Parser       │
                    ├──────────────┤
                    │📝 Memory     │→ 長期記憶
                    │🤖 Action     │→ SecurityManager → Shell
                    │💬 Reply      │→ 使用者
                    └──────────────┘

              ┌─────────────────────────┐
              │     Autonomy v2         │
              │  (Composition 架構)     │
              ├─────────────────────────┤
              │ DecisionEngine          │← 讀 soul.md + journal
              │ ActionRunner            │← github_explore / self_reflection
              │   ├ digest              │   spontaneous_chat / web_research
              │   └ rest                │
              │ Notifier                │← TG/Discord 雙平台
              │ JournalManager          │← 經驗迴路 + FlexSearch
              └─────────────────────────┘
```

---

## 核心功能

**ModelRouter** — 多供應商 LLM 智慧路由。支援 Gemini、Groq、DeepSeek、Mistral、OpenRouter 五家供應商，以 Task Intent（chat / analysis / vision / decision 等）自動匹配最佳 provider + model。每家 provider 獨立健康追蹤，API Key 多把輪替，429/503 指數退避，RPD 耗盡自動 fallback。使用者只需在 `.env` 填入 key。

**Autonomy v2** — 自主行為系統（Composition 架構）。Golem 每隔約 30-60 分鐘自動醒來，由 `DecisionEngine` 讀取 `soul.md` 和 `journal.jsonl`，讓 LLM 從六種行動中選擇：GitHub 專案探索、自我反思（兩階段 patch 生成）、主動社交、網路研究、消化歸納（digest）、或休息。所有決策有依據，記錄到 journal 形成經驗迴路。

**Digest** — 消化歸納。自主回顧近期經驗日誌、探索紀錄和反思報告，由 LLM 產出結構化洞察文件，存入 `memory/synthesis/`，提煉模式而非堆積碎片。

**Chronos Timekeeper** — 時間排程系統。支援自然語言排程，`setTimeout` 精確觸發 + JSON 持久化，重啟後自動恢復，過期排程立即補發。

**SecurityManager v2** — CMD 白名單控制可執行指令，外部內容 Taint 標記防止 prompt injection，黑名單阻擋危險操作。

**SkillLoader** — `skills.d/` 目錄下 10 個 `.md` 技能檔案按需載入，高頻技能自動注入，低頻技能關鍵字路由，system prompt token 減少約 40%。

**Titan Queue** — 1.5 秒 debounce 合併碎片訊息，FIFO 序列化處理，防止連發造成 API 浪費。

---

## 快速部署

```bash
git clone https://github.com/Golem-Beta/forked-golem.git
cd forked-golem
npm install
cp .env.sample .env   # 編輯填入你的 API key 和 Telegram token
```

**設定 `.env`：**
```
# 必填
GEMINI_API_KEYS=key1,key2,key3
TELEGRAM_TOKEN=your_telegram_bot_token
ADMIN_ID=your_telegram_user_id

# 選填（有就自動啟用）
GROQ_API_KEYS=your_groq_key
DEEPSEEK_API_KEY=your_deepseek_key
MISTRAL_API_KEY=your_mistral_key
OPENROUTER_API_KEY=your_openrouter_key
GITHUB_TOKEN=your_github_token
GITHUB_REPO=YourOrg/your-forked-repo
```

**自訂身份（選填）：** 編輯 `soul.md` 賦予你的 Golem 獨特的身份、目標和價值觀。

**啟動：**
```bash
npm start              # Telegram bot 模式
npm start dashboard    # blessed 終端儀表板（推薦）
```

---

## 目錄結構

```
forked-golem/
├── index.js                  # 入口 + 組裝器
├── src/                      # 模組化架構 (v9.8)
│   ├── config.js             # 環境變數集中地
│   ├── brain.js              # GolemBrain — LLM 對話 + RAG
│   ├── parsers.js            # TriStreamParser + ResponseParser
│   ├── security.js           # SecurityManager v2
│   ├── executor.js           # Shell 執行 + 安全檢查
│   ├── task-controller.js    # 指令執行控制
│   ├── chronos.js            # 時間排程
│   ├── context.js            # 跨平台訊息上下文
│   ├── message-buffer.js     # Titan Queue 防抖
│   ├── memory-drivers.js     # 記憶引擎 (Native / QMD)
│   ├── node-router.js        # /help /status 等指令路由
│   ├── prompt-loader.js      # prompt 模板載入
│   ├── upgrader.js           # 自動升級 + 自省 + Patch
│   ├── tools.js              # 工具掃描 + 說明生成
│   ├── dashboard.js          # blessed 終端儀表板
│   ├── skills.js             # SkillLoader
│   ├── model-router/         # 多供應商 LLM 路由
│   │   ├── index.js          # ModelRouter 核心
│   │   ├── health.js         # Provider 健康追蹤
│   │   ├── intents.js        # Task Intent 定義
│   │   ├── configs.js        # Provider 設定
│   │   └── adapters/         # Gemini / OpenAI-compat 轉接
│   └── autonomy/             # Autonomy v2 (Composition)
│       ├── index.js           # AutonomyManager 組裝
│       ├── decision.js        # DecisionEngine
│       ├── actions.js         # ActionRunner (6 種行動)
│       ├── journal.js         # JournalManager + FlexSearch
│       └── notify.js          # Notifier (TG/Discord)
├── soul.md                   # 靈魂文件 — 身份錨點
├── skills.d/                 # 10 個模組化技能
├── prompts/                  # 外部化 prompt 模板
├── memory/
│   ├── journal.jsonl         # 經驗日誌
│   ├── explored-repos.json   # 已探索的 GitHub repo
│   ├── schedules.json        # Chronos 排程
│   ├── reflections/          # 自省報告
│   └── synthesis/            # 消化歸納文件
├── test-smoke.js             # 模組完整性驗證
├── .env.sample
├── package.json
└── LICENSE
```

---

## 硬體需求

設計目標是在低資源設備上穩定運行：

- **CPU**: Intel Core2 Duo 等級即可
- **RAM**: 4GB 足夠（實際佔用 ~80-130MB）
- **OS**: 任何支援 Node.js 的 Linux 發行版
- **網路**: 需連接 LLM API

開發環境使用 ThinkPad X200 (P8600, 4GB RAM, Arch Linux headless, TTY-only)。

---

## 版號管理

遵循 SemVer：`MAJOR.MINOR.PATCH`

- v9.0.0 = grammy 遷移基準
- MINOR = 新功能
- PATCH = bug fix

---

## 版本歷程

| 版本 | 內容 |
|------|------|
| v8.5-final | 回退基準 (pre-grammy) |
| v9.0.0 | grammy 遷移 — 移除 Puppeteer，API 直連 |
| v9.1.x | SecurityManager v2 + Flood Guard + 429 智慧退避 |
| v9.2.x | skills.d/ 模組化 + Titan Queue + ASCII Tri-Stream |
| v9.3.x | Autonomy v2 — journal 經驗迴路 + GitHub 探索 + Gemini 決策 + soul.md |
| v9.4.x | Chronos 時間排程 |
| v9.5.x | Autonomy 設定檔外部化 + EVOLUTION v2 + self_reflection pipeline + 靜音模式 |
| v9.6.x | FlexSearch journal 全文搜尋 + 社交回饋迴路 + web_research + Google Search grounding |
| v9.7.x | ModelRouter 多供應商路由 (Gemini/Groq/DeepSeek/Mistral/OpenRouter) + digest 消化歸納 |
| v9.8.0 | index.js 模組拆分 → `src/` 18 模組 + Autonomy Composition 架構 + smoke test |

---

## 致謝

- [Arvincreator/project-golem](https://github.com/Arvincreator/project-golem) — 原版 Project Golem
- Google Gemini API — 主要推理引擎
- [grammy](https://grammy.dev/) — Telegram Bot Framework
- Groq / DeepSeek / Mistral / OpenRouter — 備援 LLM 供應商

---

## License

MIT
