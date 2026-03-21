# Forked-Golem TODO 統整

> 從過去所有對話中彙整，按優先級排序
> 最後更新：2026-03-11（v9.19.1 — golem.log timestamp 改 CST+8）

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
- ~~Prompts 外部化~~
- ~~認知閉環~~
- ~~Dashboard 擴展~~
- ~~Autonomy 429 cascade 修復 + systemInstruction 污染修復~~
- ~~Reply 上下文注入（context.js replyText getter + reply-context.md 注入）~~
- ~~Autonomy v2 驗證（決策引擎、journal、探索機制）~~
- ~~Bug 修復 (CC session) — social.js / morning_digest / quietQueue / decision JSON fallback~~
- ~~ModelRouter 日誌強化 (v9.9.0) — provider/model/latency log + journal model 欄位~~
- ~~Autonomy 對話閉環 — sendToAdmin 成功後注入 brain.chatHistory~~
- ~~self_reflection 強化 Level 1 — createTestClone 零變化偵測 + smoke test + diff 預覽~~
- ~~decision.js 模組拆分 — 拆出 decision-utils.js (-31%)~~
- ~~Runtime Token Metrics — journal tokens: { in, out }~~
- ~~Dashboard statusBox/providerBox 修復~~
- ~~#3+#4 Unified ActionResult + FailureTracker~~
- ~~三層記憶召回系統 v9.9.8 — hot(FlexSearch) + warm(synthesis) + cold(reflections)~~
- ~~Gemini SDK 遷移 (@google/generative-ai → @google/genai v1.43.0)~~
- ~~Grounding Pipeline 修復 — groundingMetadata + explore 來源清單~~
- ~~NVIDIA NIM provider 整合~~
- ~~GCP OAuth + Google 全家桶（Gmail/Drive/Calendar/Tasks）整合 (#5)~~
- ~~Threads OAuth + threads_post action 接入決策迴圈~~
- ~~Reality Anchor — HN 熱門 + 時間語義注入 decision context~~
- ~~CodebaseIndexer — 啟動時自動重建索引，self_reflection target_node 驗證路徑~~
- ~~大規模 refactor 批次（v9.15.x）— dashboard-renderer、OpticNerve、VirtualCmdHandler、HealthReporter、GmailClient/DriveClient、ColdIndex 等拆出~~
- ~~provider ranking by latency + reliability (providerBox)~~
- ~~#27 notifier.sendToAdmin 支援附件 + quiet hours 附件略過~~
- ~~Format A 支援 class method + 縮排正規化，廢除 Format B~~
- ~~AutoDeploy configurable thresholds + static safety firewall (Golem 無法從 patch 繞過安全邊界)~~
- ~~Atomic patch 強制 + prohibit risk_level gaming~~
- ~~ReviewerAgent 語義審查層 + BaseAction 基礎類別~~
- ~~reflect-diag FAILURE_ANALYSIS 強化~~
- ~~WebSearchTool 取代 Gemini grounding，web_research 獨立搜尋層~~
- ~~ResultHandler 統一行動結果後處理 (#TODO-結構)~~
- ~~model-benchmark 模組化 action，接入 autonomy 路由~~
- ~~reflect: extractCodeSection AST 聚焦 + LLM 自驗~~
- ~~BaseAction helpers 統一遷移，修正靜默丟棄~~
- ~~Groq 模型更新 — gpt-oss-120b(reasoning) + llama-4-maverick~~
- ~~digest 加入 git log -15 context~~
- ~~Team pipeline no_target_node 修正：decision.js proxy 補傳 pathsOnly、nodeList 擴展全 src/、Analyst 可達性標記（reachable/suggestion）、TeamRunner needs_human journal~~
- ~~Dynamic Provider Registry — OpenRouter/NVIDIA NIM 整合，provider 動態發現與 registry 閉環~~
- ~~Groq 模型更新 — llama-4-maverick + gpt-oss-120b (reasoning)~~
- ~~per-provider RPD tracking + 磁碟持久化~~
- ~~model-benchmark journal 結構化可觀測性~~
- ~~self_reflection 方法幻覺三層防禦（extractCodeSection knownMethods + Reviewer + journal 學習閉環）~~
- ~~brain.js chatHistory 改中性格式 {role, content}，解除 Gemini provider 鎖定；appendAssistantMessage() 封裝外部寫入~~
- ~~#22 model-benchmark 動態 routing 閉環 — benchmark 結果接入 health_check，pool 狀態依分數自動調整~~
- ~~#25 gmail_check 升級感知層 — verdict 四分類（important/self_handle/trigger_action/ignore）+ LLM 注入 Beta soul.md + 近期 journal context~~
- ~~golem.log timestamp 改 CST+8（修正 health-analyzer 時區偏移 bug，v9.19.1）~~

---

## 高優先 🔴

> （#7 moltbook skill 文件已降級至低優先，功能本體已完成）

### 7. skill-moltbook.md 整合
- **現狀**: moltbook 功能本體（post/check/engagement）已完成，skills.d/ 整合純屬文件補充
- **優先度**: 低，待機會處理
### 8. 第二台機器 (Alpha, P8700 + 8GB) 部署 + MultiAgent
- **前提**: 單機架構穩定後再開工

---

## 中優先 🟡

### 15. Structured Self-Improvement Proposals（三階段）

> 前置條件：self_reflection core_patch 成功率穩定後依序推進

#### 15a. 診斷層升級
- reflect-diag.js prompt 加入「能力缺口識別」維度（現在只問「哪裡壞了」）
- 驗收：診斷報告開始出現「缺少 X 能力」類型洞察

#### 15b. Proposal 類型擴展（前置：15a 穩定）
- proposal 支援 `new_action`、`new_skill` 類型
- 現在只有 `core_patch`

#### 15c. new_action 完整驗證流程（前置：15b）
- PatchManager 加入整合測試，new_action 走獨立審批通道





### 26. Patch 驗證沙盒化
- **問題**: self_reflection patch 在驗證階段直接在主系統執行，若有 side effect 會在驗證時觸發
- **推薦方案**: Node.js Permission Model (v22 內建)
  ```
  node --permission --allow-fs-read=/home/user/forked-golem --allow-fs-write=/tmp patch-test.js
  ```
- **位置**: `src/upgrader.js` PatchManager.verify()

---

## 低優先 🟢

### 28. Gmail RSS 訂閱（provider status feed）
- **目標**: X200 本機 rss-poller.js 抓 provider status RSS → 透過 GCP Gmail API 發信給 Beta → google_check 感知層自然觸發
- **確認有效 feed**: Groq `groqstatus.com/history.rss`、GCP `status.cloud.google.com/en/feed.atom`、Mistral `status.mistral.ai/history.rss`
- **推薦方案**: Node.js rss-poller，複用現有 GCP token，不依賴第三方 RSS→email 服務
- **現況**: 設計確定，實作擱置待排期

### 10. 經驗迴路 (Auto-Skill 概念)
- 成功解決問題後自動記錄經驗，下次自動載入

### 11. Nano Banana 圖片生成 skill

### 12. Dashboard 進一步優化
- Queue 獨立面板、fbterm 中文顯示驗證

### 16. GitHub 探索精準讀取
- performGitHubExplore 先做關鍵字粗篩，只傳相關段落給 LLM

### 17. Semantic Triple 標籤
- 等 journal 累積數百條以上再考慮

### 18. SecurityManager 覆蓋補強
- 漏洞：pip install、npm install、node -e "..." 繞過 BLOCK_PATTERNS
- 目前人工審批為最後防線，非緊急

### 20. reflect-patch.js 重複 return 語句
- `_handleCorePatch` 第 288-289 行兩行相同 return，純清理，併入下個有意義 commit

### 21. health-check log 分類邊界情況
- `_analyzeLog` 以 ERR tag 判斷，keywords 命中但無 ERR level 的 [LOG] 行誤歸 warnMap
- 低影響，待機會修

### 23. ModelRouter 全失敗時錯誤訊息格式
- 裸 JSON `{"providerError":"429",...}` 改為可讀格式
- 位置：ModelRouter 最終錯誤拋出處

### 24. googleapis 記憶體佔用優化
- 改用 google-auth-library + REST 端點直連，預計節省 ~50MB
- 前置：GCP 整合穩定運行一段時間後再評估

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
| v9.0.0–v9.8.0 | grammy 遷移、SecurityManager v2、skills、Autonomy v2、ModelRouter | ✅ tagged |
| v9.9.x | Dashboard、chatHistory 注入、Token Metrics、ActionResult、FailureTracker、三層記憶 | ✅ tagged |
| v9.9.4–v9.9.6 | Gemini SDK 遷移 + Grounding Pipeline | ✅ tagged |
| v9.9.8 | 三層記憶召回系統 + self_reflection 閉環回寫 | ✅ tagged |
| v9.15.x | 大規模 refactor 批次（模組拆分、src/ 結構整理） | ✅ tagged |
| v9.16.0 | CodebaseIndexer + decision prompt 注入 | ✅ tagged |
| v9.17.0 | model-benchmark action + ResultHandler + ReviewerAgent + AST reflect | ✅ tagged |
| v9.18.x | Dynamic Provider Registry、Groq 模型更新、per-provider RPD、benchmark 可觀測性、三層幻覺防禦、chatHistory 中性格式 | 未 tag |
| v9.19.0 | #22 benchmark routing 閉環、parsers 修復 4、#25 Gmail 感知層升級（verdict 四分類 + LLM Beta context） | ✅ tagged |
| v9.19.1 | golem.log timestamp 改 CST+8，修正 health-analyzer 時區偏移 bug | ✅ tagged |


