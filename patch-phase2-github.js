/**
 * patch-phase2-github.js
 * ======================
 * Phase 2: 為 AutonomyManager 加入 GitHub 探索功能
 *
 * 用法：
 *   scp patch-phase2-github.js user@192.168.0.222:~/forked-golem/
 *   ssh user@192.168.0.222 "cd ~/forked-golem && node patch-phase2-github.js"
 *
 * 改動：
 *   1. manifestFreeWill 機率分配: 15% 內省 / 45% GitHub / 40% 社交
 *   2. 新增 _getExploredRepos / _saveExploredRepo 持久化方法
 *   3. 新增 performGitHubExplore 方法
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(process.cwd(), 'index.js');
const BACKUP = TARGET + '.bak_phase2';

console.log("🔍 [Phase 2] GitHub Explore Patch");
console.log("==================================\n");

if (!fs.existsSync(TARGET)) {
    console.error("❌ 找不到 index.js");
    process.exit(1);
}

// 備份
if (!fs.existsSync(BACKUP)) {
    fs.copyFileSync(TARGET, BACKUP);
    console.log("📦 已備份: " + BACKUP);
} else {
    console.log("📦 備份已存在: " + BACKUP);
}

let code = fs.readFileSync(TARGET, 'utf-8');

// ============================================================
// 檢查是否已經套用過
// ============================================================
if (code.includes('performGitHubExplore')) {
    console.log("⏭️  已包含 performGitHubExplore，無需再次修補。");
    process.exit(0);
}

// ============================================================
// Step 1: 修改 manifestFreeWill 決策邏輯
// ============================================================
console.log("[1/3] 修改 manifestFreeWill...");

const OLD_MANIFEST = [
    '    async manifestFreeWill() {',
    '        try {',
    '            const roll = Math.random();',
    '',
    '            if (roll < 0.15 && !this.hasActionToday(\'self_reflection\')) {',
    '                // 15% 機率 + 今天沒做過',
    '                console.log("🧬 Golem 決定進行自我內省 (Evolution)...");',
    '                await this.performSelfReflection();',
    '            } else {',
    '                // 85% 社交（Phase 2 會把一部分改為 GitHub 探索）',
    '                console.log("💬 Golem 決定找主人聊天 (Social)...");',
    '                await this.performSpontaneousChat();',
    '            }',
].join('\n');

const NEW_MANIFEST = [
    '    async manifestFreeWill() {',
    '        try {',
    '            const roll = Math.random();',
    '',
    '            if (roll < 0.17 && !this.hasActionToday(\'self_reflection\')) {',
    '                // 17% 自我內省（每天最多 1 次）',
    '                console.log("🧬 Golem 決定進行自我內省 (Evolution)...");',
    '                await this.performSelfReflection();',
    '            } else if (roll < 0.83) {',
    '                // 66% GitHub 探索',
    '                console.log("🔍 Golem 決定探索 GitHub (Explore)...");',
    '                await this.performGitHubExplore();',
    '            } else {',
    '                // 17% 社交',
    '                console.log("💬 Golem 決定找主人聊天 (Social)...");',
    '                await this.performSpontaneousChat();',
    '            }',
].join('\n');

if (!code.includes(OLD_MANIFEST)) {
    console.error("❌ 找不到 manifestFreeWill 原始程式碼。");
    console.error("   提示：可能已被修改，或空白/縮排不一致。");
    // 嘗試更寬鬆的匹配
    if (code.includes("Phase 2 會把一部分改為 GitHub 探索")) {
        console.log("   偵測到 Phase 1 的註解標記，嘗試寬鬆替換...");
    }
    process.exit(1);
}

code = code.replace(OLD_MANIFEST, NEW_MANIFEST);
console.log("✅ manifestFreeWill 已更新");

// ============================================================
// Step 2: 插入 performGitHubExplore + 持久化方法
// ============================================================
console.log("\n[2/3] 插入 GitHub 探索方法...");

const INSERT_MARKER = '    // =========================================================\n    // 🧬 自我進化（每天最多 1 次，用 journal 判斷）\n    // =========================================================';

if (!code.includes(INSERT_MARKER)) {
    console.error("❌ 找不到插入標記 (performSelfReflection 區塊)");
    process.exit(1);
}

// 構建新方法（用陣列 join 避免 heredoc 轉義問題）
const newMethods = [
    '    // =========================================================',
    '    // 🔍 GitHub 探索：搜尋有趣專案 → 讀 README → Gemini 分析 → 通知主人',
    '    // =========================================================',
    '    _getExploredRepos() {',
    '        const fp = path.join(process.cwd(), \'memory\', \'explored-repos.json\');',
    '        try {',
    '            if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, \'utf-8\'));',
    '        } catch (e) {}',
    '        return [];',
    '    }',
    '',
    '    _saveExploredRepo(repo) {',
    '        const fp = path.join(process.cwd(), \'memory\', \'explored-repos.json\');',
    '        const list = this._getExploredRepos();',
    '        list.push({',
    '            full_name: repo.full_name,',
    '            stars: repo.stargazers_count,',
    '            explored_at: new Date().toISOString()',
    '        });',
    '        // 保留最近 200 筆',
    '        const trimmed = list.slice(-200);',
    '        fs.writeFileSync(fp, JSON.stringify(trimmed, null, 2));',
    '    }',
    '',
    '    async performGitHubExplore() {',
    '        try {',
    '            // 隨機選一個搜尋主題',
    '            const topics = [',
    '                \'autonomous agent framework\',',
    '                \'LLM tool use\',',
    '                \'AI agent memory\',',
    '                \'local AI assistant\',',
    '                \'AI self-improvement\',',
    '                \'prompt engineering framework\',',
    '                \'vector memory AI\',',
    '                \'telegram bot AI agent\',',
    '                \'lightweight LLM inference\',',
    '                \'AI agent planning\',',
    '                \'code generation agent\',',
    '                \'multi-agent system\'',
    '            ];',
    '            const topic = topics[Math.floor(Math.random() * topics.length)];',
    '            const explored = this._getExploredRepos();',
    '            const exploredNames = new Set(explored.map(r => r.full_name));',
    '',
    '            console.log(`🔍 [GitHub] 搜尋主題: ${topic}`);',
    '',
    '            // GitHub Search API',
    '            const headers = {',
    '                \'Accept\': \'application/vnd.github.v3+json\',',
    '                \'User-Agent\': \'Forked-Golem/9.3\'',
    '            };',
    '            if (CONFIG.GITHUB_TOKEN) {',
    '                headers[\'Authorization\'] = `token ${CONFIG.GITHUB_TOKEN}`;',
    '            }',
    '',
    '            const query = encodeURIComponent(topic);',
    '            const searchUrl = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=10`;',
    '',
    '            const searchRes = await new Promise((resolve, reject) => {',
    '                https.get(searchUrl, { headers }, (res) => {',
    '                    let data = \'\';',
    '                    res.on(\'data\', chunk => data += chunk);',
    '                    res.on(\'end\', () => {',
    '                        try { resolve(JSON.parse(data)); }',
    '                        catch (e) { reject(new Error(\'GitHub API JSON parse failed\')); }',
    '                    });',
    '                    res.on(\'error\', reject);',
    '                }).on(\'error\', reject);',
    '            });',
    '',
    '            if (!searchRes.items || searchRes.items.length === 0) {',
    '                console.log(\'🔍 [GitHub] 沒有搜尋結果\');',
    '                this.appendJournal({ action: \'github_explore\', topic, outcome: \'no_results\' });',
    '                return;',
    '            }',
    '',
    '            // 過濾已探索的 repo',
    '            const newRepo = searchRes.items.find(r => !exploredNames.has(r.full_name));',
    '            if (!newRepo) {',
    '                console.log(\'🔍 [GitHub] 此主題的結果都已探索過\');',
    '                this.appendJournal({ action: \'github_explore\', topic, outcome: \'all_explored\' });',
    '                return;',
    '            }',
    '',
    '            console.log(`🔍 [GitHub] 選中: ${newRepo.full_name} (⭐ ${newRepo.stargazers_count})`);',
    '',
    '            // 讀取 README',
    '            const readmeUrl = `https://api.github.com/repos/${newRepo.full_name}/readme`;',
    '            let readmeText = \'(無法取得 README)\';',
    '',
    '            try {',
    '                const readmeRes = await new Promise((resolve, reject) => {',
    '                    const readmeHeaders = Object.assign({}, headers, {',
    '                        \'Accept\': \'application/vnd.github.v3.raw\'',
    '                    });',
    '                    https.get(readmeUrl, { headers: readmeHeaders }, (res) => {',
    '                        let data = \'\';',
    '                        res.on(\'data\', chunk => data += chunk);',
    '                        res.on(\'end\', () => resolve(data));',
    '                        res.on(\'error\', reject);',
    '                    }).on(\'error\', reject);',
    '                });',
    '                readmeText = readmeRes.substring(0, 3000);',
    '            } catch (e) {',
    '                console.warn(\'[GitHub] README 讀取失敗:\', e.message);',
    '            }',
    '',
    '            // Gemini 分析',
    '            const analysisPrompt = [',
    '                \'【任務】GitHub 專案探索報告\',',
    '                `【專案】${newRepo.full_name} (⭐ ${newRepo.stargazers_count})`,',
    '                `【描述】${newRepo.description || \'(無)\'}`,',
    '                `【語言】${newRepo.language || \'(未標示)\'}`,',
    '                \'【README 節錄】\',',
    '                readmeText,',
    '                \'\',',
    '                \'【要求】\',',
    '                \'1. 用 2-3 句話總結這個專案做什麼、有什麼特色\',',
    '                \'2. 對 Forked-Golem (跑在 ThinkPad X200 的本地 AI Agent) 有什麼可借鏡之處？\',',
    '                \'3. 語氣自然，像在跟主人分享有趣的發現\',',
    '                \'4. 如果這個專案跟我們的方向無關，也誠實說\'',
    '            ].join(\'\\n\');',
    '',
    '            const analysis = await this.brain.sendMessage(analysisPrompt);',
    '            const parsed = TriStreamParser.parse(analysis);',
    '',
    '            // 記錄已探索',
    '            this._saveExploredRepo(newRepo);',
    '',
    '            // 組裝通知',
    '            const replyText = parsed.reply || analysis;',
    '            const notification = [',
    '                \'🔍 GitHub 探索報告\',',
    '                `📦 ${newRepo.full_name} ⭐ ${newRepo.stargazers_count.toLocaleString()}`,',
    '                `🏷️ ${newRepo.language || \'N/A\'} | 主題: ${topic}`,',
    '                `🔗 https://github.com/${newRepo.full_name}`,',
    '                \'\',',
    '                replyText',
    '            ].join(\'\\n\');',
    '',
    '            // 發送通知',
    '            if (tgBot && CONFIG.ADMIN_IDS[0]) {',
    '                await tgBot.api.sendMessage(CONFIG.ADMIN_IDS[0], notification);',
    '            } else if (dcClient && CONFIG.DISCORD_ADMIN_ID) {',
    '                const user = await dcClient.users.fetch(CONFIG.DISCORD_ADMIN_ID);',
    '                await user.send(notification);',
    '            }',
    '',
    '            // 寫 journal',
    '            this.appendJournal({',
    '                action: \'github_explore\',',
    '                topic,',
    '                repo: newRepo.full_name,',
    '                stars: newRepo.stargazers_count,',
    '                language: newRepo.language,',
    '                outcome: \'shared\'',
    '            });',
    '',
    '            console.log(`✅ [GitHub] 探索報告已發送: ${newRepo.full_name}`);',
    '',
    '        } catch (e) {',
    '            console.error(\'❌ [GitHub] 探索失敗:\', e.message);',
    '            this.appendJournal({ action: \'github_explore\', outcome: \'error\', error: e.message });',
    '        }',
    '    }',
    '',
].join('\n');

code = code.replace(INSERT_MARKER, newMethods + INSERT_MARKER);
console.log("✅ performGitHubExplore 已插入");

// ============================================================
// Step 3: 語法檢查 + 寫入
// ============================================================
console.log("\n[3/3] 語法檢查...");

const tempFile = TARGET.replace('.js', '.tmp_phase2_check.js');
fs.writeFileSync(tempFile, code, 'utf-8');

try {
    require('child_process').execSync(`node -c "${tempFile}"`, { stdio: 'pipe' });
    console.log("✅ 語法檢查通過");
    fs.unlinkSync(tempFile);
} catch (e) {
    console.error("❌ 語法檢查失敗！不會寫入 index.js。");
    console.error(e.stderr ? e.stderr.toString() : e.message);
    fs.unlinkSync(tempFile);
    console.log("🔄 復原：cp index.js.bak_phase2 index.js");
    process.exit(1);
}

fs.writeFileSync(TARGET, code, 'utf-8');

console.log("\n🔍 Phase 2 部署完成！");
console.log("   ✅ manifestFreeWill: 17% 內省 / 66% GitHub / 17% 社交");
console.log("   ✅ performGitHubExplore: Search → README → Gemini 分析 → 通知");
console.log("   ✅ explored-repos.json 持久化 (最多 200 筆)");
console.log("   ✅ 備份: " + BACKUP);
console.log("\n👉 重啟 Golem 測試，然後 git commit + tag");
