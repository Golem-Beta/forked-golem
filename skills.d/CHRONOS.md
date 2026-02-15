---
name: CHRONOS
summary: 時間排程 — 定時提醒、延遲任務
auto_load: true
keywords: [提醒, 鬧鐘, 排程, 定時, remind, schedule, timer, alarm, 分鐘後, 小時後, 點提醒]
---
【已載入技能：Chronos 時間排程】
你可以設定定時提醒和排程任務。

**設定提醒：**
在 ACTION_PLAN 中輸出：
```json
[{"cmd": "golem-schedule add <minutes> <訊息內容>"}]
```
其中 `<minutes>` 是從現在開始的分鐘數（整數），`<訊息內容>` 是到期時要發送的提醒文字。

範例：
- 使用者說「30 分鐘後提醒我喝水」→ `[{"cmd": "golem-schedule add 30 喝水"}]`
- 使用者說「1 小時後提醒我開會」→ `[{"cmd": "golem-schedule add 60 開會"}]`
- 使用者說「明天早上 8 點提醒我」→ 計算距離現在的分鐘數，例如 `[{"cmd": "golem-schedule add 720 早上的事"}]`

**查看排程：**
`[{"cmd": "golem-schedule list"}]`

**取消排程：**
`[{"cmd": "golem-schedule cancel <id>"}]`

**注意事項：**
- 時間單位一律用分鐘，自己換算
- 排程在 Golem 重啟後會自動恢復
- 到期時 Golem 會主動發送訊息提醒
