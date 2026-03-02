# Forked-Golem TODO 統整

> 從過去所有對話中彙整，按優先級排序
> 最後更新：2026-02-27（session 9）

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
- ~~三層記憶召回系統 v9.9.8 (2026-02-27, session 9)~~
  - ~~新建 src/memory/index.js：hot(FlexSearch) + warm(synthesis衰減) + cold(reflections關鍵字索引)~~
  - ~~decision/reflect-diag/explore/digest 全部接入 memory.recall()~~
  - ~~self_reflection 部署後自動回寫 synthesis + 更新冷層索引（知-行閉環）~~
  - ~~model-router cerebras/openrouter priority: 0.1（benchmark 失敗者降優先級）~~

---

## 高優先 🔴

### 5. GCP OAuth / Google 全家桶整合
- **現狀**: 三個 Google 帳號已建好，GCP 尚未設定
- **優先順序**: Calendar（接 Chronos 持久化）→ Drive（備份 journal）→ Gmail（最後）
- **安全**: Gmail 牽涉外部通訊，prompt injection 風險高，放最後

### ~~6. Journal 智慧檢索（BM25）~~ ✅
- ~~已由 v9.9.8 三層記憶召回系統（FlexSearch）覆蓋~~



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

### 15. Structured Self-Improvement Proposals（三階段）

> 前置條件：#21 修復後、self_reflection core_patch 成功率穩定後依序推進

#### 15a. 診斷層升級（高優先）
- **目標**: reflect-diag.js prompt 增加「能力缺口識別」維度
- **現狀**: 只問「哪裡壞了」→ 升級為同時問「有沒有我根本做不到的事」
- **實作**: reflect-diag.js system prompt 加入 capability gap 分析段落
- **驗收**: self_reflection 診斷報告開始出現「缺少 X 能力」類型的洞察

#### 15b. Proposal 類型擴展（中優先，前置：15a 穩定）
- **目標**: proposal 支援 `new_action`（建新 action module）、`new_skill`（擴展 skills）
- **現狀**: 只有 `core_patch`（改現有檔案）
- **實作**: reflect-patch.js + pending-patches.json schema 擴展
- **風險**: new_action 比 patch 風險高，需額外整合驗證

#### 15c. new_action 完整驗證流程（中優先，前置：15b 完成）
- **目標**: 新 action module 能被 decision.js 正確識別與選用
- **實作**: PatchManager 加入整合測試——模擬 decision 選到新 action 並執行
- **審批**: new_action 走獨立審批通道，與 core_patch 區分

### 16. GitHub 探索精準讀取
- **內容**: performGitHubExplore 先做關鍵字粗篩，只傳相關段落給 LLM

### 17. Semantic Triple 標籤
- **備註**: 等 journal 累積數百條以上再考慮

### 18. SecurityManager 覆蓋補強
- **漏洞**: pip install、npm install、node -e "..." 繞過 BLOCK_PATTERNS
- **備註**: 目前人工審批為最後防線，非緊急

### 19. Dashboard 頻繁重啟根因調查（觀察中）

### 20. reflect-patch.js 重複 return 語句
- **位置**: `_handleCorePatch` 第 288-289 行，兩行完全相同的 `return`
- **影響**: 零（第二行永遠不執行），純清理
- **修法**: 刪掉其中一行，併入下個有意義的 commit

### 21. health-check log 分類邊界情況
- **內容**: `_analyzeLog` 以 `line.includes("[ERR]")` 判斷 errorMap vs warnMap，但 keywords 命中（❌/失敗等）的 `[LOG]` 行會誤歸 warnMap
- **修法**: 先判斷 level tag（ERR/WARN/LOG），keywords 命中但無 ERR level 的歸 warnMap 即可
- **優先級**: 低，實務上 ❌ 幾乎只出現在 [ERR] 行

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
| v9.9.8 | 三層記憶召回系統 + self_reflection 閉環回寫 | ✅ tagged |

- ~~Gemini SDK 遷移 (@google/generative-ai EOL → @google/genai v1.43.0) (v9.9.4)~~
- ~~Grounding Pipeline 修復 (v9.9.4–v9.9.6)~~
  - ~~gemini.js groundingMetadata 讀取，回傳 grounding + rawParts~~
  - ~~model-router/index.js 透傳 grounding~~
  - ~~explore.js web_research 報告附來源清單~~
  - ~~callLLM 回傳結構化 { text, grounding }，移除 returnFull workaround~~
  - ~~brain.js chatHistory 保留 thought signature (rawParts)~~

### 20. 新免費 LLM Provider 評估與整合
- **候選**（依優先順序）：
  1. **Alibaba Cloud Model Studio（國際版）** — 每模型 100萬 tokens 免費，Qwen3-235B 直連官方 endpoint，比 OpenRouter 更穩且不佔 200 RPD
  2. **NVIDIA NIM** — 40 RPM 免費，模型多，需手機驗證
  3. **Scaleway Generative APIs** — 100萬 free tokens，有 Qwen3-235B / DeepSeek R1，歐洲節點
- **方式**: 取得 API key → 加入 configs.js → intents.js 適當 priority → smoke test

~~### 21. Telegram 部署按鈕 60 秒過期問題~~
~~- /lp 指令重新發送新按鈕，60 秒問題已不存在~~

### 22. Model Benchmark 自主執行與動態 Routing 調整
- **概念**: Golem 定期執行 model-benchmark.js，根據結果自主調整各 provider 的 intent 優先權重
- **設計張力**: 自主調整 routing config 是高風險操作（改壞影響所有請求），但完全靠人工維護不符合自律 Agent 目標
- **待討論方向**:
  1. benchmark 結果存入 memory（Golem 只讀參考，不自動改 config）
  2. Golem 提案 → 走 pending-patches 審批流程 → 人工確認後才更新 routing
  3. 完全自主更新，但加 rollback 機制（改壞後 5 分鐘內自動還原）
- **前置工作**: model-benchmark.js 移入 repo，加入 health_check 觸發點
- **關鍵問題**: 自律 Agent 與關鍵基礎設施安全邊界如何取得平衡？

### 23. ModelRouter 全 provider 失敗時錯誤訊息格式
- **問題**: 所有 provider 失敗時 [ERR] 輸出裸 JSON `{"providerError":"429","retryAfterMs":5000,...}`，不易閱讀
- **修法**: 改為可讀格式 `[ModelRouter] 所有 provider 失敗，最後錯誤：429，將在 Xs 後重試`
- **位置**: ModelRouter 最終錯誤拋出處

### 24. googleapis 記憶體佔用優化
- **問題**: `googleapis` 整包 SDK 佔用約 60MB RAM，但 Golem 只用 Gmail/Calendar/Drive/Tasks 四個 API
- **根源**: `google-services.js` 用 `require('googleapis')`，載入了幾十個用不到的 API client
- **方向**: 改用 `google-auth-library` + 各 API REST 端點直連，預計可節省 ~50MB
- **優先度**: 低（X200 目前 RAM 尚有餘裕，GCP 功能剛上線）
- **前置**: GCP 整合穩定運行一段時間後再評估

### 25. gmail_check 升級為真正的感知層
- **問題**: 目前 gmail_check 是「讀信→規則分類→轉發給主人」，Golem 沒有真正理解信件對自己的意義
- **目標**: Golem 帶著完整自我認知（soul.md + 最近 journal + 已知帳號清單）讀信，自己推理「這封信對我意味著什麼，我應該怎麼辦」
- **verdict 升級**: 從 important/ignore 二元 → self_handle/notify_human/trigger_action + understanding + journal_note
- **前置條件**: inbox 裡開始出現 Golem 自己行動產生的信（而非帳號建立階段的副產品）
- **設計原則**: 感知 = 帶身份認知的推理，不是硬編碼規則
- **注意**: gmail_check 本質上需要 LLM，與 drive_sync/health_check 等無 LLM action 不同

### 26. Patch 驗證沙盒化
- **問題**: self_reflection 產生的 patch 在驗證階段直接在主系統執行，若 patch 有 side effect（寫檔、呼叫 API）會在驗證時觸發
- **目前防線**: 所有 patch 需主人審批才部署，`node -c` 語法檢查 + `GOLEM_TEST_MODE=true` + smoke test
- **目標**: 驗證階段在受限環境執行，防止 patch 意外觸發副作用
- **推薦方案**: Node.js Permission Model（v22 內建，零額外依賴）
  ```
  node --permission \
    --allow-fs-read=/home/user/forked-golem \
    --allow-fs-write=/tmp \
    patch-test.js
  ```
  只需改 `PatchManager.verify()` 的 execSync 指令，其他不動
- **備選方案**: Docker（`node:22-alpine --network none`），真正系統層隔離，但多吃 ~50MB RAM + 啟動延遲
- **不推薦**: Node.js `vm` 模組，官方明確不保證安全性
- **優先度**: 中（目前審批機制是最後防線，沙盒是縱深防禦）
- **位置**: `src/upgrader.js` PatchManager.verify()

### 27. notifier.sendToAdmin 統一入口（Quiet Hours 繞過漏洞）
- **問題**: reflect-patch-executor.js 直接呼叫 `tgBot.api.sendMessage` + `sendDocument`，完全繞過 notifier.sendToAdmin 的 quiet hours 判斷
- **根因**: sendToAdmin 不支援附件（document），executor 被迫自己呼叫 bot API
- **影響**: self_reflection 審批通知在 quiet hours 內仍會發出（已確認：01:55 凌晨收到通知）
- **系統解**: 擴充 `notifier.sendToAdmin(text, options?)` 支援可選附件參數 `{ document, filename }`
  - quiet hours 內：文字進 queue，附件不 queue（drain 時說明「patch 檔案請用 /lp 查看」）
  - reflect-patch-executor.js 改用 sendToAdmin，移除直接 bot API 呼叫
- **範圍**: `src/autonomy/notify.js` + `src/autonomy/actions/reflect-patch-executor.js`
- **前置掃描**: chronos.js 定時提醒（豁免合理，不需改）；其餘 direct bot call 掃描確認無其他漏洞
- **優先度**: 高（凌晨打擾主人是直接用戶體驗問題）
- **TG diff 可讀性問題**: sendForReview 的 diffPreview 只取前 2 行 + 截 80 字，主人看不出 patch 在改什麼。考慮同步改善預覽品質或附完整 diff 檔案
