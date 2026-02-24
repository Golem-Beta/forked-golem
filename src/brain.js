/**
 * 🧠 GolemBrain — API Direct Headless Edition
 * 依賴：fs, path, os, CONFIG, skills, memory-drivers
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const CONFIG = require('./config');
const { cleanEnv } = CONFIG;
const skills = require('./skills');
const { SystemQmdDriver, SystemNativeDriver } = require('./memory-drivers');

function getSystemFingerprint() {
    return `OS: ${os.platform()} | Arch: ${os.arch()} | Mode: ${cleanEnv(process.env.GOLEM_MEMORY_MODE || 'native')}`;
}

class GolemBrain {
    constructor(modelRouter) {
        this.router = modelRouter;
        this.chatHistory = [];
        this.model = null;
        this._initialized = false;

        const mode = cleanEnv(process.env.GOLEM_MEMORY_MODE || 'native').toLowerCase();
        console.log(`⚙️ [System] 記憶引擎模式: ${mode.toUpperCase()}`);

        if (mode === 'qmd') {
            this.memoryDriver = new SystemQmdDriver(CONFIG);
        } else {
            this.memoryDriver = new SystemNativeDriver();
        }
    }

    async init(forceReload = false) {
        if (this._initialized && !forceReload) return;

        if (!this.router || this.router.adapters.size === 0) {
            throw new Error("❌ ModelRouter 無可用 provider，無法啟動。");
        }

        try {
            await this.memoryDriver.init();
        } catch (e) {
            console.warn(`🔄 [System] 記憶引擎啟動失敗 (${e.message})，降級為 Native FS...`);
            this.memoryDriver = new SystemNativeDriver();
            await this.memoryDriver.init();
        }

        const systemPrompt = skills.getSystemPrompt(getSystemFingerprint());
        let protocol = '';
        try {
            protocol = '\n' + fs.readFileSync(path.join(process.cwd(), 'prompts', 'tristream-protocol.md'), 'utf-8');
        } catch (e) {
            console.warn('⚠️ [Prompts] prompts/tristream-protocol.md 讀取失敗，三流協定缺失');
        }

        this.systemInstruction = systemPrompt + protocol;
        this.chatHistory = [];
        this._initialized = true;

        console.log("🧠 [Brain] ModelRouter 已就緒");
    }

    async recall(queryText) {
        if (!queryText) return [];
        try {
            console.log(`🧠 [Memory] 正在檢索: "${queryText.substring(0, 20)}..."`);
            return await this.memoryDriver.recall(queryText);
        } catch (e) {
            console.error("記憶讀取失敗:", e.message);
            return [];
        }
    }

    async memorize(text, metadata = {}) {
        try {
            await this.memoryDriver.memorize(text, metadata);
            console.log("🧠 [Memory] 已寫入長期記憶");
        } catch (e) {
            console.error("記憶寫入失敗:", e.message);
        }
    }

    async sendMessage(text, isSystem = false) {
        if (!this._initialized) await this.init();

        if (isSystem) {
            this.chatHistory.push({ role: 'user', parts: [{ text }] });
            this.chatHistory.push({ role: 'model', parts: [{ text: '(系統指令已接收)' }] });
            return "";
        }

        console.log(`📡 [Brain] 發送至 ModelRouter (${text.length} chars)...`);

        const result = await this.router.complete({
            intent: 'chat',
            messages: [{ role: 'user', content: text }],
            maxTokens: 8192,
            temperature: 0.7,
            systemInstruction: this.systemInstruction,
            tools: [{ googleSearch: {} }],
            chatHistory: this.chatHistory,
        });

        const response = result.text;

        this.chatHistory.push({ role: 'user', parts: [{ text }] });
        this.chatHistory.push({ role: 'model', parts: [{ text: response }] });
        if (this.chatHistory.length > 40) {
            this.chatHistory = this.chatHistory.slice(-40);
        }

        console.log(`✅ [Brain] 回應接收完成 (${response.length} chars, via ${result.meta.provider}/${result.meta.model})`);

        return response
            .replace('—-回覆開始—-', '')
            .replace('—-回覆結束—-', '')
            .trim();
    }
}

module.exports = { GolemBrain, getSystemFingerprint };
