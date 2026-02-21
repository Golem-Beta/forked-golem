---
name: EVOLUTION
summary: "Self-Evolution: two modes — create skills or propose core patches"
auto_load: false
keywords: [evolve, patch, optimize, source, self, refactor, skill, improve]
---

你正在進行自我進化分析。根據提供的程式碼和上下文，選擇適合的進化模式。

## 模式一：技能擴展 (skill_create)

**適用時機**：你缺少某個能力，但不需要修改核心程式碼。
例如：需要新的互動方式、新的資料處理方法、新的指令格式。

輸出格式：
```json
[
  {
    "mode": "skill_create",
    "skill_name": "SKILL_NAME",
    "description": "這個技能做什麼",
    "reason": "為什麼需要這個技能",
    "content": "---\nname: SKILL_NAME\nsummary: 一句話摘要\nauto_load: false\nkeywords: [關鍵字1, 關鍵字2]\n---\n\n技能內容（markdown 格式）..."
  }
]
```

技能內容會被寫入 `skills.d/SKILL_NAME.md`。

## 模式二：核心進化 (core_patch)

**適用時機**：你從 GitHub 探索或經驗中發現了具體的改進方向，需要修改程式碼。
例如：修 bug、優化邏輯、重構結構、加入新功能。

輸出格式：
```json
[
  {
    "mode": "core_patch",
    "type": "bugfix|optimization|feature|refactor",
    "file": "autonomy.js",
    "description": "一句話描述：改了什麼、為什麼改",
    "search": "要找的精確程式碼（必須跟原始碼逐字節匹配）",
    "replace": "替換後的程式碼"
  }
]
```

## 模式三：什麼都不做

如果程式碼沒有明顯問題，或你沒有足夠信心提出好的改進：

```json
[]
```

空 array。克制是一種智慧。這比低品質的提案更好。

## core_patch 規則

1. **只輸出 1 個 patch**，品質勝過數量
2. `search` 必須跟原始碼逐字節匹配：空格、換行、縮排都要對
3. `search` 在目標檔案中只能出現一次，至少 3-5 行確保唯一性
4. `search` 至少 40 字元
5. `file` 必須是你看到的目標檔案名（通常是 autonomy.js，也可以是 index.js 或 skills.js）
6. 改動要小：一個位置、小範圍 diff
7. 不要碰 [KERNEL PROTECTED] 區域

## 決策指引

問自己：
- 我是缺少一個「能力」？→ skill_create
- 我發現程式碼有「問題」或有具體的「改進方向」？→ core_patch
- 我沒有明確的改進目標？→ 空 array

**重要**：不要為了產出而產出。如果你讀完程式碼覺得沒什麼好改的，輸出 `[]` 是正確答案。

## 禁止事項

- 不要輸出 markdown 文章或解釋，只輸出 JSON Array
- 不要用 rm、mv、eval、exec 或 shell 指令
- 不要把 JSON 包在 ```json ``` 裡，直接輸出裸 JSON
- 不要在 content 欄位裡放 JSON 或 code block（技能內容是 markdown 純文字）
