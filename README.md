# 🤖 Forked-Golem

> **自律型 AI Agent — 運行在本地實體機器上的多模型驅動自主代理人**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Forked from [Arvincreator/project-golem](https://github.com/Arvincreator/project-golem) — 從 Puppeteer 瀏覽器自動化完全重構為 **API 直連 + 多供應商路由架構**，專為低資源硬體設計。

---

## 與原版的關鍵差異

| | 原版 Project-Golem v8.6 | Forked-Golem v9.12 |
|---|---|---|
| **LLM 連線** | Puppeteer → Web Gemini | 7 家 API 直連 + 智慧路由 |
| **Telegram** | node-telegram-bot-api | grammy (auto-retry) |
| **RAM 佔用** | ~600MB (Chrome + Puppeteer) | ~90MB |
| **架構** | 2000+ 行單檔 | 模組化 `src/` (25+ 模組) |
| **安全** | 無 | SecurityManager v2 (白名單/黑名單/Taint) |
| **技能系統** | 單一 skills.js | skills.d/ 模組化 + 動態載入 |
| **自主行為** | 無 | Autonomy v2 — 多 LLM 決策引擎 + 10 種行動 |
| **身份系統** | 無 | soul.md 靈魂文件 + journal 經驗迴路 + 消化歸納 |
| **時間排程** | IndexedDB (瀏覽器) | Chronos — setTimeout + JSON 持久化 |
| **LLM 供應商** | Gemini 單一 | Gemini / Groq / DeepSeek / Mistral / OpenRouter / Cerebras / SambaNova |
| **網路搜尋** | 無 | Google Search grounding + 自主 web_research |
| **自我修復** | 無 | self_reflection — 兩階段診斷 + patch 生成 + smoke gate |
| **Google 整合** | 無 | GCP OAuth — Gmail / Calendar / Drive / Tasks |
| **數位身份** | 無 | 獨立 Google 帳號 + X (Twitter) 發文能力 |
| **維護系統** | 無 | MaintenanceRunner — 零 LLM 自維護 actions |

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
              ├──┬──┬──┬──┬──┬──┬──────┤
              │G │Gr│DS│Mi│OR│Ce│SN    │ ← 7 provider 自動選路
              └──┴──┴──┴──┴──┴──┴──────┘
                           │
                    ┌──────▼───────┐
                    │ TriStream    │
                    │ Parser       │
                    ├──────────────┤
                    │📝 Memory     │→ 三層記憶召回 (hot/warm/cold)
                    │🤖 Action     │→ SecurityManager → Shell
                    │💬 Reply      │→ 使用者
                    └──────────────┘

   ┌─────────────────────────────────────────┐
   │              Autonomy v2                │
   ├─────────────────────────────────────────┤
   │  DecisionEngine  ← soul.md + journal    │
   │  ActionRunner                           │
   │   ├ github_explore   (Google Grounding) │
   │   ├ web_research                        │
   │   ├ self_reflection  (patch pipeline)   │
   │   ├ spontaneous_chat                    │
   │   ├ digest / morning_digest             │
   │   ├ health_check                        │
   │   ├ gmail_check / drive_sync            │
   │   ├ x_post                              │
   │   ├ MaintenanceRunner (零 LLM)          │
   │   │  ├ journal_stats                    │
   │   │  ├ rss_fetch                        │
   │   │  ├ patch_cleanup                    │
   │   │  └ process_audit                    │
   │   └ rest                                │
   │  JournalManager  + FlexSearch           │
   │  HealthMonitor   + anomaly detection    │
   └─────────────────────────────────────────┘
```

---

## 核心功能

**ModelRouter** — 多供應商 LLM 智慧路由。支援 Gemini、Groq、DeepSeek、Mistral、OpenRouter、Cerebras、SambaNova 七家供應商，以 Task Intent（chat / analysis / vision / decision 等）自動匹配最佳 provider + model。每家 provider 獨立健康追蹤，API Key 多把輪替，429/503 指數退避，RPD 耗盡自動 fallback。

**Autonomy v2** — 自主行為系統。Golem 定期自動醒來，由 DecisionEngine 讀取 `soul.md` 和 `journal.jsonl`，讓 LLM 從 10 種行動中自主選擇。所有決策有依據，記錄到 journal 形成經驗迴路。

**Self-Reflection Pipeline** — 兩階段自我修復。Phase 1（診斷）：讀取 journal 異常、git log、程式碼，定位問題並記錄 proposedTs。Phase 2（patch）：生成具體修改方案，通過 smoke gate 驗證後提交主人審批，approve 後自動部署。

**MaintenanceRunner** — 零 LLM 自維護系統。可擴展架構，新增維護 action 只需在 `maintenance/` 建一個繼承 `MaintenanceAction` 的檔案，系統自動掃描載入。內建：`journal_stats`、`rss_fetch`、`patch_cleanup`、`process_audit`。

**三層記憶召回** — hot（最近對話）/ warm（近期 journal）/ cold（synthesis 長期記憶），決策時自動注入相關上下文。

**GCP 整合** — Gmail 智慧過濾（Golem 自己的收件匣，只通知真正影響服務的事件）、Google Calendar 行動記錄、Google Drive 備份、Tasks 管理。OAuth Device Flow 授權。

**Digest** — 消化歸納。自主回顧近期 journal 和探索紀錄，由 LLM 產出結構化洞察存入 `memory/synthesis/`，提煉模式而非堆積碎片。

**Chronos** — 時間排程，`setTimeout` 精確觸發 + JSON 持久化，重啟後自動恢復。

**SecurityManager v2** — CMD 白名單 + 外部內容 Taint 標記防 prompt injection + 黑名單阻擋危險操作。

---

## 快速部署

```bash
git clone https://github.com/Golem-Beta/forked-golem.git
cd forked-golem
npm install
cp .env.sample .env
cp config/autonomy.sample.json config/autonomy.json
```

**設定 `.env`（必填）：**
```
GEMINI_API_KEYS=key1,key2,key3
TELEGRAM_TOKEN=your_telegram_bot_token
ADMIN_ID=your_telegram_user_id
```

**選填（有就自動啟用）：**
```
GROQ_API_KEYS=
DEEPSEEK_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=
CEREBRAS_API_KEY=
SAMBANOVA_API_KEY=
GITHUB_TOKEN=
GCP_CLIENT_ID=
GCP_CLIENT_SECRET=
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
```

**自訂身份：** 編輯 `soul.md`，填入你的 Golem 的名字、目標和價值觀。

**啟動：**
```bash
npm start              # Telegram bot 模式
npm start dashboard    # blessed 終端儀表板（推薦）
```

---

## 目錄結構

```
forked-golem/
├── index.js                    # 入口 + 組裝器
├── src/
│   ├── config.js
│   ├── brain.js                # GolemBrain — LLM 對話 + 三層記憶召回
│   ├── parsers.js              # TriStreamParser + ResponseParser
│   ├── security.js             # SecurityManager v2
│   ├── executor.js             # Shell 執行 + 安全檢查
│   ├── message-handler.js
│   ├── callback-handler.js
│   ├── deploy-actions.js       # Patch 部署/丟棄
│   ├── google-services.js      # GCP — Gmail/Calendar/Drive/Tasks
│   ├── x-publisher.js          # X (Twitter) 發文
│   ├── dashboard.js            # blessed 終端儀表板
│   ├── chronos.js
│   ├── model-router/
│   │   ├── index.js
│   │   ├── health.js
│   │   ├── intents.js
│   │   ├── configs.js
│   │   └── adapters/
│   └── autonomy/
│       ├── index.js
│       ├── decision.js
│       ├── journal.js
│       ├── notify.js
│       ├── health.js
│       ├── pending-patches.js
│       └── actions/
│           ├── index.js        # ActionRunner barrel
│           ├── explore.js
│           ├── reflect.js
│           ├── reflect-diag.js
│           ├── reflect-patch.js
│           ├── digest.js
│           ├── social.js
│           ├── health-check.js
│           ├── google-check.js
│           ├── drive-sync.js
│           ├── x-post.js
│           └── maintenance/    # 零 LLM 自維護（可擴展）
│               ├── base.js
│               ├── index.js
│               ├── journal-stats.js
│               ├── rss-fetch.js
│               ├── patch-cleanup.js
│               └── process-audit.js
├── config/
│   └── autonomy.sample.json
├── soul.md                     # 靈魂文件範例（請自訂）
├── skills.d/                   # 10 個模組化技能
├── prompts/                    # LLM prompt 模板
├── memory/
│   ├── journal.jsonl
│   ├── reflections/
│   ├── synthesis/
│   └── pending_patches.json
├── test-smoke.js
├── .env.sample
├── package.json
└── LICENSE
```

---

## 硬體需求

- **CPU**: Intel Core2 Duo 等級即可
- **RAM**: 4GB 足夠（實際佔用 ~90MB）
- **OS**: 任何支援 Node.js 的 Linux 發行版（headless 亦可）
- **網路**: 需連接 LLM API

---

## 版號管理

遵循 SemVer：`MAJOR.MINOR.PATCH`

- v9.0.0 = grammy 遷移基準
- MINOR = 新功能模組
- PATCH = bug fix

---

## 版本歷程

| 版本 | 內容 |
|------|------|
| v8.5-final | 回退基準 (pre-grammy) |
| v9.0.0 | grammy 遷移 — 移除 Puppeteer，API 直連 |
| v9.1.x | SecurityManager v2 + Flood Guard + 429 智慧退避 |
| v9.2.x | skills.d/ 模組化 + Titan Queue + ASCII Tri-Stream |
| v9.3.x | Autonomy v2 — journal 經驗迴路 + GitHub 探索 + soul.md |
| v9.4.x | Chronos 時間排程 |
| v9.5.x | Autonomy 設定檔外部化 + self_reflection pipeline + 靜音模式 |
| v9.6.x | FlexSearch journal 全文搜尋 + web_research + Google Search grounding |
| v9.7.x | ModelRouter 多供應商路由 + digest 消化歸納 |
| v9.8.0 | index.js 模組拆分 → src/ 25+ 模組 + Autonomy Composition 架構 + smoke test |
| v9.9.x | 三層記憶召回 (hot/warm/cold) + HealthMonitor 異常偵測 |
| v9.10.x | SambaNova/Cerebras provider + self_reflection 重複診斷修復 |
| v9.11.x | GCP OAuth 整合 (Gmail/Calendar/Drive/Tasks) + google-commands |
| v9.12.0 | XPublisher + MaintenanceRunner 零 LLM 自維護 + Gmail 智慧過濾重寫 + Drive 自動建資料夾 + repo 整理 |

---

## 致謝

- [Arvincreator/project-golem](https://github.com/Arvincreator/project-golem) — 原版 Project Golem
- Google Gemini API — 主要推理引擎
- [grammy](https://grammy.dev/) — Telegram Bot Framework
- Groq / DeepSeek / Mistral / OpenRouter / Cerebras / SambaNova — 備援 LLM 供應商

---

## License

MIT
