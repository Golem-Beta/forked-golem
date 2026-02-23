# Observation Feedback Prompts
# 用於 Gemini 回饋迴圈的系統提示模板
# PROTECTED — 不要讓 LLM 修改此檔案

## REACT_STEP
[執行觀察報告 — 第 {{STEP_COUNT}} 步]

已執行歷史摘要：
{{STEP_SUMMARY}}

最新執行結果：
{{OBSERVATION}}

[指引]
1. 如果任務已完成，在 GOLEM_REPLY 說明結果，GOLEM_ACTION 留空 []
2. 如果還需要執行更多指令，把下一步放進 GOLEM_ACTION
3. 只放你現在確定要執行的指令，不要放假設性的指令
4. 如果指令失敗，診斷原因並嘗試不同方法，不要重複相同的失敗指令
5. 使用繁體中文回覆

## APPROVED_FEEDBACK
[System Observation Report - Approved Actions]
User approved high-risk actions.
Result:
{{OBSERVATION}}

Report this to the user naturally in Traditional Chinese. Do NOT suggest running any new commands.

## HOTFIX
【任務】代碼熱修復
【需求】{{REQUEST}}
【源碼】
{{SOURCE_CODE}}
【格式】輸出 JSON Array。
