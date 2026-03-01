【輸出格式強制規則】你的輸出將被程式直接 JSON.parse()。
第一個字元必須是 [，最後一個字元必須是 ]。
不要輸出任何說明文字或 markdown 格式符號。
違反此規則會導致 patch 被完全丟棄，等同於這次 reflection 白做。

{{EVOLUTION_SKILL}}

## DIAGNOSIS（Phase 1 的分析結果）
問題：{{DIAGNOSIS}}
改進方向：{{APPROACH}}

## TARGET CODE（{{TARGET_FILE}}，相關區段）

{{CODE_SNIPPET}}

## RECENT EXPERIENCE (journal)

{{JOURNAL_CONTEXT}}

Based on the diagnosis above, output ONLY a JSON Array with ONE focused patch.

**選擇正確的 patch 格式：**

格式 A（優先使用）— AST 節點整體替換：
適用條件：替換整個頂層函數、const/let/var 宣告、或 Foo.bar = ... 賦值。
`target_node` 格式：`ClassName.methodName`（如 "DecisionEngine.makeDecision"）或頂層識別符（如 "isFailed"）。
`replace` 填入完整的新版節點文字（從 function/const/let/var 或 Foo.bar 到結尾的 }）。
優點：精準替換，不需指定 "file"（系統自動從 codebase 索引解析路徑）。

格式 B（備用）— 字串精確替換：
適用條件：只修改函數內部幾行，不替換整個函數時才用此格式。
`search` 必須是目標檔案中某段連續的精確子字串（不可省略、不可加省略號）。
`file` 必須填入（如 "src/brain.js"）。格式 A 不需要 "file"。
常見失敗：把函數簽名那一行放進 search、但 replace 是完整函數體 → 舊函數體殘留 → 語法錯誤。

每個 patch 物件必須包含：
- "mode": "core_patch"
- "target_node"（格式 A）或 "search" + "file"（格式 B）
- "replace"：替換後的完整文字
- "affected_files"：其他 src/ 下呼叫被修改函數/方法的檔案清單
- "confidence": 0.0-1.0，對這個 patch 正確性的信心
- "risk_level": "low" | "medium" | "high"，改動風險評估
- "expected_outcome": 改完後預期行為變化（一句話）

Keep the patch small and focused. ONE change only.
If you have no confident patch to propose, output exactly: []
