/**
 * 🎬 ActionRunner — 5 個自主行動的實作
 *
 * 依賴注入：journal, notifier, decision, brain, config, memory, skills,
 *           loadPrompt, Introspection, PatchManager, ResponseParser, InputFile
 *
 * 每個 perform* 方法遵循同一模式：
 *   準備 context → LLM 呼叫 → 結果處理 → notifier 發送 → journal 記錄
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

class ActionRunner {
    /**
     * @param {object} deps
     * @param {import('./journal')} deps.journal
     * @param {import('./notify')} deps.notifier
     * @param {import('./decision')} deps.decision
     * @param {object} deps.brain
     * @param {object} deps.config
     * @param {object} deps.memory
     * @param {object} deps.skills
     * @param {Function} deps.loadPrompt
     * @param {object} deps.PatchManager
     * @param {object} deps.ResponseParser
     * @param {Function} deps.InputFile
     */
    constructor({ journal, notifier, decision, brain, config, memory, skills,
                  loadPrompt, PatchManager, ResponseParser, InputFile }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
        this.brain = brain;
        this.config = config;
        this.memory = memory;
        this.skills = skills;
        this.loadPrompt = loadPrompt;
        this.PatchManager = PatchManager;
        this.ResponseParser = ResponseParser;
        this.InputFile = InputFile;

        // 📬 社交回應追蹤
        this._pendingSocialChat = null;
    }

    // =========================================================
    // 💬 主動社交
    // =========================================================

    async performSpontaneousChat() {
        const now = new Date();
        const timeCtx = this.decision.getTimeContext(now);
        const timeStr = timeCtx.display;
        const contextNote = timeCtx.period;

        const recentSocial = this.journal.readRecent(5)
            .filter(j => j.action === 'spontaneous_chat')
            .map(j => j.context || '')
            .join('; ');

        const soul = this.decision.readSoul();
        const prompt = this.loadPrompt('spontaneous-chat.md', {
            SOUL: soul,
            TIME_STR: timeStr,
            CONTEXT_NOTE: contextNote,
            RECENT_SOCIAL: recentSocial || '（無）'
        }) || `${soul}\n主動社交，時間：${timeStr}，簡短跟老哥打招呼。`;
        const msg = await this.decision.callLLM(prompt, { maxOutputTokens: 256, temperature: 0.9, intent: 'chat' });
        await this.notifier.sendToAdmin(msg);

        this.journal.append({
            action: 'spontaneous_chat',
            context: contextNote,
            outcome: 'sent'
        });

        // 30 分鐘回應追蹤
        if (this._pendingSocialChat && this._pendingSocialChat.timer) {
            clearTimeout(this._pendingSocialChat.timer);
        }
        this._pendingSocialChat = {
            ts: new Date().toISOString(),
            context: contextNote,
            timer: setTimeout(() => {
                this.journal.append({
                    action: 'social_feedback',
                    outcome: 'no_response',
                    context: contextNote,
                    note: '老哥 30 分鐘內沒回應'
                });
                console.log('📬 [Social] 30 分鐘無回應，已記錄');
                this._pendingSocialChat = null;
            }, 30 * 60 * 1000)
        };
    }

    /**
     * 老哥回應回流 — 由 coordinator 轉發
     */
    onAdminReply(text) {
        if (!this._pendingSocialChat) return;
        clearTimeout(this._pendingSocialChat.timer);
        const context = this._pendingSocialChat.context;
        const waitMs = Date.now() - new Date(this._pendingSocialChat.ts).getTime();
        const waitMin = Math.round(waitMs / 60000);
        const preview = text.length > 80 ? text.substring(0, 80) + '...' : text;
        this.journal.append({
            action: 'social_feedback',
            outcome: 'replied',
            context: context,
            reply_preview: preview,
            response_time_min: waitMin
        });
        console.log('📬 [Social] 老哥回應了（' + waitMin + ' 分鐘後），已記錄');
        this._pendingSocialChat = null;
    }

    // =========================================================
    // 🌐 主動網路研究
    // =========================================================

    async performWebResearch(decisionReason = '') {
        try {
            const soul = this.decision.readSoul();
            const recentJournal = this.journal.readRecent(5);

            const topicPrompt = this.loadPrompt('web-research-topic.md', {
                SOUL: soul,
                RECENT_JOURNAL: JSON.stringify(recentJournal.slice(-5), null, 0),
                DECISION_REASON: decisionReason
            }) || `你是 Golem。根據你的目標和經驗，你決定要上網研究一個主題。
決策理由：${decisionReason}
用 JSON 回覆：{"query": "搜尋關鍵字（英文）", "purpose": "為什麼要研究這個"}`;

            const topicRaw = await this.decision.callLLM(topicPrompt, { maxOutputTokens: 256, temperature: 0.7, intent: 'decision' });
            const topicCleaned = topicRaw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            let topicData;
            try {
                topicData = JSON.parse(topicCleaned);
            } catch {
                console.warn('🌐 [WebResearch] 主題 JSON 解析失敗:', topicCleaned.substring(0, 100));
                this.journal.append({ action: 'web_research', outcome: 'topic_parse_failed' });
                return;
            }

            const query = topicData.query || 'AI agent architecture';
            const purpose = topicData.purpose || decisionReason;
            console.log('🌐 [WebResearch] 搜尋主題: ' + query + ' | 目的: ' + purpose);

            const searchPrompt = '搜尋並用繁體中文摘要以下主題的最新資訊（200-300字）：\n' +
                '主題：' + query + '\n' +
                '重點：' + purpose + '\n' +
                '請包含具體的數據、版本號、日期等事實性資訊。如果找到相關的工具或專案，列出名稱和網址。';

            const text = await this.decision.callLLM(searchPrompt, {
                maxOutputTokens: 1024, temperature: 0.5, intent: 'analysis',
                tools: [{ googleSearch: {} }]
            });

            const reflectionFile = this.decision.saveReflection('web_research', text);
            const parts = [
                '🌐 網路研究報告',
                '🔎 主題: ' + query,
                '💡 目的: ' + purpose,
                '', text
            ].filter(Boolean).join('\n');
            await this.notifier.sendToAdmin(parts);

            this.journal.append({
                action: 'web_research', topic: query, purpose: purpose,
                outcome: 'shared', reflection_file: reflectionFile
            });
            console.log('✅ [WebResearch] 研究報告已發送: ' + query);
        } catch (e) {
            console.error('❌ [WebResearch] 研究失敗:', e.message);
            this.journal.append({ action: 'web_research', outcome: 'error', error: e.message });
        }
    }

    // =========================================================
    // 🔍 GitHub 探索
    // =========================================================

    _getExploredRepos() {
        const fp = path.join(process.cwd(), 'memory', 'explored-repos.json');
        try {
            if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
        } catch (e) {}
        return [];
    }

    _saveExploredRepo(repo) {
        const fp = path.join(process.cwd(), 'memory', 'explored-repos.json');
        const list = this._getExploredRepos();
        list.push({ full_name: repo.full_name, stars: repo.stargazers_count, explored_at: new Date().toISOString() });
        fs.writeFileSync(fp, JSON.stringify(list.slice(-200), null, 2));
    }

    async performGitHubExplore() {
        try {
            const topics = [
                'autonomous agent framework', 'LLM tool use', 'AI agent memory',
                'local AI assistant', 'AI self-improvement', 'prompt engineering framework',
                'vector memory AI', 'telegram bot AI agent', 'lightweight LLM inference',
                'AI agent planning', 'code generation agent', 'multi-agent system'
            ];
            const topic = topics[Math.floor(Math.random() * topics.length)];
            const explored = this._getExploredRepos();
            const exploredNames = new Set(explored.map(r => r.full_name));

            console.log(`🔍 [GitHub] 搜尋主題: ${topic}`);

            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Forked-Golem/9.7'
            };
            if (this.config.GITHUB_TOKEN) {
                headers['Authorization'] = `token ${this.config.GITHUB_TOKEN}`;
            }

            const query = encodeURIComponent(topic);
            const searchUrl = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=10`;

            const searchRes = await new Promise((resolve, reject) => {
                https.get(searchUrl, { headers }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch (e) { reject(new Error('GitHub API JSON parse failed')); }
                    });
                    res.on('error', reject);
                }).on('error', reject);
            });

            if (!searchRes.items || searchRes.items.length === 0) {
                console.log('🔍 [GitHub] 沒有搜尋結果');
                this.journal.append({ action: 'github_explore', topic, outcome: 'no_results' });
                return;
            }

            const newRepo = searchRes.items.find(r => !exploredNames.has(r.full_name));
            if (!newRepo) {
                console.log('🔍 [GitHub] 此主題的結果都已探索過');
                this.journal.append({ action: 'github_explore', topic, outcome: 'all_explored' });
                return;
            }

            console.log(`🔍 [GitHub] 選中: ${newRepo.full_name} (⭐ ${newRepo.stargazers_count})`);

            const readmeUrl = `https://api.github.com/repos/${newRepo.full_name}/readme`;
            let readmeText = '(無法取得 README)';
            try {
                const readmeHeaders = Object.assign({}, headers, { 'Accept': 'application/vnd.github.v3.raw' });
                const readmeRes = await new Promise((resolve, reject) => {
                    https.get(readmeUrl, { headers: readmeHeaders }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(data));
                        res.on('error', reject);
                    }).on('error', reject);
                });
                readmeText = readmeRes.substring(0, 3000);
            } catch (e) {
                console.warn('[GitHub] README 讀取失敗:', e.message);
            }

            const soul = this.decision.readSoul();
            const analysisPrompt = this.loadPrompt('github-analysis.md', {
                SOUL: soul,
                REPO_FULLNAME: newRepo.full_name,
                STARS: String(newRepo.stargazers_count),
                DESCRIPTION: newRepo.description || '(無)',
                LANGUAGE: newRepo.language || '(未標示)',
                README_TEXT: readmeText
            }) || `${soul}\nGitHub 探索：${newRepo.full_name}，用繁體中文寫 200 字心得。`;

            const analysis = await this.decision.callLLM(analysisPrompt, { maxOutputTokens: 512, temperature: 0.7, intent: 'analysis' });
            const reflectionFile = this.decision.saveReflection('github_explore', analysis);
            this._saveExploredRepo(newRepo);

            const parts = [
                '🔍 GitHub 探索報告',
                `📦 ${newRepo.full_name} ⭐ ${newRepo.stargazers_count.toLocaleString()}`,
                `🏷️ ${newRepo.language || 'N/A'} | 主題: ${topic}`,
                `🔗 https://github.com/${newRepo.full_name}`,
                '', analysis
            ].join('\n');
            await this.notifier.sendToAdmin(parts);

            this.journal.append({
                action: 'github_explore', topic, repo: newRepo.full_name,
                stars: newRepo.stargazers_count, language: newRepo.language,
                outcome: 'shared', reflection_file: reflectionFile
            });
            console.log(`✅ [GitHub] 探索報告已發送: ${newRepo.full_name}`);
        } catch (e) {
            console.error('❌ [GitHub] 探索失敗:', e.message);
            this.journal.append({ action: 'github_explore', outcome: 'error', error: e.message });
        }
    }

    // =========================================================
    // 🧬 自我進化
    // =========================================================

    async performSelfReflection(triggerCtx = null) {
        const _heapReflect = process.memoryUsage();
        console.log(`🧠 [Heap] self_reflection 開始: RSS=${(_heapReflect.rss/1024/1024).toFixed(0)}MB, Heap=${(_heapReflect.heapUsed/1024/1024).toFixed(0)}MB`);
        try {
            const advice = this.memory.getAdvice();
            const recentJournal = this.journal.readRecent(10);
            let journalContext = '(無)';
            if (recentJournal.length > 0) {
                journalContext = recentJournal.map(j => {
                    const time = j.ts ? new Date(j.ts).toLocaleString('zh-TW', { hour12: false }) : '?';
                    return '[' + time + '] ' + j.action + ': ' + (j.outcome || j.description || j.topic || '');
                }).join('\n');
            }

            // Phase 1: 診斷
            const soul = this.decision.readSoul();
            const fileList = this.decision.getProjectFileList();
            const diagPrompt = [
                '你是 Golem，一個自律型 AI Agent。你正在做自我反省。',
                '', '【靈魂文件】', soul,
                '', '【最近經驗】', journalContext,
                '', '【老哥的建議】', advice || '(無)',
                '', '【專案檔案清單（含行數）】', fileList,
                '', '【要求】',
                '根據你最近的經驗（特別是失敗、錯誤、或可改進的地方），判斷：',
                '1. 你想改進什麼？（具體描述問題）',
                '2. 需要看哪個檔案的哪個函式或區段？',
                '3. 改進方案的大致方向（不需要寫程式碼）',
                '', '用 JSON 回覆：',
                '{"diagnosis": "問題描述", "target_file": "src/autonomy/actions.js", "approach": "改進方向"}',
                '注意：target_file 必須是上方檔案清單中的完整路徑（例如 src/brain.js, src/autonomy/decision.js）',
                '只輸出 JSON。如果你認為目前沒有需要改進的地方，回覆：',
                '{"diagnosis": "none", "reason": "為什麼不需要改進"}',
            ].join('\n');

            console.log('🧬 [Reflection] Phase 1: 診斷...');
            const diagRaw = await this.decision.callLLM(diagPrompt, { maxOutputTokens: 512, temperature: 0.5, intent: 'analysis' });
            const diagFile = this.decision.saveReflection('self_reflection_diag', diagRaw);

            let diag;
            try {
                const cleaned = diagRaw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
                diag = JSON.parse(cleaned);
            } catch (e) {
                console.warn('🧬 [Reflection] 診斷 JSON 解析失敗:', e.message);
                this.journal.append({ action: 'self_reflection', phase: 'diagnosis', outcome: 'parse_failed', reflection_file: diagFile });
                return;
            }

            if (diag.diagnosis === 'none') {
                console.log('🧬 [Reflection] 診斷結果：目前無需改進 — ' + (diag.reason || ''));
                this.journal.append({ action: 'self_reflection', phase: 'diagnosis', outcome: 'no_issues', reason: diag.reason, reflection_file: diagFile });
                return;
            }

            console.log('🧬 [Reflection] 診斷: ' + diag.diagnosis);
            console.log('🧬 [Reflection] 目標: ' + (diag.target_file || 'src/autonomy/actions.js'));

            // Phase 2: 生成 patch
            const targetFile = diag.target_file || 'src/autonomy/actions.js';
            const codeSnippet = this.decision.extractCodeSection(targetFile);

            if (!codeSnippet || codeSnippet.length < 10) {
                console.warn('🧬 [Reflection] 無法提取目標程式碼區段');
                this.journal.append({ action: 'self_reflection', phase: 'extraction', outcome: 'section_not_found', target: targetFile + ':' + targetSection, reflection_file: diagFile });
                return;
            }

            const evolutionSkill = this.skills.skillLoader.loadSkill("EVOLUTION") || "Output a JSON Array.";
            const patchPrompt = [
                evolutionSkill,
                '', '## DIAGNOSIS（Phase 1 的分析結果）',
                '問題：' + diag.diagnosis,
                '改進方向：' + (diag.approach || ''),
                '', '## TARGET CODE（' + targetFile + '，相關區段）', '', codeSnippet,
                '', '## RECENT EXPERIENCE (journal)', '', journalContext,
                '', 'Based on the diagnosis above, output ONLY a JSON Array with ONE focused patch.',
                'The "search" field must EXACTLY match a substring in the target code above.',
                'Include "file" field with the target file path (e.g. "src/brain.js").',
                'Include "affected_files" listing other src/ files that call the modified function/method.',
                'Keep the patch small and focused. ONE change only.',
            ].join('\n');

            console.log('🧬 [Reflection] Phase 2: 生成 patch（' + codeSnippet.length + ' chars context）...');
            const raw = await this.decision.callLLM(patchPrompt, { intent: 'reflection', maxOutputTokens: 2048, temperature: 0.2 });
            const reflectionFile = this.decision.saveReflection('self_reflection', raw);

            let proposals = this.ResponseParser.extractJson(raw);
            if (!Array.isArray(proposals) || proposals.length === 0) {
                this.journal.append({ action: 'self_reflection', outcome: 'no_proposals', reflection_file: reflectionFile });
                return;
            }

            const proposal = proposals[0];
            const mode = proposal.mode || (proposal.search ? 'core_patch' : 'unknown');

            // 模式一：技能擴展
            if (mode === 'skill_create') {
                const skillName = proposal.skill_name;
                const content = proposal.content;
                if (!skillName || !content) {
                    this.journal.append({ action: 'self_reflection', mode: 'skill_create', outcome: 'invalid_proposal', reflection_file: reflectionFile });
                    return;
                }
                const skillPath = path.join(process.cwd(), 'skills.d', skillName + '.md');
                if (fs.existsSync(skillPath)) {
                    this.journal.append({ action: 'self_reflection', mode: 'skill_create', outcome: 'skill_already_exists', skill_name: skillName, reflection_file: reflectionFile });
                    return;
                }
                fs.writeFileSync(skillPath, content);
                const msgText = '🧩 **新技能已建立**: ' + skillName + '\n' + (proposal.description || '') + '\n原因: ' + (proposal.reason || '');
                await this.notifier.sendToAdmin(msgText);
                this.journal.append({
                    action: 'self_reflection', mode: 'skill_create',
                    skill_name: skillName, description: proposal.description,
                    outcome: 'skill_created', reflection_file: reflectionFile
                });
                return;
            }

            // 模式二：核心進化
            if (mode === 'core_patch' || (proposal.search && proposal.replace !== undefined)) {
                if (typeof proposal.search !== 'string' || typeof proposal.replace !== 'string') {
                    this.journal.append({ action: 'self_reflection', mode: 'core_patch', outcome: 'invalid_patch', reflection_file: reflectionFile });
                    return;
                }
                const proposalType = proposal.type || 'unknown';
                this.memory.recordProposal(proposalType);

                const validFiles = ['index.js', 'skills.js'];
                // 加入 src/ 下所有已知模組
                const srcDir = path.join(process.cwd(), 'src');
                if (fs.existsSync(srcDir)) {
                    const scanDir = (dir, prefix) => {
                        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                            const rel = prefix ? prefix + '/' + e.name : e.name;
                            if (e.isDirectory()) scanDir(path.join(dir, e.name), rel);
                            else if (e.name.endsWith('.js')) validFiles.push('src/' + rel);
                        }
                    };
                    scanDir(srcDir, '');
                }

                const targetName = validFiles.includes(proposal.file) ? proposal.file : 'src/autonomy/actions.js';
                const targetPath = path.join(process.cwd(), targetName);

                const testFile = this.PatchManager.createTestClone(targetPath, [proposal]);
                let isVerified = false;
                if (targetName === 'skills.js') {
                    try { require(path.resolve(testFile)); isVerified = true; } catch (e) { console.error(e); }
                } else {
                    isVerified = this.PatchManager.verify(testFile);
                }

                if (isVerified) {
                    global.pendingPatch = { path: testFile, target: targetPath, name: targetName, description: proposal.description };
                    const msgText = '💡 **核心進化提案** (' + proposalType + ')\n目標：' + targetName + '\n內容：' + (proposal.description || '');
                    const options = { reply_markup: { inline_keyboard: [[{ text: '🚀 部署', callback_data: 'PATCH_DEPLOY' }, { text: '🗑️ 丟棄', callback_data: 'PATCH_DROP' }]] } };
                    if (triggerCtx) {
                        await triggerCtx.reply(msgText, options);
                        await triggerCtx.sendDocument(testFile);
                    } else if (this.config.ADMIN_IDS && this.config.ADMIN_IDS[0]) {
                        const { tgBot } = this.notifier;
                        if (tgBot) {
                            await tgBot.api.sendMessage(this.config.ADMIN_IDS[0], msgText, options);
                            await tgBot.api.sendDocument(this.config.ADMIN_IDS[0], new this.InputFile(testFile));
                        }
                    }
                    this.journal.append({
                        action: 'self_reflection', mode: 'core_patch',
                        proposal: proposalType, target: targetName,
                        description: proposal.description, outcome: 'proposed',
                        reflection_file: reflectionFile
                    });
                } else {
                    this.journal.append({
                        action: 'self_reflection', mode: 'core_patch',
                        proposal: proposalType, outcome: 'verification_failed',
                        reflection_file: reflectionFile
                    });
                }
                return;
            }

            this.journal.append({ action: 'self_reflection', mode: mode, outcome: 'unknown_mode', reflection_file: reflectionFile });
        } catch (e) {
            console.error('[錯誤] 自主進化失敗:', e.message || e);
            this.journal.append({ action: 'self_reflection', outcome: 'error', error: e.message });
        }
    }

    // =========================================================
    // 📝 消化歸納
    // =========================================================

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

            await this.notifier.sendToAdmin(
                '📝 消化歸納完成\n\n' + summary + '\n\n📄 完整文件: memory/synthesis/' + filename
            );

            this.journal.append({
                action: 'digest', topic: firstLine, outcome: 'completed',
                file: 'synthesis/' + filename, summary_preview: summary.substring(0, 100)
            });
            console.log('📝 [Digest] 消化歸納完成。');
        } catch (e) {
            console.error('❌ [Digest] 失敗:', e.message);
            this.journal.append({ action: 'digest', outcome: 'error', error: e.message });
        }
    }
}

module.exports = ActionRunner;
