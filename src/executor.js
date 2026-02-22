/**
 * ⚡ Executor — 沙盒指令執行器
 * 依賴：fs, path, os, child_process (Node built-in)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

class Executor {
    constructor() {
        this.taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this.WORKSPACE = path.join(os.tmpdir(), `golem-task-${this.taskId}`);
        fs.mkdirSync(this.WORKSPACE, { recursive: true });
        // 預設 cwd 為專案目錄（大多數指令需要在此執行）
        this.cwd = process.cwd();

        // cd 限制：只擋系統敏感目錄，專案目錄允許進入
        // 註：指令層面的安全由 SecurityManager 負責，Executor 只管 cd 導航邊界
        this.FORBIDDEN_PATHS = [
            '/etc', '/boot', '/root', '/sys', '/proc'
        ];

        this.INTERACTIVE_CMDS = ['htop', 'top', 'vim', 'vi', 'nano', 'less', 'more', 'man', 'ssh', 'ftp', 'python', 'node'];
    }

    run(cmd) {
        const baseCmd = cmd.trim().split(/\s+/)[0];

        if (this.INTERACTIVE_CMDS.includes(baseCmd) && !cmd.includes('-e') && !cmd.includes('-c') && !cmd.includes('-b')) {
            if (baseCmd === 'top' && (cmd.includes('-b') || cmd.includes('--batch'))) { /* pass */ }
            else if ((baseCmd === 'python' || baseCmd === 'python3' || baseCmd === 'node') && (cmd.includes('-e') || cmd.includes('-c'))) { /* pass */ }
            else {
                const hint = baseCmd === 'top' ? '試試 top -bn1' : `${baseCmd} 是互動式程式，無法在 exec 中執行`;
                console.warn(`⚠️ Sandbox: 攔截互動式指令 ${baseCmd} — ${hint}`);
                return Promise.reject(`⚠️ ${baseCmd} 是互動式程式，無法在 exec 中執行。${baseCmd === 'top' ? ' 改用: top -bn1' : ''}`);
            }
        }

        const cdMatch = cmd.match(/^cd\s+(.+)$/);
        if (cdMatch) {
            const target = cdMatch[1].trim().replace(/^["']|["']$/g, '');
            const resolved = path.resolve(this.cwd, target);

            for (const forbidden of this.FORBIDDEN_PATHS) {
                if (resolved === forbidden || resolved.startsWith(forbidden + '/')) {
                    console.warn(`⚠️ Sandbox: 禁止 cd 進入 ${resolved}`);
                    return Promise.reject(`⚠️ 安全限制：不允許進入 ${resolved}`);
                }
            }

            if (fs.existsSync(resolved)) {
                this.cwd = resolved;
                console.log(`⚡ Exec: cd ${target} → cwd=${this.cwd}`);
                return Promise.resolve(`Changed directory to ${this.cwd}`);
            } else {
                return Promise.reject(`cd: no such directory: ${resolved}`);
            }
        }

        return new Promise((resolve, reject) => {
            console.log(`⚡ Exec: ${cmd}  (cwd: ${this.cwd})`);
            exec(cmd, {
                cwd: this.cwd,
                timeout: 30000,
                maxBuffer: 1024 * 512
            }, (err, stdout, stderr) => {
                if (err) {
                    if (err.killed) reject('⏱️ 指令超時（30 秒限制）');
                    else reject(stderr || err.message);
                }
                else resolve(stdout);
            });
        });
    }

    getWorkspace() { return this.WORKSPACE; }

    cleanup() {
        try {
            fs.rmSync(this.WORKSPACE, { recursive: true, force: true });
            console.log(`🧹 Sandbox cleanup: ${this.WORKSPACE}`);
        } catch (e) { }
    }
}

module.exports = Executor;
