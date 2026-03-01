/**
 * @module skill-loader
 * @role skills.d/ 技能索引與載入 — 掃描 front matter、按需/自動載入、關鍵字匹配
 * @when-to-modify 調整技能索引邏輯、front matter 解析規則、或新增載入策略時
 */
const fs = require('fs');
const path = require('path');

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

module.exports = SkillLoader;
