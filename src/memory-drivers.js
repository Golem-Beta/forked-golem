/**
 * 🧠 Memory Drivers — ExperienceMemory + SystemQmdDriver + SystemNativeDriver
 * 依賴：fs, path, os, child_process (Node built-in)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');

class ExperienceMemory {
    constructor() {
        this.memoryFile = path.join(process.cwd(), 'golem_learning.json');
        this.data = this._load();
    }
    _load() {
        try { if (fs.existsSync(this.memoryFile)) return JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8')); } catch (e) { }
        return { lastProposalType: null, rejectedCount: 0, avoidList: [], nextWakeup: 0 };
    }
    save() { fs.writeFileSync(this.memoryFile, JSON.stringify(this.data, null, 2)); }
    recordProposal(type) { this.data.lastProposalType = type; this.save(); }
    recordRejection() {
        this.data.rejectedCount++;
        if (this.data.lastProposalType) {
            this.data.avoidList.push(this.data.lastProposalType);
            if (this.data.avoidList.length > 3) this.data.avoidList.shift();
        }
        this.save();
        return this.data.rejectedCount;
    }
    recordSuccess() { this.data.rejectedCount = 0; this.data.avoidList = []; this.save(); }
    getAdvice() {
        if (this.data.avoidList.length > 0) return `⚠️ 注意：最近被拒絕的提案：[${this.data.avoidList.join(', ')}]。請避開。`;
        return "";
    }
}

class SystemQmdDriver {
    constructor(config) {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        this.qmdCmd = 'qmd';
        this._config = config || {};
    }

    async init() {
        console.log("🔍 [Memory:Qmd] 啟動引擎探測...");
        try {
            const checkCmd = (c) => {
                try {
                    const findCmd = os.platform() === 'win32' ? `where ${c}` : `command -v ${c}`;
                    execSync(findCmd, { stdio: 'ignore', env: process.env });
                    return true;
                } catch (e) { return false; }
            };

            const qmdPath = this._config.QMD_PATH || 'qmd';
            if (qmdPath !== 'qmd' && fs.existsSync(qmdPath)) {
                this.qmdCmd = `"${qmdPath}"`;
            } else if (checkCmd('qmd')) {
                this.qmdCmd = 'qmd';
            } else {
                const homeQmd = path.join(os.homedir(), '.bun', 'bin', 'qmd');
                if (fs.existsSync(homeQmd)) {
                    this.qmdCmd = `"${homeQmd}"`;
                } else if (os.platform() !== 'win32') {
                    try {
                        const bashFound = execSync('bash -lc "which qmd"', { encoding: 'utf8', env: process.env }).trim();
                        if (bashFound) this.qmdCmd = `"${bashFound}"`;
                        else throw new Error();
                    } catch (e) { throw new Error("QMD_NOT_FOUND"); }
                } else {
                    throw new Error("QMD_NOT_FOUND");
                }
            }

            console.log(`🧠 [Memory:Qmd] 引擎連線成功: ${this.qmdCmd}`);
            try {
                const target = path.join(this.baseDir, '*.md');
                execSync(`${this.qmdCmd} collection add "${target}" --name golem-core`, {
                    stdio: 'ignore', env: process.env, shell: true
                });
            } catch (e) { }
        } catch (e) {
            console.error(`❌ [Memory:Qmd] 找不到 qmd 指令。如果您已安裝，請在 .env 加入 GOLEM_QMD_PATH=/path/to/qmd`);
            throw new Error("QMD_MISSING");
        }
    }

    async recall(query) {
        return new Promise((resolve) => {
            const safeQuery = query.replace(/"/g, '\\"');
            const cmd = `${this.qmdCmd} search golem-core "${safeQuery}" --hybrid --limit 3`;
            exec(cmd, (err, stdout) => {
                if (err) { resolve([]); return; }
                const result = stdout.trim();
                if (result) {
                    resolve([{ text: result, score: 0.95, metadata: { source: 'qmd' } }]);
                } else { resolve([]); }
            });
        });
    }

    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        const fileContent = `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`;
        fs.writeFileSync(filepath, fileContent, 'utf8');
        exec(`${this.qmdCmd} embed golem-core "${filepath}"`, (err) => {
            if (err) console.error("⚠️ [Memory:Qmd] 索引更新失敗:", err.message);
            else console.log(`🧠 [Memory:Qmd] 已寫入知識庫: ${filename}`);
        });
    }
}

class SystemNativeDriver {
    constructor() {
        this.baseDir = path.join(process.cwd(), 'golem_memory', 'knowledge');
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    }

    async init() {
        console.log("🧠 [Memory:Native] 系統原生核心已啟動 (Pure Node.js Mode)");
    }

    async recall(query) {
        try {
            const files = fs.readdirSync(this.baseDir).filter(f => f.endsWith('.md'));
            const results = [];
            for (const file of files) {
                const content = fs.readFileSync(path.join(this.baseDir, file), 'utf8');
                const keywords = query.toLowerCase().split(/\s+/);
                let score = 0;
                keywords.forEach(k => { if (content.toLowerCase().includes(k)) score += 1; });
                if (score > 0) {
                    results.push({
                        text: content.replace(/---[\s\S]*?---/, '').trim(),
                        score: score / keywords.length,
                        metadata: { source: file }
                    });
                }
            }
            return results.sort((a, b) => b.score - a.score).slice(0, 3);
        } catch (e) { return []; }
    }

    async memorize(text, metadata) {
        const filename = `mem_${Date.now()}.md`;
        const filepath = path.join(this.baseDir, filename);
        const fileContent = `---\ndate: ${new Date().toISOString()}\ntype: ${metadata.type || 'general'}\n---\n${text}`;
        fs.writeFileSync(filepath, fileContent, 'utf8');
        console.log(`🧠 [Memory:Native] 已寫入知識庫: ${filename}`);
    }
}

module.exports = { ExperienceMemory, SystemQmdDriver, SystemNativeDriver };
