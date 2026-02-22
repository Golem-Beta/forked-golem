/**
 * 🛡️ SecurityManager v2 — 白名單/黑名單 + Taint 偵測
 * 零外部依賴
 */
class SecurityManager {
    constructor() {
        this.WHITELIST = [
            'ls', 'dir', 'pwd', 'cd', 'date', 'echo', 'cat', 'grep', 'find',
            'whoami', 'tail', 'head', 'df', 'free', 'wc', 'sort', 'uniq',
            'uname', 'uptime', 'hostname', 'which', 'file', 'stat',
            'Get-ChildItem', 'Select-String',
            'golem-check', 'golem-skill',
            'git', 'node', 'python', 'python3', 'npm',
            'mkdir', 'touch', 'cp',
            'fastfetch', 'neofetch', 'lsof', 'ps',
            'systemctl', 'journalctl',
        ];

        this.BLOCK_PATTERNS = [
            /rm\s+-rf\s+\//, /rd\s+\/s\s+\/q\s+[c-zC-Z]:\\$/,
            />\s*\/dev\/sd/, /:(){.*:|.*:&.*;:/, /mkfs/, /Format-Volume/,
            /dd\s+if=/, /chmod\s+[-]x\s+/,
            /curl[^|]*\|\s*(bash|sh|zsh)/,
            /wget[^|]*\|\s*(bash|sh|zsh)/,
            /eval\s*\(/,
            /\bsudo\b/,
            /\bsu\s/,
        ];

        this.DANGER_COMMANDS = [
            'rm', 'mv', 'chmod', 'chown', 'reboot', 'shutdown',
            'kill', 'killall', 'pkill',
            'npm uninstall', 'Remove-Item', 'Stop-Computer',
            'dd', 'mkfs', 'fdisk', 'parted',
        ];

        this.ALLOWED_DOMAINS = [
            'api.github.com', 'raw.githubusercontent.com',
            'registry.npmjs.org',
        ];
    }

    assess(cmd, tainted = false) {
        if (!cmd || typeof cmd !== 'string') return { level: 'BLOCKED', reason: '空指令' };

        const trimmed = cmd.trim();
        const baseCmd = trimmed.split(/\s+/)[0];

        if (this.BLOCK_PATTERNS.some(regex => regex.test(trimmed))) {
            return { level: 'BLOCKED', reason: '危險指令 pattern' };
        }

        if (/^(curl|wget)\b/.test(baseCmd)) {
            return this._assessNetwork(trimmed, tainted);
        }

        if (this.DANGER_COMMANDS.includes(baseCmd)) {
            return { level: 'DANGER', reason: `高風險操作: ${baseCmd}` };
        }

        if (this.WHITELIST.includes(baseCmd)) {
            if (tainted) {
                return { level: 'WARNING', reason: '指令安全但上下文含外部內容，需確認' };
            }
            return { level: 'SAFE' };
        }

        return { level: 'WARNING', reason: `未知指令: ${baseCmd}` };
    }

    _assessNetwork(cmd, tainted) {
        const urlMatch = cmd.match(/https?:\/\/[^\s"']+/);
        if (!urlMatch) {
            return { level: 'WARNING', reason: 'curl/wget 未包含明確 URL' };
        }

        try {
            const url = new URL(urlMatch[0]);
            const domain = url.hostname;

            if (this.ALLOWED_DOMAINS.includes(domain)) {
                if (tainted) {
                    return { level: 'WARNING', reason: `域名 ${domain} 已授權，但上下文含外部內容` };
                }
                return { level: 'SAFE' };
            }

            return { level: 'WARNING', reason: `網路請求目標未授權: ${domain}` };
        } catch (e) {
            return { level: 'WARNING', reason: 'URL 解析失敗' };
        }
    }

    addAllowedDomain(domain) {
        if (!this.ALLOWED_DOMAINS.includes(domain)) {
            this.ALLOWED_DOMAINS.push(domain);
            console.log(`🛡️ [Security] 已新增授權域名: ${domain}`);
        }
    }
}

module.exports = SecurityManager;
