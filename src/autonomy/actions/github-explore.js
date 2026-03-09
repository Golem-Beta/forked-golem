/**
 * @module github-explore
 * @role GitHub 探索行動 — 主題搜尋 → README 分析 → 匯報 → 記憶更新
 * @when-to-modify 調整搜尋主題池、GitHub API 呼叫邏輯、或探索報告格式時
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const BaseAction = require('./base-action');

class GitHubExploreAction extends BaseAction {
    constructor({ journal, notifier, decision, config, loadPrompt, memoryLayer, brain }) {
        super({ journal, notifier, decision, loadPrompt });
        this.config = config;
        this.memory = memoryLayer || null;
        this.brain = brain || null;
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

                                async performGitHubExplore() {
                    try {
                        const abort = this._abortIfChannelDown('github_explore');
                        if (abort) return abort;
                        const topics = [
                            // 原有
                            'autonomous agent framework', 'LLM tool use', 'AI agent memory',
                            'local AI assistant', 'AI self-improvement', 'prompt engineering framework',
                            'vector memory AI', 'telegram bot AI agent', 'lightweight LLM inference',
                            'AI agent planning', 'code generation agent', 'multi-agent system',
                            'LLM observability', 'AI safety guardrails', 'small language model optimization',
                            // 工具整合 / 執行層
                            'MCP server tools', 'function calling agent', 'computer use automation',
                            'browser automation AI', 'shell agent local',
                            // 記憶 / 知識管理
                            'knowledge graph agent', 'RAG pipeline lightweight', 'episodic memory AI',
                            'context window management', 'long context retrieval',
                            // 推理 / 決策
                            'chain of thought reasoning', 'tree of thought LLM', 'ReAct agent framework',
                            'agent task decomposition', 'goal conditioned AI',
                            // 自我改進 / 評估
                            'LLM self evaluation', 'AI agent benchmarking', 'automated prompt optimization',
                            'LLM output validation', 'AI reflection loop',
                            // 低資源 / 本地推理
                            'edge AI inference', 'quantized LLM deployment', 'ollama local model',
                            'llama.cpp wrapper', 'CPU inference optimization',
                            // 多 Agent / 協作
                            'agent communication protocol', 'swarm intelligence AI', 'debate between agents',
                            'hierarchical agent system', 'agent role assignment',
                            // 安全 / 對齊
                            'AI agent sandboxing', 'LLM guardrails safety', 'prompt injection defense',
                            'agent action auditing', 'constitutional AI implementation',
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
                
                        const query = encodeURIComponent(`${topic} stars:>100`);
                        const searchUrl = `https://api.github.com/search/repositories?q=${query}&sort=updated&order=desc&per_page=30`;
                
                        const searchRes = await new Promise((resolve, reject) => {
                            https.get(searchUrl, { headers }, (res) => {
                                let data = '';
                                res.on('data', chunk => data += chunk);
                                res.on('end', () => {
                                    try { 
                                        const parsed = JSON.parse(data);
                                        if (res.statusCode === 403 && data.includes('rate limit')) {
                                            return reject(new Error('GitHub API Rate Limit Exceeded'));
                                        }
                                        resolve(parsed); 
                                    } catch (e) { reject(new Error('GitHub API JSON parse failed')); }
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
                                    if (res.statusCode === 302 && res.headers.location) {
                                        https.get(res.headers.location, { headers: { 'User-Agent': 'Forked-Golem/9.7' } }, (res2) => {
                                            let data2 = '';
                                            res2.on('data', chunk => data2 += chunk);
                                            res2.on('end', () => resolve(data2));
                                        }).on('error', reject);
                                        return;
                                    }
                                    let data = '';
                                    res.on('data', chunk => data += chunk);
                                    res.on('end', () => resolve(data));
                                    res.on('error', reject);
                                }).on('error', reject);
                            });
                            readmeText = typeof readmeRes === 'string' ? readmeRes.substring(0, 4000) : JSON.stringify(readmeRes).substring(0, 4000);
                        } catch (e) {
                            console.warn('[GitHub] README 讀取失敗:', e.message);
                        }
                
                        const soul = this.decision.readSoul();
                
                        let knownSection = '';
                        try {
                            if (this.memory) {
                                const repoQuery = [newRepo.description, newRepo.language, topic].filter(Boolean).join(' ');
                                const { cold } = this.memory.recall(repoQuery, { hotLimit: 0, warmLimit: 0, coldLimit: 2 });
                                knownSection = cold ? '【我已知的相關知識】\n' + cold : '';
                            }
                        } catch (e) { }
                
                        const analysisPrompt = this.loadPrompt('github-analysis.md', {
                            SOUL: soul,
                            REPO_FULLNAME: newRepo.full_name,
                            STARS: String(newRepo.stargazers_count),
                            DESCRIPTION: newRepo.description || '(無)',
                            LANGUAGE: newRepo.language || '(未標示)',
                            README_TEXT: readmeText,
                            KNOWN_INSIGHTS: knownSection
                        }) || `${soul}\nGitHub 探索：${newRepo.full_name}，請分析其技術價值並用繁體中文寫 300 字深度心得。`;
                
                        const analysis = (await this.decision.callLLM(analysisPrompt, { temperature: 0.7, intent: 'analysis' })).text;
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
                        console.log('[GitHub] sendToAdmin:', sentGH === true ? '✅ OK' : sentGH === 'queued' ? '🔇 queued' : '❌ FAILED');
                
                        this.journal.append({
                            action: 'github_explore', topic, repo: newRepo.full_name,
                            stars: newRepo.stargazers_count, language: newRepo.language,
                            outcome: this._sentOutcome(sentGH, 'shared'), reflection_file: reflectionFile,
                            model: this.decision.lastModel,
                            tokens: this.decision.lastTokens,
                            ...this._sentErrorField(sentGH)
                        });
                
                        if (sentGH === true) console.log(`✅ [GitHub] 探索報告已發送: ${newRepo.full_name}`);
                        return {
                            success: sentGH === true,
                            action: 'github_explore',
                            outcome: this._sentOutcome(sentGH, 'shared'),
                            ...(sentGH === true ? {
                                memorize: {
                                    text: `[GitHub Explore] ${newRepo.full_name}: ${analysis.substring(0, 500)}`,
                                    metadata: { source: 'github_explore', repo: newRepo.full_name, topic }
                                }
                            } : {})
                        };
                    } catch (e) {
                        console.error('❌ [GitHub] 探索失敗:', e.message);
                        this.journal.append({ 
                            action: 'github_explore', 
                            outcome: 'error', 
                            error: e.message, 
                            diagnosis: e.message.includes('Rate Limit') ? 'api_throttled' : 'unknown_exception'
                        });
                        return { success: false, action: 'github_explore', outcome: 'error', detail: e.message };
                    }
                }
}

module.exports = GitHubExploreAction;
