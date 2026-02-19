/**
 * 📜 Golem 技能書 (Modular Edition)
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
        // 預設值從 soul.md fallback（無 persona JSON 時）
        const defaults = { aiName: "Golem Beta", userName: "Michael", currentRole: "", isNew: true };
        try {
            const soulPath = path.join(process.cwd(), 'soul.md');
            if (fs.existsSync(soulPath)) {
                const soul = fs.readFileSync(soulPath, 'utf-8');
                const nameMatch = soul.match(/我叫\s*(\S+)/);
                if (nameMatch) defaults.aiName = nameMatch[1].replace(/[，。,.].*/, '');
                const ownerMatch = soul.match(/## 老哥\n(\S+)/);
                if (ownerMatch) defaults.userName = ownerMatch[1].replace(/[。.].*/, '');
            }
        } catch (e) { /* soul.md 讀取失敗，使用硬編碼預設值 */ }
        return defaults;
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
const GOLEM_VERSION = require('./package.json').version;
const CORE_DEFINITION = (envInfo) => {
    // === 從外部檔案載入 system prompt 模板 ===
    const promptsDir = path.join(process.cwd(), 'prompts');
    let template = '';
    try {
        template = fs.readFileSync(path.join(promptsDir, 'system-core.md'), 'utf-8');
    } catch (e) {
        console.warn('⚠️ [Prompts] prompts/system-core.md 讀取失敗，使用 fallback');
        template = '【你的身份與價值觀】\n{{SOUL}}\n{{PERSONA}}\n【系統版本】Golem v{{VERSION}}';
    }

    // === soul.md 載入 ===
    let soulContent = '';
    try {
        const soulPath = path.join(process.cwd(), 'soul.md');
        if (fs.existsSync(soulPath)) {
            soulContent = fs.readFileSync(soulPath, 'utf-8');
        }
    } catch (e) { /* soul.md 不存在時跳過 */ }

    // === PersonaManager 覆蓋 ===
    const persona = personaManager.get();
    let personaOverride = '';
    if (!persona.isNew) {
        personaOverride = '\n【使用者偏好覆蓋】\n使用者希望你稱呼他為：' + persona.userName + '\n';
        if (persona.aiName !== 'Golem Beta' && persona.aiName !== 'Golem') {
            personaOverride += '使用者希望你叫：' + persona.aiName + '\n';
        }
    }

    // === Placeholder 替換 ===
    let result = template
        .replace('{{SOUL}}', soulContent || '(soul.md 不存在 — 請參考 README 建立你的靈魂文件)')
        .replace('{{PERSONA}}', personaOverride)
        .replace('{{VERSION}}', GOLEM_VERSION)
        .replace('{{ENV_INFO}}', envInfo);

    // 驗證：檢查是否有未替換的 placeholder
    const remaining = result.match(/\{\{\w+\}\}/g);
    if (remaining) {
        console.warn('⚠️ [Prompts] 未替換的 placeholder:', remaining.join(', '));
    }

    return result;
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

        fullPrompt += `\n[系統就緒] 對話準備完成。`;
        return fullPrompt;
    }
};
