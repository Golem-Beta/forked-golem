/**
 * @module explore
 * @role 探索行動 — 網路研究 + GitHub Repo 探索
 * @when-to-modify 調整搜尋主題池、GitHub API 呼叫、或探索報告格式時
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

class ExploreAction {
    constructor({ journal, notifier, decision, config, loadPrompt }) {
        this.journal = journal;
        this.notifier = notifier;
        this.decision = decision;
        this.config = config;
        this.loadPrompt = loadPrompt;
    }

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
            const sentWR = await this.notifier.sendToAdmin(parts);
            console.log('[WebResearch] sendToAdmin:', sentWR ? '✅ OK' : '❌ FAILED');

            this.journal.append({
                action: 'web_research', topic: query, purpose: purpose,
                outcome: sentWR ? 'shared' : 'send_failed', reflection_file: reflectionFile
            });
            if (sentWR) console.log('✅ [WebResearch] 研究報告已發送: ' + query);
        } catch (e) {
            console.error('❌ [WebResearch] 研究失敗:', e.message);
            this.journal.append({ action: 'web_research', outcome: 'error', error: e.message });
        }
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
            const sentGH = await this.notifier.sendToAdmin(parts);
            console.log('[GitHub] sendToAdmin:', sentGH ? '✅ OK' : '❌ FAILED');

            this.journal.append({
                action: 'github_explore', topic, repo: newRepo.full_name,
                stars: newRepo.stargazers_count, language: newRepo.language,
                outcome: sentGH ? 'shared' : 'send_failed', reflection_file: reflectionFile,
                model: this.decision.lastModel,
                tokens: this.decision.lastTokens
            });
            if (sentGH) console.log(`✅ [GitHub] 探索報告已發送: ${newRepo.full_name}`);
        } catch (e) {
            console.error('❌ [GitHub] 探索失敗:', e.message);
            this.journal.append({ action: 'github_explore', outcome: 'error', error: e.message });
        }
    }
}

module.exports = ExploreAction;
