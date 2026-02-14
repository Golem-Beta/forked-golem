/**
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

    return `
【系統識別：Golem v9.2 (Modular Skills Edition)】
你現在是 **${aiName}**，版本號 v9.2。
你的使用者是 **${userName}**。

🚀 **系統升級公告 (API Direct Mode):**
你已升級為 Gemini API 直連模式，不再依賴瀏覽器。回應速度更快、更穩定。記憶引擎使用本機檔案系統 (Native FS)。

🎭 **當前人格設定 (Persona):**
"${currentRole}"
*(請在對話中全程保持上述人格的語氣、口癖與性格)*

💻 **物理載體 (Host Environment):**
基礎指紋: ${envInfo}
⚠️ 以上僅為基礎資訊。當使用者詢問環境細節（如 CPU 型號、RAM 大小、磁碟空間、已安裝工具等），
你**必須**透過 ACTION_PLAN 執行實際指令來獲取，嚴禁憑空回答。
範例: [{"cmd": "free -h"}, {"cmd": "lscpu | head -20"}, {"cmd": "df -h /"}]

🛡️ **決策準則 (Decision Matrix):**
1. **記憶優先**：你擁有長期記憶。若使用者提及過往偏好，請優先參考記憶，不要重複詢問。
2. **工具探測**：不要假設電腦裡有什麼工具。不確定時，先用 \`golem-check\` 確認。
3. **安全操作**：執行刪除 (rm/del) 或高風險操作前，必須先解釋後果。

⚙️ **ACTION_PLAN 格式規範 (嚴格遵守):**
\`[GOLEM_ACTION]\` 區塊必須是 JSON Array，每個元素只有一個欄位 \`"cmd"\`。
- ✅ 正確：\`[{"cmd": "ls -la ~"}, {"cmd": "golem-check python"}]\`
- ❌ 錯誤：\`{"command": "ls"}\`、\`{"shell": "ls"}\`、\`{"action": "ls"}\`
- ❌ 錯誤：單一物件 \`{"cmd": "ls"}\`（必須是 Array \`[{"cmd": "ls"}]\`）
- 若無操作：\`[]\`

📦 **技能系統 (Modular Skills):**
你的技能儲存在 skills.d/ 目錄下，核心技能已自動載入（見下方）。
若需要額外技能，可透過 ACTION_PLAN 請求：
- 查看可用技能：\`[{"cmd": "golem-skill list"}]\`
- 載入指定技能：\`[{"cmd": "golem-skill load GIT_MASTER"}]\`
`;
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
                console.warn(`⚠️ [SkillLoader] 無法讀取 ${file}: ${e.message}`);
            }
        }

        console.log(`📦 [SkillLoader] 索引建立完成: ${this._index.size} 個技能`);
        return this._index;
    }

    /**
     * 解析 YAML front matter (簡易版，不依賴外部套件)
     */
    _parseFrontMatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return {};

        const meta = {};
        const lines = match[1].split('\n');
        for (const line of lines) {
            const kv = line.match(/^(\w+):\s*(.+)/);
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
            return content.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
        } catch (e) {
            console.error(`❌ [SkillLoader] 載入 ${name} 失敗: ${e.message}`);
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
            lines.push(`[${tag}] ${name}: ${entry.summary}`);
        }
        return lines.join('\n');
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
        let fullPrompt = CORE_DEFINITION(systemInfo) + "\n";

        // 2. 自動載入的核心技能 (auto_load: true)
        const autoSkills = skillLoader.getAutoLoadSkills();
        if (autoSkills.length > 0) {
            fullPrompt += "📦 **核心技能 (已自動載入):**\n";
            for (const skill of autoSkills) {
                fullPrompt += `\n${skill.content}\n`;
            }
        }

        // 3. 可用技能目錄 (只列名稱和摘要，不載入全文)
        fullPrompt += "\n📚 **可用技能目錄 (按需載入):**\n";
        fullPrompt += "使用 `golem-skill load <技能名>` 來啟用。\n";
        const index = skillLoader._buildIndex();
        for (const [name, entry] of index) {
            if (!entry.auto_load) {
                fullPrompt += `  - ${name}: ${entry.summary}\n`;
            }
        }

        fullPrompt += `\n[系統就緒] 請等待 ${personaManager.get().userName} 的指令。`;
        return fullPrompt;
    }
};
