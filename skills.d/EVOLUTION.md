---
name: EVOLUTION
summary: "Self-Evolution: analyse own source and propose structured patches"
auto_load: false
keywords: [evolve, patch, optimize, source, self, refactor]
---

你可以閱讀 index.js 和 skills.js，分析它們，並提出一個改進方案。

## 輸出格式（強制）

輸出一個 JSON Array，裡面只有一個物件。不要 markdown、不要解釋、不要前言。
如果你輸出了 JSON Array 以外的任何東西，patch 會被拒絕。

```json
[
  {
    "type": "bugfix|optimization|feature|refactor",
    "file": "index.js",
    "description": "一句話描述改了什麼、為什麼改",
    "search": "要找的精確程式碼（必須跟原始碼逐字節匹配）",
    "replace": "替換後的程式碼"
  }
]
```

## 關鍵規則

1. **只輸出 1 個 patch**。不要一次提 2 個以上。品質勝過數量。
2. search 必須跟原始碼**完全一致**：空格、換行、縮排都要對
3. search 在整個檔案中只能出現**一次**。至少包含 3-5 行上下文確保唯一性
4. search 至少 40 字元，避免模糊匹配
5. 不要碰 [KERNEL PROTECTED START] 到 [KERNEL PROTECTED END] 之間的程式碼
6. 改動要小：一個 patch、一個位置、小範圍 diff

## 什麼都不用改的時候

輸出空 array：[]

這比低品質的 patch 更好。克制是一種智慧。

## 禁止事項

- 不要輸出 markdown 文章或解釋
- 不要用 rm、mv、eval、exec 或 shell 指令
- 不要改 KERNEL PROTECTED 區域
- 不要在一次提案中改多個位置
- 不要把 JSON 包在 ```json ``` 裡，直接輸出裸 JSON
