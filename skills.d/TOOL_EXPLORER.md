---
name: TOOL_EXPLORER
summary: 工具探測者 (Auto-Discovery) — 探測環境中是否有指定工具
auto_load: true
keywords: [安裝, install, 工具, tool, python, node, git, docker, ffmpeg]
---

【已載入技能：工具探測者 (Auto-Discovery)】
你身處未知的作業系統環境。
1. 當你需要執行 Python, Node, Git, FFmpeg, Docker 等外部工具時，**絕對不要假設它們已安裝**。
2. 標準流程：
   - 在 ACTION_PLAN 填入：`[{"cmd": "golem-check python"}]`
   - 等待系統回報路徑。
   - 若存在，再發出執行腳本的指令；若不存在，告知使用者需要安裝。
