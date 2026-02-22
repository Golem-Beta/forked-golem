/**
 * 🔍 ToolScanner + 📖 HelpManager
 * 依賴：os, child_process (Node built-in), CONFIG, Introspection, skills
 */
const os = require('os');
const { execSync } = require('child_process');
const CONFIG = require('./config');
const { cleanEnv } = CONFIG;
const { Introspection } = require('./upgrader');
const skills = require('./skills');

class ToolScanner {
    static check(toolName) {
        const isWin = os.platform() === 'win32';
        const checkCmd = isWin ? `where ${toolName}` : `which ${toolName}`;
        try {
            const p = execSync(checkCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0];
            return `✅ **已安裝**: \`${toolName}\`\n路徑: ${p}`;
        } catch (e) {
            return `❌ **未安裝**: \`${toolName}\`\n(系統找不到此指令)`;
        }
    }
}

class HelpManager {
    static getManual() {
        const source = Introspection.readSelf();
        const routerPattern = /text\.(?:startsWith|match)\(['"]\/?([a-zA-Z0-9_|]+)['"]\)/g;
        const foundCmds = new Set(['help', 'callme', 'patch', 'update', 'donate']);
        let match;
        while ((match = routerPattern.exec(source)) !== null) {
            foundCmds.add(match[1].replace(/\|/g, '/').replace(/[\^\(\)]/g, ''));
        }
        let skillList = "基礎系統操作";
        try { skillList = Object.keys(skills).filter(k => k !== 'persona' && k !== 'getSystemPrompt').join(', '); } catch (e) { }

        return `
🤖 **Golem v8.5 (Neuro-Link)**
---------------------------
⚡ **Node.js**: Reflex Layer + Action Executor
🧠 **Web Gemini**: Infinite Context Brain
🌗 **Dual-Memory**: ${cleanEnv(process.env.GOLEM_MEMORY_MODE || 'native')} mode
⚓ **Sync Mode**: Tri-Stream Protocol (Memory/Action/Reply)
🔍 **Auto-Discovery**: Active
🚑 **DOM Doctor**: v2.0 (Self-Healing)
👁️ **OpticNerve**: Vision Enabled
🔌 **Neuro-Link**: CDP Network Interception Active
📡 **連線狀態**: TG(${CONFIG.TG_TOKEN ? '✅' : '⚪'}) / DC(${CONFIG.DC_TOKEN ? '✅' : '⚪'})

🛠️ **可用指令:**
${Array.from(foundCmds).map(c => `• \`/${c}\``).join('\n')}
🧠 **技能模組:** ${skillList}

☕ **支持開發者:**
${CONFIG.DONATE_URL}
`;
    }
}

module.exports = { ToolScanner, HelpManager };
