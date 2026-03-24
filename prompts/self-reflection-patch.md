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

## RECENTLY REJECTED PATCHES（近期被否決的 patch 原因，必須主動迴避）

以下是近期 patch 被否決的具體原因。生成新 patch 時，**不得重複觸發相同原因**：

{{REJECTED_REASONS}}

⚠️ 特別注意：**不得在 replace 中呼叫 this.xxx() 形式的方法，除非該方法已明確出現在 CODE_SNIPPET 的已知方法清單（known methods）中**。
若需要某個功能，請直接用已知方法或標準 Node.js API 實現，不要發明不存在的方法。

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
- class method：只填方法本身，**不含** class 外框的 `}`
- ⚠️ **class method 的 `replace` 必須是完整方法體**：從方法簽名（`async methodName(`、`static methodName(`、`methodName(`）開頭，到方法自己的 `}` 結尾。不可只給方法內部的片段，也不可在結尾多加 class 外框的 `}`。違反任一條均會讓 `node -c` 爆 `Unexpected token '{'` 或整個 class 語法錯誤，patch 被丟棄。
  - ❌ 錯誤一：replace 從 `try {` 開始（缺少方法簽名，`node -c` 爆 `Unexpected token '{'`）
  - ❌ 錯誤二：replace 結尾多一個 class 的 `}`（class 語法錯誤）
  - ✅ 正確：`async makeDecision() {\n  ...\n}`（完整方法，只到自己的 `}`）
- 縮排由系統自動正規化，不需手動對齊原始縮排
- ⚠️ **換行符必須轉義**：`replace` 值內的所有換行符必須寫成 `\n`，不可使用實際換行。違反此規則會導致 JSON.parse() 失敗，patch 被完全丟棄。
  - ❌ 嚴禁 JS 字串拼接：`"line1\n" + "line2\n" + "line3"` 是 JavaScript 語法，**不是合法 JSON**，會被直接丟棄
  - ✅ 正確：整個 replace 是單一 JSON 字串：`"line1\nline2\nline3"`
- ⚠️ **Regex 在 `replace` 欄位中有兩層 escape 規則**，違反任一條都會導致 `node -c` 失敗，patch 被丟棄：
  1. **`/` 必須轉義為 `\/`**：regex 字面量中含有 `/` 字元（例如 `<\/think>`、`<\/script>`）必須寫成 `\\/`，否則 `/` 會提前終止 regex，後面的文字被解析為非法 flags。
     - ❌ 錯誤：`raw.replace(/<think>[\\s\\S]*?</think>/g, '')`
     - ✅ 正確：`raw.replace(/<think>[\\s\\S]*?<\/think>/g, '')`
  2. **`\s` `\S` `\d` `\w` 等 regex escape 序列必須雙重轉義**：在 JSON 字串中，一個反斜線需寫成 `\\`，所以 regex 的 `[\s\S]` 在 `replace` 欄位中必須寫成 `[\\s\\S]`。
     - ❌ 錯誤：`[\s\S]`（JSON 解析炸：Bad escaped character）
     - ✅ 正確：`[\\s\\S]`（JSON 解析後得到 `[\s\S]`，寫入 .js 為合法 whitespace class）

不需要指定 `"file"`——系統自動從 codebase 索引解析檔案路徑。

❌ **Format B（search 字串替換）已永久廢除**，任何含 `search` 欄位的 patch 一律被拒絕。

每個 patch 物件必須包含：
- "mode": "core_patch"
- "target_node"：見上方格式說明
- "replace"：替換後的完整文字
- "affected_files"：其他 src/ 下呼叫被修改函數/方法的檔案清單
- "confidence": 0.0-1.0，對這個 patch 正確性的信心
- "risk_level": "low" | "medium" | "high"，改動風險評估
  ⚠️ risk_level 必須如實反映改動的實際風險，不得為了通過自動部署門檻而降低評級。
  安全邊界、autoDeploy 條件、risk_level 評估邏輯本身 → 一律標記為 "high"。
- "expected_outcome": 改完後預期行為變化（一句話）

**Atomic change 規則（強制）**：
一個 proposal 只能包含一個邏輯上不可分割的改動。
若診斷出多個問題，只選最重要的一個提案，其餘留待下次 reflection。
把多個改動打包進同一個 patch 會導致整個 proposal 被拒絕。

Keep the patch small and focused. ONE change only.
⚠️ **如果 DIAGNOSIS 已提供具體問題且 CODE_SNIPPET 非空，你必須輸出至少一個 patch proposal。**
只有在以下情況才允許輸出 `[]`：
- CODE_SNIPPET 為空或無法理解
- 問題已在其他 patch 中修復（journal 明確顯示）
- 你確認 patch 會造成比問題本身更大的破壞

If none of the above apply and a diagnosis is provided, output a patch. Do not output `[]` just because you are uncertain — low confidence is acceptable, set confidence accordingly.
