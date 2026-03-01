/**
 * @module skills
 * @role 系統 prompt 組裝 — 合併 soul.md、PersonaManager 覆蓋、SkillLoader 技能目錄
 * @when-to-modify 調整 getSystemPrompt 組裝順序、或 CORE_DEFINITION 模板載入邏輯時
 *
 * 子模組：
 *   persona-manager.js — PersonaManager（人格資料持久化）
 *   skill-loader.js    — SkillLoader（skills.d/ 索引與載入）
 */
const fs = require('fs');
const path = require('path');
const PersonaManager = require('./persona-manager');
const SkillLoader = require('./skill-loader');

const GOLEM_VERSION = require('../package.json').version;

const personaManager = new PersonaManager();
const skillLoader = new SkillLoader();

// === 系統 prompt 核心區塊：載入模板 + soul.md + persona 覆蓋 ===
const CORE_DEFINITION = (envInfo) => {
    const promptsDir = path.join(process.cwd(), 'prompts');
    let template = '';
    try {
        template = fs.readFileSync(path.join(promptsDir, 'system-core.md'), 'utf-8');
    } catch (e) {
        console.warn('⚠️ [Prompts] prompts/system-core.md 讀取失敗，使用 fallback');
        template = '【你的身份與價值觀】\n{{SOUL}}\n{{PERSONA}}\n【系統版本】Golem v{{VERSION}}';
    }

    let soulContent = '';
    try {
        const soulPath = path.join(process.cwd(), 'soul.md');
        if (fs.existsSync(soulPath)) {
            soulContent = fs.readFileSync(soulPath, 'utf-8');
        }
    } catch (e) { /* soul.md 不存在時跳過 */ }

    const persona = personaManager.get();
    let personaOverride = '';
    if (!persona.isNew) {
        personaOverride = '\n【使用者偏好覆蓋】\n使用者希望你稱呼他為：' + persona.userName + '\n';
        if (persona.aiName !== 'Golem Beta' && persona.aiName !== 'Golem') {
            personaOverride += '使用者希望你叫：' + persona.aiName + '\n';
        }
    }

    let result = template
        .replace('{{SOUL}}', soulContent || '(soul.md 不存在 — 請參考 README 建立你的靈魂文件)')
        .replace('{{PERSONA}}', personaOverride)
        .replace('{{VERSION}}', GOLEM_VERSION)
        .replace('{{ENV_INFO}}', envInfo);

    const remaining = result.match(/\{\{\w+\}\}/g);
    if (remaining) {
        console.warn('⚠️ [Prompts] 未替換的 placeholder:', remaining.join(', '));
    }
    return result;
};

module.exports = {
    persona: personaManager,
    skillLoader,

    getSystemPrompt: (systemInfo) => {
        let fullPrompt = CORE_DEFINITION(systemInfo) + "\n";

        const autoSkills = skillLoader.getAutoLoadSkills();
        if (autoSkills.length > 0) {
            fullPrompt += "📦 **核心技能 (已自動載入):**\n";
            for (const skill of autoSkills) {
                fullPrompt += `\n${skill.content}\n`;
            }
        }

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
