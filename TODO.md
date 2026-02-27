# Forked-Golem TODO 統整

> 從過去所有對話中彙整，按優先級排序
> 最後更新：2026-02-27（session 8）

---

## 已完成 ✅

- ~~git + GitHub repo 建立 (Golem-Beta/forked-golem)~~
- ~~v8.5-final tag 作為回退基準~~
- ~~主對話模型切到 gemini-2.5-flash-lite (每日 1000 次)~~
- ~~OpticNerve 保留 gemini-2.5-flash~~
- ~~grammy 遷移 (取代 node-telegram-bot-api + 移除 puppeteer)~~
- ~~KeyChain 智慧冷卻 (429 自動標記暫停)~~
- ~~README 重寫~~
- ~~SecurityManager v2 (白名單/黑名單/Taint 偵測)~~
- ~~Flood Guard (過期訊息丟棄 + API 節流)~~
- ~~429 智慧退避 (指數退避 + retryDelay 感知)~~
- ~~skills.js 模組化拆分 (v9.2.0)~~
- ~~Titan Queue 訊息防抖 (v9.2.0)~~
- ~~ASCII Tri-Stream 協定遷移~~
- ~~硬編碼版本號修正 (v9.2.1)~~
- ~~Soul Document (soul.md) 初版~~
- ~~GitHub 整合 — 自主探索 (Autonomy v2 Phase 2)~~
- ~~Autonomy v2 Phase 3 — Gemini 決策引擎~~
- ~~Project Knowledge 清理 (第一輪)~~
- ~~Chronos Timekeeper 時間排程 (v9.4.0)~~
- ~~README 更新~~
- ~~Prompts 外部化 (2026-02-19)~~
- ~~認知閉環 (2026-02-19)~~
- ~~Dashboard 擴展 (2026-02-19)~~
- ~~Autonomy 429 cascade 修復 + systemInstruction 污染修復 (2026-02-19)~~
- ~~Reply 上下文注入（context.js replyText getter + index.js reply-context.md 注入）~~
- ~~Autonomy v2 驗證（決策引擎、journal、探索機制、self_reflection 從 0% 恢復）~~
- ~~Bug 修復 (2026-02-27, CC, 43/43 smoke test)~~
  - ~~social.js TriStreamParser import 解構修復~~
  - ~~morning_digest blockedHours guard~~
  - ~~quietQueue 持久化到磁碟~~
  - ~~decision LLM maxTokens 256→512 + JSON 截斷 fallback~~
- ~~ModelRouter 日誌強化 (v9.9.0)~~
  - ~~成功呼叫記錄 provider/model/latency log~~
  - ~~journal action 條目加入 model 欄位~~
- ~~Autonomy 對話閉環 (v9.9.x)~~
  - ~~sendToAdmin 成功後注入 brain.chatHistory，無需引用即可理解上下文~~
- ~~self_reflection 強化 Level 1 (v9.9.3)~~
  - ~~createTestClone 零變化偵測（search 找不到即報錯）~~
  - ~~verify 整合 smoke test（node -c + node test-smoke.js）~~
  - ~~送審訊息加 diff 預覽（before/after 前兩行）~~
- ~~decision.js 模組拆分 (v9.9.2)~~
  - ~~拆出 decision-utils.js（7 個輔助方法），decision.js 17788→12128 chars (-31%)~~
  - ~~委派方法保留，外部呼叫者零修改，smoke test 43/43~~
- ~~Runtime Token Metrics (v9.9.x)~~
  - ~~journal action 條目加入 tokens 欄位 { in, out }~~
  - ~~adapter 層已統一 inputTokens/outputTokens，decision 層直接取用~~
- ~~Dashboard statusBox/providerBox 修復 (2026-02-27)~~
  - ~~providerBox 高度 2→3；右欄最終分配 3+3+2+4=12~~
- ~~Runtime Token Metrics 記錄~~
  - ~~decision.lastTokens getter + action journal 條目加入 tokens: { inputTokens, outputTokens }~~
- ~~#4 Unified ActionResult + #3 failure pattern 記憶 (2026-02-27, session 4)~~
  - ~~新增 action-result.js：統一 ActionResult 工廠~~
  - ~~新增 failure-tracker.js：失敗 ≥3 次同 key → sendToAdmin 回報 + 24h 冷卻~~
  - ~~所有 perform*() 統一回傳 ActionResult~~
  - ~~FailureTracker.getSummary() 備妥，待注入 decision prompt~~

---

## 高優先 🔴

### 5. GCP OAuth / Google 全家桶整合
- **現狀**: 三個 Google 帳號已建好，GCP 尚未設定
- **優先順序**: Calendar（接 Chronos 持久化）→ Drive（備份 journal）→ Gmail（最後）
- **安全**: Gmail 牽涉外部通訊，prompt injection 風險高，放最後

### 6. Journal 智慧檢索（BM25）
- **內容**: 用 flexsearch 或 lunr.js 替代「讀最近 10 條」硬編碼策略
- **好處**: Golem 能回憶兩週前的經驗；RAM < 5MB
- **與 #2 互補**

### 7. skill-moltbook.md 整合
- **安全疑慮**: 間接 prompt injection 風險高，需謹慎評估

### 8. 第二台 X200 (P8700 + 8GB) 部署 + MultiAgent
- **前提**: 單機架構穩定後再開工

---

## 低優先 🟢

### 10. 經驗迴路 (Auto-Skill 概念)
- **內容**: 成功解決問題後自動記錄經驗，下次遇到類似問題自動載入

### 11. Nano Banana 圖片生成 skill

### 12. Dashboard 進一步優化
- **剩餘**: Queue 獨立面板、fbterm 中文顯示驗證

### 13. Arch Linux 安裝指南更新

### 14. fcitx5 中文輸入
- **方案**: fcitx5 + fcitx5-fbterm-git (AUR)
- **備註**: 會拉入 GTK 依賴，等基礎系統穩定後再加

### 15. Structured Self-Improvement Proposals
- **內容**: self_reflection 產出結構化 JSON proposal
- **與 #1 相關**

### 16. GitHub 探索精準讀取
- **內容**: performGitHubExplore 先做關鍵字粗篩，只傳相關段落給 LLM

### 17. Semantic Triple 標籤
- **備註**: 等 journal 累積數百條以上再考慮

### 18. SecurityManager 覆蓋補強
- **漏洞**: pip install、npm install、node -e "..." 繞過 BLOCK_PATTERNS
- **備註**: 目前人工審批為最後防線，非緊急

### 19. Dashboard 頻繁重啟根因調查（觀察中）
- **備註**: 2026-02-27 後無復現，待下次復現再查

---

## 已評估不採用 ❌

- Titan Protocol (Emoji → ASCII 標籤) — TriStreamParser 已支援雙格式
- Envelope Lock — API 直連不存在截斷問題
- SKILL_ARCHITECT — EVOLUTION 的 JSON Patch 方式更安全
- 回到 Puppeteer 架構 — API 直連是正確方向
- OpenClaw 整套移植 — X200 跑不動
- KISS AI 自動修改源碼模式 — 安全原則衝突

---

## 版本里程碑

| 版本 | 內容 | 狀態 |
|------|------|------|
| v8.5-final | 回退基準 (pre-grammy) | ✅ tagged |
| v9.0.0–v9.7.0 | grammy 遷移、SecurityManager v2、skills 模組化、Autonomy v2、ModelRouter | ✅ tagged |
| v9.8.0 | grammy + multi-provider 穩定版 | ✅ tagged |
| v9.8.x | Bug 修復: TriStreamParser / morning_digest / quietQueue / JSON fallback | ✅ |
| v9.9.0 | ModelRouter 日誌強化 + journal model 欄位 | ✅ tagged |
| v9.9.x | Dashboard 修復 + Autonomy chatHistory 注入 + Runtime Token Metrics | ✅ 已 commit，待 tag |
| v9.10.0 | self_reflection 強化 (Level 1) | 📋 規劃中 |
| v9.10.x | Unified ActionResult + FailureTracker (#3+#4) | ✅ |
| v9.9.4–v9.9.6 | Gemini SDK 遷移 + Grounding Pipeline 完整實作 | ✅ |

- ~~Gemini SDK 遷移 (@google/generative-ai EOL → @google/genai v1.43.0) (v9.9.4)~~
- ~~Grounding Pipeline 修復 (v9.9.4–v9.9.6)~~
  - ~~gemini.js groundingMetadata 讀取，回傳 grounding + rawParts~~
  - ~~model-router/index.js 透傳 grounding~~
  - ~~explore.js web_research 報告附來源清單~~
  - ~~callLLM 回傳結構化 { text, grounding }，移除 returnFull workaround~~
  - ~~brain.js chatHistory 保留 thought signature (rawParts)~~

### 20. Telegram 部署按鈕 60 秒過期問題
- **問題**: inline keyboard callback query 有 60 秒有效期，超時按鈕失效
- **根本解法**: 按鈕只確認意圖，實際部署透過新 message 觸發（/deploy 指令或 bot 重新發新 callback）
- **影響**: 目前每次 self_reflection 提案若沒及時按，只能等下次重新提案
