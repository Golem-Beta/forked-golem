/**
 * ⚓ TriStreamParser + ⚡ ResponseParser
 * 零外部依賴，純解析邏輯
 */
const _DBG = process.env.GOLEM_DEBUG === 'true';
function dbg(tag, ...args) {
    if (!_DBG) return;
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`🐛 [${ts}] [${tag}]`, ...args);
}

class TriStreamParser {
    /**
     * 解析 Gemini 回應為 { memory, actions, reply }
     * 支援 Emoji 標籤 [🧠 MEMORY_IMPRINT] 和 ASCII 標籤 [GOLEM_MEMORY]
     * 用 lookahead 切段，不依賴閉合標籤
     */
    static parse(raw) {
        if (!raw) return { memory: null, actions: [], reply: '', hasStructuredTags: false };

        const result = { memory: null, actions: [], reply: '', hasStructuredTags: false };

        const TAG_RE = /\[(?:🧠\s*MEMORY_IMPRINT|🤖\s*ACTION_PLAN|(?:💬|🤖)\s*REPLY|GOLEM_MEMORY|GOLEM_ACTION|GOLEM_REPLY)\]([\s\S]*?)(?=\[(?:🧠\s*MEMORY_IMPRINT|🤖\s*ACTION_PLAN|(?:💬|🤖)\s*REPLY|GOLEM_MEMORY|GOLEM_ACTION|GOLEM_REPLY)\]|$)/gi;

        let m;
        let hasAnyTag = false;

        while ((m = TAG_RE.exec(raw)) !== null) {
            hasAnyTag = true;
            result.hasStructuredTags = true;
            const header = m[0];
            const body = m[1].trim();

            let type;
            if (/MEMORY/i.test(header)) type = 'M';
            else if (/REPLY/i.test(header)) type = 'R';
            else if (/ACTION/i.test(header)) type = 'A';
            else type = 'R';

            if (type === 'M') {
                if (body && body !== '(無)' && body !== 'null' && body.length > 0) {
                    result.memory = body;
                }
            } else if (type === 'A') {
                const jsonStr = body.replace(/```json/g, '').replace(/```/g, '').trim();
                const jsonStrNormalized = jsonStr.replace(/\s+/g, '');
                dbg('ActionRaw', `len=${jsonStr.length} normalized=${JSON.stringify(jsonStrNormalized)}`);
                if (jsonStr && jsonStr !== 'null' && jsonStrNormalized !== '[]' && jsonStrNormalized !== '{}' && jsonStr.length > 2) {
                    try {
                        const parsed = JSON.parse(jsonStr);
                        let steps = Array.isArray(parsed) ? parsed : (parsed.steps || [parsed]);
                        steps = steps.map(s => {
                            if (!s.cmd && (s.command || s.shell || s.action)) {
                                s.cmd = s.command || s.shell || s.action;
                            }
                            return s;
                        }).filter(s => s && s.cmd);
                        if (steps.length > 0) {
                            result.actions.push(...steps);
                            dbg('ActionPush', `Pushed ${steps.length} steps: ${JSON.stringify(steps)}`);
                        } else {
                            dbg('ActionPush', `JSON parsed but no valid steps (empty after filter)`);
                        }
                    } catch (e) {
                        const fb = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/) || jsonStr.match(/\{[\s\S]*\}/);
                        if (fb) {
                            try {
                                const fixed = JSON.parse(fb[0]);
                                result.actions.push(...(Array.isArray(fixed) ? fixed : [fixed]));
                                dbg('ActionPush-Fuzzy', `Fuzzy pushed: ${JSON.stringify(fixed)}`);
                            } catch (_) {}
                        }
                        dbg('Parser', 'ACTION JSON parse fail:', e.message);
                    }
                }
            } else {
                result.reply = body
                    .replace('—-回覆開始—-', '')
                    .replace('—-回覆結束—-', '')
                    .replace(/\[G_ID:\d+\]/g, '')
                    .trim();
            }
        }

        if (!hasAnyTag) {
            dbg('Parser', 'No tags found — raw reply fallback');
            result.reply = raw
                .replace('—-回覆開始—-', '')
                .replace('—-回覆結束—-', '')
                .trim();
        }

        if (hasAnyTag && !result.reply) {
            const leftover = raw
                .replace(/\[(?:🧠[^\]]*|🤖[^\]]*|💬[^\]]*|GOLEM_\w+)\][\s\S]*?(?=\[(?:🧠|🤖|💬|GOLEM_)|$)/gi, '')
                .replace('—-回覆開始—-', '')
                .replace('—-回覆結束—-', '')
                .trim();
            if (leftover) result.reply = leftover;
        }

        dbg('TriStream', `M:${result.memory ? 'Y' : 'N'} A:${result.actions.length} R:${result.reply.length}ch`);
        return result;
    }
}

class ResponseParser {
    static extractJson(text) {
        if (!text) return [];
        let cleaned = text.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '');
        if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '');
        if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```\s*$/, '');
        cleaned = cleaned.trim();
        cleaned = cleaned.replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, hex) => {
            try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
        });
        try {
            const parsed = JSON.parse(cleaned);
            return parsed.steps || (Array.isArray(parsed) ? parsed : [parsed]);
        } catch (e) {
            try {
                const lastComplete = cleaned.lastIndexOf('},');
                if (lastComplete > 0) {
                    const repaired = cleaned.substring(0, lastComplete + 1) + ']';
                    const parsed = JSON.parse(repaired);
                    console.log('[Parser] JSON 被截斷，修復後解析出 ' + parsed.length + ' 個項目');
                    return Array.isArray(parsed) ? parsed : [parsed];
                }
            } catch (e2) {}
        }
        try {
            const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (arrayMatch) return JSON.parse(arrayMatch[0]);
        } catch (e) { console.error("解析 JSON 失敗:", e.message); }

        const cmdMatches = [...text.matchAll(/`([^`]+)`/g)]
            .map(m => m[1].trim())
            .filter(cmd => {
                if (cmd.length < 2 || cmd.length > 200) return false;
                if (/^[\u4e00-\u9fff]/.test(cmd)) return false;
                if (/^\[|^#|^\*/.test(cmd)) return false;
                const shellPrefixes = ['ls', 'cd', 'cat', 'echo', 'pwd', 'mkdir', 'rm', 'cp', 'mv',
                    'git', 'node', 'npm', 'python', 'pip', 'curl', 'wget', 'find', 'grep',
                    'chmod', 'chown', 'tail', 'head', 'df', 'free', 'ps', 'kill', 'pkill',
                    'whoami', 'uname', 'date', 'golem-check', 'golem-schedule', 'lsof', 'top', 'which',
                    'touch', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'docker', 'ffmpeg'];
                const base = cmd.split(/\s+/)[0].toLowerCase();
                return shellPrefixes.includes(base);
            })
            .map(cmd => ({ cmd }));

        if (cmdMatches.length > 0) {
            console.log(`🔧 [Parser] JSON 解析失敗，Fallback 提取到 ${cmdMatches.length} 條指令: ${cmdMatches.map(c => c.cmd).join(', ')}`);
        }
        return cmdMatches;
    }
}

module.exports = { TriStreamParser, ResponseParser, dbg };
