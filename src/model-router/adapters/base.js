/**
 * ProviderAdapter — 所有 LLM provider adapter 的基底 class
 * 子類必須實作 complete() 方法
 */
const fs = require('fs');
const path = require('path');

class ProviderAdapter {
    constructor(name, config) {
        this.name = name;
        this.config = config;
        this._cooldownFile = path.join(process.cwd(), 'memory', 'cooldown-state.json');
    }

    /**
     * @param {object} params
     * @param {string} params.model - 該 provider 的模型名
     * @param {Array}  params.messages - OpenAI 格式 [{ role, content }]
     * @param {number} [params.maxTokens=4096]
     * @param {number} [params.temperature=0.7]
     * @param {boolean} [params.requireJson=false]
     * @param {string} [params.systemInstruction] - system prompt（獨立傳遞）
     * @param {Array}  [params.tools] - tool definitions（如 googleSearch）
     * @param {Array}  [params.inlineData] - multimodal data（圖片等）
     * @returns {Promise<{ text: string, usage: { inputTokens: number, outputTokens: number } }>}
     */
    async complete(params) {
        throw new Error(`${this.name}: complete() not implemented`);
    }

    /**
     * 快速檢查此 adapter 是否可用（有 key、未全部冷卻）
     */
    isAvailable() {
        return false;
    }

    // key 識別用後 8 碼
    _keyId(key) {
        return '...' + key.slice(-8);
    }

    _loadCooldownFromDisk() {
        try {
            if (!fs.existsSync(this._cooldownFile)) return;
            const all = JSON.parse(fs.readFileSync(this._cooldownFile, 'utf-8'));
            const providerData = all[this.name] || {};
            const now = Date.now();
            for (const [keyId, until] of Object.entries(providerData)) {
                if (until > now) {
                    const fullKey = this.keys ? this.keys.find(k => this._keyId(k) === keyId) : null;
                    if (fullKey) {
                        this._cooldownUntil.set(fullKey, until);
                        console.log(`🧊 [${this.name}] 從磁碟恢復冷卻 ${keyId}，剩餘 ${Math.ceil((until - now) / 60000)}m`);
                    }
                }
            }
        } catch (e) { /* 靜默失敗 */ }
    }

    _saveCooldownToDisk() {
        try {
            let all = {};
            try { all = JSON.parse(fs.readFileSync(this._cooldownFile, 'utf-8')); } catch (_) {}
            all[this.name] = {};
            if (this._cooldownUntil) {
                for (const [key, until] of this._cooldownUntil) {
                    all[this.name][this._keyId(key)] = until;
                }
            }
            fs.mkdirSync(path.dirname(this._cooldownFile), { recursive: true });
            fs.writeFileSync(this._cooldownFile, JSON.stringify(all, null, 2));
        } catch (e) {
            console.warn(`[${this.name}] 無法寫入 cooldown-state.json:`, e.message);
        }
    }
}

module.exports = ProviderAdapter;
