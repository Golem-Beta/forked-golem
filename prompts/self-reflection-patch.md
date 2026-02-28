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
The "search" field must EXACTLY match a substring in the target code above.
Include "file" field with the target file path (e.g. "src/brain.js").
Include "affected_files" listing other src/ files that call the modified function/method.
Include "confidence": 0.0-1.0，你對這個 patch 正確性的信心。
Include "risk_level": "low" | "medium" | "high"，改動風險評估。
Include "expected_outcome": 改完後預期行為變化（一句話）。
Keep the patch small and focused. ONE change only.
If you have no confident patch to propose, output exactly: []
