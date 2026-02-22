/**
 * 📝 Prompt 模板載入器
 * 依賴：fs, path（Node.js 內建）
 */
const fs = require('fs');
const path = require('path');

function loadPrompt(name, vars = {}) {
    try {
        const fp = path.join(process.cwd(), 'prompts', name);
        let text = fs.readFileSync(fp, 'utf-8');
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll('{{' + k + '}}', v || '');
        }
        return text;
    } catch (e) {
        console.warn('[PromptLoader] ' + name + ' 載入失敗:', e.message);
        return null;
    }
}

function loadFeedbackPrompt(section, vars = {}) {
    try {
        const fp = path.join(process.cwd(), 'prompts', 'observation-feedback.md');
        const full = fs.readFileSync(fp, 'utf-8');
        const regex = new RegExp('## ' + section + '\n([\\s\\S]*?)(?=\\n## |$)');
        const match = full.match(regex);
        if (!match) return null;
        let text = match[1].trim();
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll('{{' + k + '}}', v || '');
        }
        return text;
    } catch (e) {
        console.warn('[PromptLoader] feedback section ' + section + ' 載入失敗:', e.message);
        return null;
    }
}

module.exports = { loadPrompt, loadFeedbackPrompt };
