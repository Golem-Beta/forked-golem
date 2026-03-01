/**
 * @module persona-manager
 * @role 人格資料持久化 — aiName / userName / currentRole 讀寫
 * @when-to-modify 調整 persona 預設值、soul.md 解析邏輯、或欄位結構時
 */
const fs = require('fs');
const path = require('path');

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

module.exports = PersonaManager;
