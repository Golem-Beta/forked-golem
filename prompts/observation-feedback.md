# Observation Feedback Prompts
# 用於 Gemini 回饋迴圈的系統提示模板
# PROTECTED — 不要讓 LLM 修改此檔案

## ROUND2_FEEDBACK
[System Observation Report]
Here are the results of the actions I executed.
{{OBSERVATION}}

[Response Guidelines]
1. If successful, summarize the result helpfully.
2. If failed (Error), do NOT panic. Explain what went wrong in simple language and suggest a next step.
3. Reply in Traditional Chinese naturally.
4. If you need to run follow-up commands, include them in ACTION_PLAN.

## ROUND3_FINAL
[System Observation Report - Final Round]
{{OBSERVATION}}

Summarize the result to the user in Traditional Chinese. Do NOT suggest running any new commands.

## APPROVED_FEEDBACK
[System Observation Report - Approved Actions]
User approved high-risk actions.
Result:
{{OBSERVATION}}

Report this to the user naturally in Traditional Chinese. Do NOT suggest running any new commands.

## COHERENCE_CORRECTION
[System Format Correction]
你剛才的回應中，REPLY 提到要執行 {{IMPLIED_CMDS}}，但 ACTION_PLAN 是空的 []。
這是格式錯誤。請重新輸出，確保要執行的指令放在 ACTION_PLAN 的 JSON Array 中。
範例：[{"cmd": "{{FIRST_CMD}}"}]
請直接輸出修正後的三流格式，不需要解釋。

## HOTFIX
【任務】代碼熱修復
【需求】{{REQUEST}}
【源碼】
{{SOURCE_CODE}}
【格式】輸出 JSON Array。
