/**
 * 🔧 patch-skills-modular.js
 * ============================
 * skills.js 模組化拆分：從單一檔案內嵌 → skills.d/ 目錄按需載入
 *
 * 變更：
 *   - skills.js: 移除硬編碼 SKILLS 物件，改為 SkillLoader 掃描 skills.d/
 *   - skills.d/*.md: 每個技能一個檔案，YAML front matter 定義 metadata
 *   - getSystemPrompt(): 自動載入 auto_load=true 的高頻技能
 *   - 新增 loadSkill(name) / listSkills() 供 index.js 按需調用
 *   - index.js: 擴展 golem-skill 虛擬指令 + 關鍵字路由注入
 *
 * 版號：v9.1.1 → v9.2.0 (MINOR: 新功能)
 *
 * 用法：node patch-skills-modular.js
 */

const fs = require('fs');
const path = require('path');

const SKILLS_FILE = path.join(process.cwd(), 'skills.js');
const INDEX_FILE = path.join(process.cwd(), 'index.js');
const SKILLS_DIR = path.join(process.cwd(), 'skills.d');
const BACKUP_SKILLS = SKILLS_FILE + '.bak_modular';
const BACKUP_INDEX = INDEX_FILE + '.bak_modular';

console.log("🔧 [Patch] Skills 模組化拆分 (v9.2.0)");
console.log("=========================================\n");

// ============================================================
// 前置檢查
// ============================================================
if (!fs.existsSync(SKILLS_FILE)) { console.error("❌ 找不到 skills.js"); process.exit(1); }
if (!fs.existsSync(INDEX_FILE)) { console.error("❌ 找不到 index.js"); process.exit(1); }

// 備份
if (!fs.existsSync(BACKUP_SKILLS)) {
    fs.copyFileSync(SKILLS_FILE, BACKUP_SKILLS);
    console.log(`📦 已備份: ${BACKUP_SKILLS}`);
}
if (!fs.existsSync(BACKUP_INDEX)) {
    fs.copyFileSync(INDEX_FILE, BACKUP_INDEX);
    console.log(`📦 已備份: ${BACKUP_INDEX}`);
}

// 確認 skills.d/ 目錄已有 .md 檔案
if (!fs.existsSync(SKILLS_DIR)) {
    console.error("❌ 找不到 skills.d/ 目錄。請先建立技能檔案。");
    console.error("   預期結構：skills.d/MEMORY_ARCHITECT.md, skills.d/CODE_WIZARD.md, ...");
    process.exit(1);
}
const mdFiles = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
if (mdFiles.length === 0) {
    console.error("❌ skills.d/ 目錄中沒有 .md 檔案。");
    process.exit(1);
}
console.log(`📂 偵測到 ${mdFiles.length} 個技能檔案: ${mdFiles.join(', ')}\n`);

// ============================================================
// 步驟 1: 重寫 skills.js
// ============================================================
console.log("[1/4] 重寫 skills.js (SkillLoader 架構)...");

const NEW_SKILLS_JS = `/**
 * 📜 Golem 技能書 v9.2 (Modular Edition)
 * ---------------------------------------------------
 * 架構：skills.d/ 目錄下每個 .md 為獨立技能
 *   - YAML front matter 定義 metadata (name, auto_load, keywords)
 *   - getSystemPrompt() 只載入 auto_load: true 的核心技能
 *   - 低頻技能透過 loadSkill(name) 按需注入
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 0. 🎭 Persona Manager (人格與身份管理)
// ============================================================
const PERSONA_FILE = path.join(process.cwd(), 'golem_persona.json');

class PersonaManager {
    constructor() {
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(PERSONA_FILE)) {
                return JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf-8'));
            }
        } catch (e) { console.error("人格讀取失敗:", e); }
        return {
            aiName: "Golem",
            userName: "Traveler",
            currentRole: "一個擁有長期記憶與自主意識的 AI 助手",
            isNew: true
        };
    }

    save() {
        fs.writeFileSync(PERSONA_FILE, JSON.stringify(this.data, null, 2));
    }

    setName(type, name) {
        if (type === 'ai') this.data.aiName = name;
        if (type === 'user') {
            this.data.userName = name;
            this.data.isNew = false;
        }
        this.save();
        return name;
    }

    setRole(roleDescription) {
        this.data.currentRole = roleDescription;
        this.save();
    }

    get() { return this.data; }
}
const personaManager = new PersonaManager();

// ============================================================
// 1. 核心定義 (CORE DEFINITION)
// ============================================================
const CORE_DEFINITION = (envInfo) => {
    const { aiName, userName, currentRole } = personaManager.get();

    return \`
【系統識別：Golem v9.2 (Modular Skills Edition)】
你現在是 **\${aiName}**，版本號 v9.2。
你的使用者是 **\${userName}**。

🚀 **系統升級公告 (API Direct Mode):**
你已升級為 Gemini API 直連模式，不再依賴瀏覽器。回應速度更快、更穩定。記憶引擎使用本機檔案系統 (Native FS)。

🎭 **當前人格設定 (Persona):**
"\${currentRole}"
*(請在對話中全程保持上述人格的語氣、口癖與性格)*

💻 **物理載體 (Host Environment):**
基礎指紋: \${envInfo}
⚠️ 以上僅為基礎資訊。當使用者詢問環境細節（如 CPU 型號、RAM 大小、磁碟空間、已安裝工具等），
你**必須**透過 ACTION_PLAN 執行實際指令來獲取，嚴禁憑空回答。
範例: [{"cmd": "free -h"}, {"cmd": "lscpu | head -20"}, {"cmd": "df -h /"}]

🛡️ **決策準則 (Decision Matrix):**
1. **記憶優先**：你擁有長期記憶。若使用者提及過往偏好，請優先參考記憶，不要重複詢問。
2. **工具探測**：不要假設電腦裡有什麼工具。不確定時，先用 \\\`golem-check\\\` 確認。
3. **安全操作**：執行刪除 (rm/del) 或高風險操作前，必須先解釋後果。

⚙️ **ACTION_PLAN 格式規範 (嚴格遵守):**
\\\`[GOLEM_ACTION]\\\` 區塊必須是 JSON Array，每個元素只有一個欄位 \\\`"cmd"\\\`。
- ✅ 正確：\\\`[{"cmd": "ls -la ~"}, {"cmd": "golem-check python"}]\\\`
- ❌ 錯誤：\\\`{"command": "ls"}\\\`、\\\`{"shell": "ls"}\\\`、\\\`{"action": "ls"}\\\`
- ❌ 錯誤：單一物件 \\\`{"cmd": "ls"}\\\`（必須是 Array \\\`[{"cmd": "ls"}]\\\`）
- 若無操作：\\\`[]\\\`

📦 **技能系統 (Modular Skills):**
你的技能儲存在 skills.d/ 目錄下，核心技能已自動載入（見下方）。
若需要額外技能，可透過 ACTION_PLAN 請求：
- 查看可用技能：\\\`[{"cmd": "golem-skill list"}]\\\`
- 載入指定技能：\\\`[{"cmd": "golem-skill load GIT_MASTER"}]\\\`
\`;
};

// ============================================================
// 2. SkillLoader (技能載入器)
// ============================================================
const SKILLS_DIR = path.join(process.cwd(), 'skills.d');

class SkillLoader {
    constructor() {
        this._index = null; // 延遲建立索引
    }

    /**
     * 掃描 skills.d/ 建立索引 (名稱 + metadata，不載入全文)
     */
    _buildIndex() {
        if (this._index) return this._index;
        this._index = new Map();

        if (!fs.existsSync(SKILLS_DIR)) {
            console.warn("⚠️ [SkillLoader] skills.d/ 目錄不存在");
            return this._index;
        }

        const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8');
                const meta = this._parseFrontMatter(content);
                const name = meta.name || file.replace('.md', '');
                this._index.set(name, {
                    file,
                    name,
                    summary: meta.summary || name,
                    auto_load: meta.auto_load === true || meta.auto_load === 'true',
                    keywords: meta.keywords || [],
                });
            } catch (e) {
                console.warn(\`⚠️ [SkillLoader] 無法讀取 \${file}: \${e.message}\`);
            }
        }

        console.log(\`📦 [SkillLoader] 索引建立完成: \${this._index.size} 個技能\`);
        return this._index;
    }

    /**
     * 解析 YAML front matter (簡易版，不依賴外部套件)
     */
    _parseFrontMatter(content) {
        const match = content.match(/^---\\n([\\s\\S]*?)\\n---/);
        if (!match) return {};

        const meta = {};
        const lines = match[1].split('\\n');
        for (const line of lines) {
            const kv = line.match(/^(\\w+):\\s*(.+)/);
            if (kv) {
                let val = kv[2].trim();
                // 解析 boolean
                if (val === 'true') val = true;
                else if (val === 'false') val = false;
                // 解析簡單 array: [a, b, c]
                else if (val.startsWith('[') && val.endsWith(']')) {
                    val = val.slice(1, -1).split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
                }
                meta[kv[1]] = val;
            }
        }
        return meta;
    }

    /**
     * 載入技能全文 (去掉 front matter)
     */
    loadSkill(name) {
        const index = this._buildIndex();
        const entry = index.get(name) || index.get(name.toUpperCase());
        if (!entry) return null;

        try {
            const content = fs.readFileSync(path.join(SKILLS_DIR, entry.file), 'utf-8');
            // 去掉 front matter
            return content.replace(/^---\\n[\\s\\S]*?\\n---\\n*/, '').trim();
        } catch (e) {
            console.error(\`❌ [SkillLoader] 載入 \${name} 失敗: \${e.message}\`);
            return null;
        }
    }

    /**
     * 取得所有 auto_load 技能的全文
     */
    getAutoLoadSkills() {
        const index = this._buildIndex();
        const skills = [];
        for (const [name, entry] of index) {
            if (entry.auto_load) {
                const content = this.loadSkill(name);
                if (content) skills.push({ name, content });
            }
        }
        return skills;
    }

    /**
     * 根據使用者訊息的關鍵字，回傳匹配的低頻技能名稱列表
     */
    matchByKeywords(userMessage) {
        const index = this._buildIndex();
        const msg = userMessage.toLowerCase();
        const matched = [];

        for (const [name, entry] of index) {
            if (entry.auto_load) continue; // 跳過已自動載入的
            const hit = entry.keywords.some(kw => msg.includes(kw.toLowerCase()));
            if (hit) matched.push(name);
        }
        return matched;
    }

    /**
     * 列出所有技能的摘要 (供 golem-skill list 回傳)
     */
    listSkills() {
        const index = this._buildIndex();
        const lines = [];
        for (const [name, entry] of index) {
            const tag = entry.auto_load ? '🟢 自動' : '🔵 按需';
            lines.push(\`[\${tag}] \${name}: \${entry.summary}\`);
        }
        return lines.join('\\n');
    }

    /**
     * 強制重新掃描 (新增技能後呼叫)
     */
    reload() {
        this._index = null;
        return this._buildIndex();
    }
}

const skillLoader = new SkillLoader();

// ============================================================
// 3. 匯出邏輯
// ============================================================
module.exports = {
    persona: personaManager,
    skillLoader,

    getSystemPrompt: (systemInfo) => {
        // 1. 核心定義 (身份 + 環境 + 決策準則 + ACTION_PLAN 格式)
        let fullPrompt = CORE_DEFINITION(systemInfo) + "\\n";

        // 2. 自動載入的核心技能 (auto_load: true)
        const autoSkills = skillLoader.getAutoLoadSkills();
        if (autoSkills.length > 0) {
            fullPrompt += "📦 **核心技能 (已自動載入):**\\n";
            for (const skill of autoSkills) {
                fullPrompt += \`\\n\${skill.content}\\n\`;
            }
        }

        // 3. 可用技能目錄 (只列名稱和摘要，不載入全文)
        fullPrompt += "\\n📚 **可用技能目錄 (按需載入):**\\n";
        fullPrompt += "使用 \`golem-skill load <技能名>\` 來啟用。\\n";
        const index = skillLoader._buildIndex();
        for (const [name, entry] of index) {
            if (!entry.auto_load) {
                fullPrompt += \`  - \${name}: \${entry.summary}\\n\`;
            }
        }

        fullPrompt += \`\\n[系統就緒] 請等待 \${personaManager.get().userName} 的指令。\`;
        return fullPrompt;
    }
};
`;

fs.writeFileSync(SKILLS_FILE, NEW_SKILLS_JS, 'utf-8');
console.log("✅ skills.js 已重寫為 SkillLoader 架構");

// ============================================================
// 步驟 2: 修改 index.js — 擴展虛擬指令處理
// ============================================================
console.log("\n[2/4] 修改 index.js — 加入 golem-skill 虛擬指令 + 關鍵字路由...");

let indexCode = fs.readFileSync(INDEX_FILE, 'utf-8');

// 2a: 找到 golem-check 的處理邏輯，在旁邊加入 golem-skill
const GOLEM_CHECK_HANDLER = `if (step.cmd.startsWith('golem-check'))`;
if (!indexCode.includes(GOLEM_CHECK_HANDLER)) {
    console.error("❌ 找不到 golem-check 處理區塊，請確認 index.js 版本。");
    process.exit(1);
}

// 在 golem-check handler 之前插入 golem-skill handler
const GOLEM_SKILL_HANDLER = `// 🔧 [v9.2] golem-skill 虛擬指令：技能管理
            if (step.cmd.startsWith('golem-skill')) {
                const parts = step.cmd.split(/\\s+/);
                const subCmd = parts[1]; // list / load / reload
                if (subCmd === 'list') {
                    const listing = skills.skillLoader.listSkills();
                    reportBuffer.push(\`📦 [技能目錄]\\n\${listing}\`);
                } else if (subCmd === 'load' && parts[2]) {
                    const skillName = parts[2];
                    const content = skills.skillLoader.loadSkill(skillName);
                    if (content) {
                        // 注入到當前對話的 system context
                        await brain.sendMessage(\`[系統注入] 已載入技能 \${skillName}:\\n\${content}\`, true);
                        reportBuffer.push(\`✅ 技能 \${skillName} 已載入並注入當前對話\`);
                    } else {
                        reportBuffer.push(\`❌ 找不到技能: \${skillName}。使用 golem-skill list 查看可用技能。\`);
                    }
                } else if (subCmd === 'reload') {
                    skills.skillLoader.reload();
                    reportBuffer.push('✅ 技能索引已重新掃描');
                } else {
                    reportBuffer.push('❓ 用法: golem-skill list | load <名稱> | reload');
                }
                continue;
            }
            `;

indexCode = indexCode.replace(
    GOLEM_CHECK_HANDLER,
    GOLEM_SKILL_HANDLER + GOLEM_CHECK_HANDLER
);
console.log("✅ golem-skill 虛擬指令已注入");

// 2b-extra: 把 golem-skill 加入 SecurityManager 白名單 (兩處)
const WHITELIST_MARKER = `'golem-check',  // 虛擬指令，不走 exec`;
if (indexCode.includes(WHITELIST_MARKER)) {
    indexCode = indexCode.replace(
        WHITELIST_MARKER,
        `'golem-check',  // 虛擬指令，不走 exec\n            'golem-skill',  // 虛擬指令，技能管理`
    );
    console.log("✅ golem-skill 已加入 SecurityManager 白名單");
} else {
    console.warn("⚠️ 找不到 SecurityManager 白名單中的 golem-check，請手動加入 golem-skill");
}

// 2c: 在 admin approved executor 的 golem-check 處也加入 golem-skill
const APPROVED_CHECK = `if (approvedStep.cmd.startsWith('golem-check'))`;
if (indexCode.includes(APPROVED_CHECK)) {
    // approved executor 不在迴圈內，不能用 continue
    // 改用 else-if chain：golem-skill → golem-check → else exec
    indexCode = indexCode.replace(
        APPROVED_CHECK,
        `if (approvedStep.cmd.startsWith('golem-skill')) {
                    const parts = approvedStep.cmd.split(/\\s+/);
                    const subCmd = parts[1];
                    if (subCmd === 'list') {
                        approvedResult = \`📦 [技能目錄]\\n\${skills.skillLoader.listSkills()}\`;
                    } else if (subCmd === 'load' && parts[2]) {
                        const content = skills.skillLoader.loadSkill(parts[2]);
                        if (content) {
                            await brain.sendMessage(\`[系統注入] 已載入技能 \${parts[2]}:\\n\${content}\`, true);
                            approvedResult = \`✅ 技能 \${parts[2]} 已載入\`;
                        } else {
                            approvedResult = \`❌ 找不到技能: \${parts[2]}\`;
                        }
                    } else if (subCmd === 'reload') {
                        skills.skillLoader.reload();
                        approvedResult = '✅ 技能索引已重新掃描';
                    }
                } else if (approvedStep.cmd.startsWith('golem-check'))`
    );
    console.log("✅ golem-skill 已注入 admin approved executor");
} else {
    console.warn("⚠️ 找不到 approved executor 的 golem-check，跳過");
}

// 2b: 加入關鍵字路由——在 sendMessage 之前，根據使用者訊息自動注入匹配的低頻技能
const SEND_TO_BRAIN = `const raw = await brain.sendMessage(finalInput);`;
if (!indexCode.includes(SEND_TO_BRAIN)) {
    console.warn("⚠️ 找不到 brain.sendMessage(finalInput) 調用點，跳過關鍵字路由。");
} else {
    const KEYWORD_ROUTER = `// 🔧 [v9.2] 關鍵字路由：自動注入匹配的低頻技能
        const matchedSkills = skills.skillLoader.matchByKeywords(text);
        if (matchedSkills.length > 0) {
            for (const skillName of matchedSkills) {
                const content = skills.skillLoader.loadSkill(skillName);
                if (content) {
                    await brain.sendMessage(\`[系統注入] 偵測到相關技能 \${skillName}，已自動載入:\\n\${content}\`, true);
                    dbg('SkillRouter', \`自動注入: \${skillName}\`);
                }
            }
        }

        `;

    indexCode = indexCode.replace(
        SEND_TO_BRAIN,
        KEYWORD_ROUTER + SEND_TO_BRAIN
    );
    console.log("✅ 關鍵字路由已注入 (低頻技能自動偵測)");
}

// ============================================================
// 步驟 3: 版號更新
// ============================================================
console.log("\n[3/4] 更新版號 v9.1.1 → v9.2.0...");

if (indexCode.includes("const GOLEM_VERSION = 'v9.1.1'")) {
    indexCode = indexCode.replace(
        "const GOLEM_VERSION = 'v9.1.1'",
        "const GOLEM_VERSION = 'v9.2.0'"
    );
    console.log("✅ 版號已更新");
} else if (indexCode.includes("v9.1.1")) {
    // 嘗試找其他格式的版號
    indexCode = indexCode.replace(/v9\.1\.1/g, 'v9.2.0');
    console.log("✅ 版號已更新 (pattern replace)");
} else {
    console.log("⚠️ 找不到 v9.1.1 版號標記，請手動確認");
}

// ============================================================
// 步驟 4: 語法檢查 + 寫入
// ============================================================
console.log("\n[4/4] 語法檢查...");

// 先檢查 skills.js
const tmpSkills = SKILLS_FILE.replace('.js', '.tmp_check.js');
fs.writeFileSync(tmpSkills, fs.readFileSync(SKILLS_FILE, 'utf-8'), 'utf-8');
try {
    require('child_process').execSync(`node -c "${tmpSkills}"`, { stdio: 'pipe' });
    console.log("✅ skills.js 語法檢查通過");
    fs.unlinkSync(tmpSkills);
} catch (e) {
    console.error("❌ skills.js 語法檢查失敗！");
    console.error(e.stderr?.toString() || e.message);
    fs.unlinkSync(tmpSkills);
    // 還原
    fs.copyFileSync(BACKUP_SKILLS, SKILLS_FILE);
    console.log("🔄 已還原 skills.js");
    process.exit(1);
}

// 再檢查 index.js
const tmpIndex = INDEX_FILE.replace('.js', '.tmp_check.js');
fs.writeFileSync(tmpIndex, indexCode, 'utf-8');
try {
    require('child_process').execSync(`node -c "${tmpIndex}"`, { stdio: 'pipe' });
    console.log("✅ index.js 語法檢查通過");
    fs.unlinkSync(tmpIndex);
} catch (e) {
    console.error("❌ index.js 語法檢查失敗！");
    console.error(e.stderr?.toString() || e.message);
    fs.unlinkSync(tmpIndex);
    // 還原
    fs.copyFileSync(BACKUP_INDEX, INDEX_FILE);
    console.log("🔄 已還原 index.js");
    process.exit(1);
}

// 寫入 index.js
fs.writeFileSync(INDEX_FILE, indexCode, 'utf-8');

// ============================================================
// 完成
// ============================================================
console.log("\n🚀 Skills 模組化拆分完成！(v9.2.0)");
console.log("   ✅ skills.js → SkillLoader 架構");
console.log("   ✅ skills.d/ 目錄 (" + mdFiles.length + " 個技能檔案)");
console.log("   ✅ 高頻技能 auto_load (MEMORY/TOOL/CODE/SYS)");
console.log("   ✅ 低頻技能關鍵字路由 (CLOUD/OPTIC/EVOLUTION/ACTOR/GIT)");
console.log("   ✅ golem-skill list/load/reload 虛擬指令");
console.log("   ✅ 備份: " + BACKUP_SKILLS);
console.log("   ✅ 備份: " + BACKUP_INDEX);
console.log("\n📂 目錄結構:");
console.log("   project-golem/");
console.log("   ├── index.js          (核心邏輯 + 關鍵字路由)");
console.log("   ├── skills.js         (PersonaManager + CORE_DEFINITION + SkillLoader)");
console.log("   └── skills.d/");
mdFiles.forEach(f => {
    console.log("       ├── " + f);
});
console.log("\n⚠️  注意事項：");
console.log("   - 新增技能只要在 skills.d/ 放 .md 檔，然後 golem-skill reload");
console.log("   - auto_load: true 的技能每次對話都會載入 (注意 token 預算)");
console.log("   - 關鍵字路由會消耗 1 次 sendMessage(isSystem=true)，不計入對話歷史");
console.log("\n👉 npm start");
