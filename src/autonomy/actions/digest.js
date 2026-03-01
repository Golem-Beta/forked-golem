/**
 * @module digest
 * @role 消化歸納行動 — 定期整合經驗產出洞察 + 靜默時段晨間摘要
 * @when-to-modify 調整消化提示詞、synthesis 存檔格式、或晨間摘要邏輯時
 */
const fs = require('fs');
const path = require('path');

class DigestAction {
    constructor({ journal, notifier, decision, memoryLayer, loadPrompt }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
        this.memory = memoryLayer || null; // 三層記憶召回
        this.loadPrompt = loadPrompt || null;
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
            // 溫層：讀取過去 synthesis 摘要內容（而非只有標題）
            let pastSynthContent = '';
            try {
                if (this.memory) {
                    const { warm } = this.memory.recall('', { hotLimit: 0, warmLimit: 5, coldLimit: 0 });
                    pastSynthContent = warm || '';
                } else if (fs.existsSync(synthDir)) {
                    // fallback：無 memoryLayer 時退回舊行為（只取標題）
                    const titles = fs.readdirSync(synthDir).filter(f => f.endsWith('.md')).sort().slice(-10);
                    pastSynthContent = titles.join('\n');
                }
            } catch (e) {
                // fallback：失敗時退回舊行為
                if (fs.existsSync(synthDir)) {
                    const titles = fs.readdirSync(synthDir).filter(f => f.endsWith('.md')).sort().slice(-10);
                    pastSynthContent = titles.join('\n');
                }
            }

            const journalLines = journal.map(j => {
                const parts = [j.ts, j.action];
                if (j.repo) parts.push(j.repo);
                if (j.topic) parts.push('topic:' + j.topic);
                if (j.outcome) parts.push('outcome:' + j.outcome);
                if (j.learning) parts.push('learning:' + j.learning);
                if (j.reason) parts.push('reason:' + j.reason);
                return parts.join(' | ');
            }).join('\n');
            const pastSynthSection = pastSynthContent
                ? '【過去歸納摘要（找新角度，不要重複核心主題）】\n' + pastSynthContent
                : '這是你第一次做消化歸納。';
            const prompt = (this.loadPrompt && this.loadPrompt('digest.md', {
                SOUL: soul || '(無法讀取)',
                JOURNAL_SECTION: `【最近經驗日誌（${journal.length} 條）】\n${journalLines}`,
                REPO_SECTION: `【最近探索的 GitHub Repo（${exploredRepos.length} 個）】\n` + exploredRepos.map(r => (r.full_name || '?') + ' ★' + (r.stars || '?')).join('\n'),
                REFLECTIONS_SECTION: '【最近的反思報告摘要】\n' + recentReflections.map(r => '--- ' + r.file + ' ---\n' + r.preview).join('\n\n'),
                PAST_SYNTH_SECTION: pastSynthSection,
            })) || [
                soul || '(無法讀取 soul.md)',
                `\n現在是你的「消化歸納」時間。\n\n【最近經驗日誌（${journal.length} 條）】\n${journalLines}`,
                `\n【最近探索的 GitHub Repo（${exploredRepos.length} 個）】\n` + exploredRepos.map(r => (r.full_name || '?') + ' ★' + (r.stars || '?')).join('\n'),
                '\n' + pastSynthSection,
                '\n【任務】\n根據以上素材，產出一份「消化歸納」文件。\n\n【輸出格式】\n用 Markdown 格式寫，第一行是 # 標題，最後加 ## 摘要。',
            ].join('');

            const result = (await this.decision.callLLM(prompt, { maxOutputTokens: 2048, temperature: 0.7, intent: 'analysis' })).text;

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

            const PendingPatches = require('../pending-patches');
            const _pp = new PendingPatches();
            const _pendingCount = _pp.pendingCount();
            const digestPendingReminder = _pendingCount > 0
                ? `\n\n⚠️ 有 ${_pendingCount} 個待審提案，輸入 /lp 查看`
                : '';
            const sentDG = await this.notifier.sendToAdmin(
                '📝 消化歸納完成\n\n' + summary + '\n\n📄 完整文件: memory/synthesis/' + filename + digestPendingReminder
            );
            console.log('[Digest] sendToAdmin:', sentDG ? '✅ OK' : '❌ FAILED');

            this.journal.append({
                action: 'digest', topic: firstLine,
                outcome: sentDG === true ? 'completed' : sentDG === 'queued' ? 'queued' : 'completed_send_failed',
                file: 'synthesis/' + filename, summary_preview: summary.substring(0, 100),
                ...(sentDG !== true && sentDG !== 'queued' && sentDG && sentDG.error ? { error: sentDG.error } : {})
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
                console.log('[MorningDigest] queue 已空（已由 LifeCycle drain），改做一般摘要');
                return this.performDigest();
            }
            console.log('[MorningDigest] 整理 ' + items.length + ' 則...');
            const NL = '\n';
            const SEP = '\n\n---\n\n';
            const itemText = items.map((item, i) => {
                const t = new Date(item.ts).toLocaleString('zh-TW', { hour12: false });
                return '[' + (i + 1) + '] ' + t + NL + item.text;
            }).join(SEP);
            const soul = this.decision.readSoul();
            const prompt = (this.loadPrompt && this.loadPrompt('morning-digest.md', {
                SOUL: soul || '(無法讀取)',
                ITEM_COUNT: String(items.length),
                ITEM_TEXT: itemText,
            })) || [
                soul || '(無法讀取 soul.md)',
                `\n以下是你在靜默時段完成的行動紀錄（${items.length} 則），請整理成晨間摘要，300 字以內。`,
                `\n\n【靜默時段行動紀錄】\n${itemText}`,
            ].join('');
            const summary = (await this.decision.callLLM(prompt, {
                intent: 'chat',
                temperature: 0.7
            })).text;
            if (!summary) {
                this.journal.append({ action: 'morning_digest', outcome: 'llm_empty' });
                return;
            }
            const PendingPatches = require('../pending-patches');
            const _pp2 = new PendingPatches();
            const _pendingCount2 = _pp2.pendingCount();
            const pendingReminder = _pendingCount2 > 0
                ? NL + NL + `⚠️ 有 ${_pendingCount2} 個待審提案，輸入 /lp 查看`
                : '';
            const sentMD = await this.notifier.sendToAdmin('🌅 晨間摘要' + NL + NL + summary + pendingReminder);
            console.log('[MorningDigest] sendToAdmin:', sentMD ? '✅ OK' : '❌ FAILED');
            this.journal.append({
                action: 'morning_digest',
                outcome: sentMD === true ? 'sent' : sentMD === 'queued' ? 'queued' : 'send_failed',
                item_count: items.length,
                summary_preview: summary.substring(0, 100),
                model: this.decision.lastModel,
                tokens: this.decision.lastTokens,
                ...(sentMD !== true && sentMD !== 'queued' && sentMD && sentMD.error ? { error: sentMD.error } : {})
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
