/**
 * @module digest
 * @role 消化歸納行動 — 定期整合經驗產出洞察 + 靜默時段晨間摘要
 * @when-to-modify 調整消化提示詞、synthesis 存檔格式、或晨間摘要邏輯時
 */
const fs = require('fs');
const path = require('path');

class DigestAction {
    constructor({ journal, notifier, decision }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
    }

    async performDigest() {
        try {
            console.log('📝 [Digest] 開始消化歸納...');
            const soul = this.decision.readSoul();
            const journal = this.journal.readRecent(30);

            const reflDir = path.join(process.cwd(), 'memory', 'reflections');
            let recentReflections = [];
            if (fs.existsSync(reflDir)) {
                const files = fs.readdirSync(reflDir).filter(f => f.endsWith('.txt')).sort().slice(-10);
                for (const f of files) {
                    try {
                        const content = fs.readFileSync(path.join(reflDir, f), 'utf-8');
                        recentReflections.push({ file: f, preview: content.substring(0, 500) });
                    } catch {}
                }
            }

            let exploredRepos = [];
            try {
                const repoPath = path.join(process.cwd(), 'memory', 'explored-repos.json');
                if (fs.existsSync(repoPath)) {
                    exploredRepos = JSON.parse(fs.readFileSync(repoPath, 'utf-8')).slice(-20);
                }
            } catch {}

            const synthDir = path.join(process.cwd(), 'memory', 'synthesis');
            let pastSynthTitles = [];
            if (fs.existsSync(synthDir)) {
                pastSynthTitles = fs.readdirSync(synthDir).filter(f => f.endsWith('.md')).sort().slice(-10);
            }

            const prompt = [
                '你是 Golem Beta，一個運行在 ThinkPad X200 上的自律型 AI Agent。',
                '現在是你的「消化歸納」時間 —— 回顧最近的經驗，產出有價值的洞察。',
                '', '【靈魂文件】', soul || '(無法讀取)',
                '', '【最近經驗日誌（' + journal.length + ' 條）】',
                journal.map(j => {
                    const parts = [j.ts, j.action];
                    if (j.repo) parts.push(j.repo);
                    if (j.topic) parts.push('topic:' + j.topic);
                    if (j.outcome) parts.push('outcome:' + j.outcome);
                    if (j.learning) parts.push('learning:' + j.learning);
                    if (j.reason) parts.push('reason:' + j.reason);
                    return parts.join(' | ');
                }).join('\n'),
                '', '【最近探索的 GitHub Repo（' + exploredRepos.length + ' 個）】',
                exploredRepos.map(r => (r.full_name || '?') + ' ★' + (r.stars || '?')).join('\n'),
                '', '【最近的反思報告摘要】',
                recentReflections.map(r => '--- ' + r.file + ' ---\n' + r.preview).join('\n\n'),
                '',
                pastSynthTitles.length > 0
                    ? '【已產出過的消化歸納】\n' + pastSynthTitles.join('\n') + '\n請避免重複這些主題，找新的角度。'
                    : '這是你第一次做消化歸納。',
                '', '【任務】',
                '根據以上素材，產出一份「消化歸納」文件。你可以自由選擇主題和形式。',
                '', '【輸出格式】',
                '用 Markdown 格式寫。第一行是 # 標題（簡潔描述主題）。',
                '內容要有實質，不要寫廢話。用繁體中文。',
                '最後加一個 ## 摘要 段落（2-3 句話濃縮核心發現）。',
            ].join('\n');

            const result = await this.decision.callLLM(prompt, { maxOutputTokens: 2048, temperature: 0.7, intent: 'analysis' });

            if (!result) {
                console.warn('📝 [Digest] LLM 回傳空白');
                this.journal.append({ action: 'digest', outcome: 'empty_response' });
                return;
            }

            // 存檔
            fs.mkdirSync(synthDir, { recursive: true });
            const firstLine = result.split('\n')[0].replace(/^#\s*/, '').trim();
            const safeTitle = firstLine
                .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9_-]/g, '_')
                .substring(0, 50).replace(/_+/g, '_').replace(/_$/, '');
            const dateStr = new Date().toISOString().slice(0, 10);
            const filename = dateStr + '-' + (safeTitle || 'digest') + '.md';
            const filepath = path.join(synthDir, filename);
            fs.writeFileSync(filepath, result);
            console.log('📝 [Digest] 已存檔: memory/synthesis/' + filename);

            this.decision.saveReflection('digest', result);

            let summary = '';
            const summaryMatch = result.match(/##\s*摘要[\s\S]*?\n([\s\S]*?)(?=\n##|$)/);
            if (summaryMatch) { summary = summaryMatch[1].trim(); }
            else { summary = result.substring(0, 200).trim() + '...'; }

            const sentDG = await this.notifier.sendToAdmin(
                '📝 消化歸納完成\n\n' + summary + '\n\n📄 完整文件: memory/synthesis/' + filename
            );
            console.log('[Digest] sendToAdmin:', sentDG ? '✅ OK' : '❌ FAILED');

            this.journal.append({
                action: 'digest', topic: firstLine,
                outcome: sentDG ? 'completed' : 'completed_send_failed',
                file: 'synthesis/' + filename, summary_preview: summary.substring(0, 100)
            });
            if (sentDG) console.log('[Digest] 消化歸納完成。');
        } catch (e) {
            console.error('❌ [Digest] 失敗:', e.message);
            this.journal.append({ action: 'digest', outcome: 'error', error: e.message });
            return { success: false, action: 'digest', outcome: 'error', detail: e.message };
        }
    }

    /**
     * 晨間摘要：取出靜默 queue，讓 LLM 消化成人話後發給主人
     */
    async performMorningDigest() {
        try {
            const items = this.notifier.drainQuietQueue();
            if (items.length === 0) {
                console.log('[MorningDigest] 無暫存訊息，跳過');
                this.journal.append({ action: 'morning_digest', outcome: 'skipped_empty' });
                return;
            }
            console.log('[MorningDigest] 整理 ' + items.length + ' 則...');
            const NL = '\n';
            const SEP = '\n\n---\n\n';
            const itemText = items.map((item, i) => {
                const t = new Date(item.ts).toLocaleString('zh-TW', { hour12: false });
                return '[' + (i + 1) + '] ' + t + NL + item.text;
            }).join(SEP);
            const promptLines = [
                '你是 Golem。以下是你在靜默時段（深夜/凌晨）完成的行動紀錄，現在請整理成一則給主人的晨間摘要。',
                '',
                '要求：',
                '- 用輕鬆、自然的語氣，像朋友一樣告訴主人你昨晚做了什麼',
                '- 重點是「發現了什麼」「學到了什麼」，而不是流水帳',
                '- 如果有你認為主人可能感興趣的發現，特別點出來',
                '- 結尾說：如果你對某個部分有興趣，可以回覆我詳細說說',
                '- 控制在 300 字以內，不要太長',
                '',
                '【靜默時段行動紀錄】',
                itemText
            ];
            const prompt = promptLines.join(NL);
            const summary = await this.decision.callLLM(prompt, {
                intent: 'chat',
                temperature: 0.7
            });
            if (!summary) {
                this.journal.append({ action: 'morning_digest', outcome: 'llm_empty' });
                return;
            }
            const sentMD = await this.notifier.sendToAdmin('🌅 晨間摘要' + NL + NL + summary);
            console.log('[MorningDigest] sendToAdmin:', sentMD ? '✅ OK' : '❌ FAILED');
            this.journal.append({
                action: 'morning_digest',
                outcome: sentMD ? 'sent' : 'send_failed',
                item_count: items.length,
                summary_preview: summary.substring(0, 100),
                model: this.decision.lastModel,
                tokens: this.decision.lastTokens
            });
            if (sentMD) console.log('[MorningDigest] 晨間摘要已發送。');
        } catch (e) {
            console.error('[MorningDigest] 失敗:', e.message);
            this.journal.append({ action: 'morning_digest', outcome: 'error', error: e.message });
            return { success: false, action: 'morning_digest', outcome: 'error', detail: e.message };
        }
    }
}

module.exports = DigestAction;
