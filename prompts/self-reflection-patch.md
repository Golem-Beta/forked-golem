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

**唯一可用格式：格式 A — AST 節點整體替換**

`target_node` 指定要替換的節點，支援以下格式：

| 情境 | target_node 值 |
|---|---|
| 頂層函數 | `"myFunc"` |
| 頂層 const/let/var | `"MY_CONST"` |
| 整個 class | `"ClassName"` |
| class 一般 method | `"ClassName.methodName"` |
| class static method | `"ClassName.methodName"` |
| class async method | `"ClassName.methodName"` |

⚠️ **constructor 高風險**：替換 constructor 可能破壞整個 class 初始化流程，強烈建議避免。
❌ **private method 不支援**：`#bar` 形式的 private method 無法被定位，嘗試使用會拋出錯誤。

`replace` 填入完整的新版節點文字：
- 頂層函數：從 `function` 開頭到結尾的 `}`
- class method：只填方法本身（從方法名稱/static/async 到結尾的 `}`），**不含** class 外框
- 縮排由系統自動正規化，不需手動對齊原始縮排

不需要指定 `"file"`——系統自動從 codebase 索引解析檔案路徑。

❌ **Format B（search 字串替換）已永久廢除**，任何含 `search` 欄位的 patch 一律被拒絕。

每個 patch 物件必須包含：
- "mode": "core_patch"
- "target_node"：見上方格式說明
- "replace"：替換後的完整文字
- "affected_files"：其他 src/ 下呼叫被修改函數/方法的檔案清單
- "confidence": 0.0-1.0，對這個 patch 正確性的信心
- "risk_level": "low" | "medium" | "high"，改動風險評估
- "expected_outcome": 改完後預期行為變化（一句話）

Keep the patch small and focused. ONE change only.
If you have no confident patch to propose, output exactly: []
