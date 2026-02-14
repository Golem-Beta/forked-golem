# 🤖 Forked-Golem v9.0

> **"I perceive, therefore I act."**
> **API 直連自律型 AI Agent，基於 [Project-Golem](https://github.com/Arvincreator/project-golem) 重新設計。**

Forked-Golem 是運行在低功耗硬體上的本機 AI Agent。透過 Gemini API 直連取代原作的 Puppeteer 瀏覽器自動化架構，將 RAM 佔用從 600MB+ 降至 ~80MB，適合在 ThinkPad X200 等老舊硬體上 24/7 運行。

支援 Telegram 與 Discord 雙平台，具備系統指令執行、視覺分析、長期記憶、自主排程與安全防護等能力。

---

## 系統架構

```
使用者 (TG/DC)
    │
    ▼
⚡ Node.js 反射層 (grammy / discord.js)
    │
    ├─→ 🗝️ KeyChain (API Key 輪替 + 智慧冷卻)
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
| 安全防護 | 基礎 | SecurityManager v2 (Taint/Flood Guard) |

---

## 核心功能

**🧠 GolemBrain** — Gemini API 直連推理引擎。主對話使用 `gemini-2.5-flash-lite`（每日 1000 次免費額度），保留完整對話歷史（最近 20 輪）。

**🗝️ KeyChain** — 多 API Key 輪替，帶節流控制（最小 2.5s 間隔）。碰到 429 自動標記冷卻：RPD 限制凍 15 分鐘，RPM 限制凍 90 秒，避免反覆撞牆。

**⚓ Tri-Stream Protocol** — 每次回應拆解為記憶寫入、行動執行、對話回覆三條串流，實現思考與行動並行。

**👁️ OpticNerve** — 透過 Gemini 2.5 Flash 分析圖片與文件。支援截圖解讀、程式碼轉錄、UI 結構分析。

**🛡️ SecurityManager v2** — 白名單/黑名單指令控制、Taint 標記防止 Prompt Injection、Flood Guard 防洪、過期訊息過濾。

**♻️ Autonomy** — 自主生命週期排程，定時醒來執行探索或回報。

**📊 Dashboard** — blessed TUI 戰術控制台，即時監控系統狀態與 API 呼叫。

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

---

## 硬體需求

本專案為低功耗環境設計：

- CPU: Intel Core2 Duo 等級即可
- RAM: 4GB 以上
- OS: Linux (Arch/Debian/Ubuntu)，支援 headless 無 GUI 環境
- 網路: 需連接外網（Gemini API + Telegram/Discord）

---

## 致謝

本專案基於 [Arvincreator](https://github.com/Arvincreator) 的 [Project-Golem](https://github.com/Arvincreator/project-golem) 發展而來。原作奠定了 Tri-Stream Protocol、雙模記憶引擎與戰術控制台等核心概念。

<a href="https://www.buymeacoffee.com/arvincreator" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee (Original Author)" style="height: 60px !important;width: 217px !important;" ></a>

---

## 免責聲明

1. **自行承擔風險**：本軟體具有執行 Shell 指令的權限，請謹慎授權高風險操作。
2. **帳號安全**：建議使用獨立 Google 帳號的 API Key 運行。
3. **隱私聲明**：所有記憶與資料皆儲存於本機設備。
