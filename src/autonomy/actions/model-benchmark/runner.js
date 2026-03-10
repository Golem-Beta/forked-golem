'use strict';
/**
 * @module model-benchmark/runner
 * @role Benchmark orchestration — 可被 ModelBenchmarkAction 或外部直接呼叫
 *
 * 輸出：memory/model-benchmark-YYYY-MM-DD.md
 * 每個 target 按自身 suite（standard_suite / reasoning_suite）跑對應測試組。
 * 完成後呼叫 roster-manager 修剪每個 provider 的 active roster。
 */

const fs   = require('fs');
const path = require('path');

const { buildTargets }              = require('./targets');
const { TESTS, SUITES, SUITE_MAX_SCORE } = require('./tests');
const { callGemini, callOpenAICompat }   = require('./callers');
const providerRegistry              = require('../../../model-router/provider-registry');
const PROVIDER_CONFIGS              = require('../../../model-router/configs');
const rosterManager                 = require('../../../model-router/roster-manager');
const poolHealthChecker             = require('../../../model-router/pool-health-checker');

// 專案根目錄（model-benchmark/ 往上四層）
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..');

/**
 * 載入 system prompt（system-core + tristream-protocol 合併）。
 * @returns {string}
 */
function loadSystemPrompt() {
    const promptDir  = path.join(PROJECT_ROOT, 'prompts');
    const systemCore = fs.readFileSync(path.join(promptDir, 'system-core.md'), 'utf-8')
        .replace('{{SOUL}}', '你是 Golem，一個運行在本地機器上的自主 AI Agent。')
        .replace('{{PERSONA}}', '')
        .replace('{{VERSION}}', '9.13.x')
        .replace('{{ENV_INFO}}', 'ThinkPad X200, Arch Linux, Node.js v22');
    const tristream  = fs.readFileSync(path.join(promptDir, 'tristream-protocol.md'), 'utf-8');
    return systemCore + '\n\n' + tristream;
}

/**
 * 執行單一測試，捕捉所有例外。
 * @returns {Promise<{ok, ms, pass, detail, score, text}>}
 */
async function runTest(target, test, systemPrompt) {
    const start = Date.now();
    try {
        let text;
        if (target.type === 'gemini') {
            text = await callGemini(target.key, target.model, systemPrompt, test.prompt, test.maxTokens);
        } else {
            text = await callOpenAICompat(target.baseUrl, target.key, target.model, systemPrompt, test.prompt, test.maxTokens);
        }
        const ms     = Date.now() - start;
        const result = test.validate(text);
        return { ok: true, ms, text: text.substring(0, 300), ...result };
    } catch (e) {
        const isQuota = /quota|rate.?limit|429|exceeded/i.test(e.message);
        return { ok: false, skip: isQuota, ms: Date.now() - start, pass: false, detail: `❌ ${e.message}`, score: 0, text: '' };
    }
}

/**
 * 計算 provider 的最小請求間隔（ms）
 * 取 minIntervalMs 與 defaultRpm 換算值的較大者
 */
function providerIntervalMs(providerName) {
    const cfg = PROVIDER_CONFIGS[providerName] || {};
    const fromRpm     = cfg.defaultRpm ? Math.ceil(60000 / cfg.defaultRpm) : 2000;
    const fromConfig  = cfg.minIntervalMs || 0;
    return Math.max(fromRpm, fromConfig, 1000);  // 至少 1s
}

/**
 * interleaveByProvider：重排 order 使同 provider 的 model 之間插入其他 provider
 */
function interleaveByProvider(items) {
    const byProvider = {};
    for (const item of items) {
        const p = item.target.provider;
        if (!byProvider[p]) byProvider[p] = [];
        byProvider[p].push(item);
    }
    const providers = Object.keys(byProvider);
    const result    = [];
    const maxLen    = Math.max(...providers.map(p => byProvider[p].length));
    for (let i = 0; i < maxLen; i++) {
        for (const p of providers) {
            if (byProvider[p][i]) result.push(byProvider[p][i]);
        }
    }
    return result;
}

/**
 * 產生 Markdown 報告字串。
 * 未跑到的測試欄位顯示「—」。
 */
function generateReport(order, results) {
    const lines = [];
    lines.push('# Model Benchmark Report');
    lines.push(`\n**日期：** ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
    lines.push(`\n**測試項目：** ${TESTS.map(t => t.name).join('、')}`);
    lines.push(`\n**System Prompt：** 使用真實 Golem system-core + tristream-protocol\n`);

    // 總覽表
    lines.push('## 總覽\n');
    const header = ['Provider/Model', ...TESTS.map(t => t.name), '總分', '平均延遲'].join(' | ');
    lines.push(`| ${header} |`);
    lines.push(`| ${['---', ...TESTS.map(() => ':---:'), ':---:', ':---:'].join(' | ')} |`);

    for (const { key, target } of order) {
        const suiteName = target.suite || 'standard_suite';
        const suiteIds  = SUITES[suiteName];
        const maxScore  = SUITE_MAX_SCORE[suiteName];
        const row = [key];
        let totalScore = 0;
        let totalMs    = 0;
        let testCount  = 0;

        for (const test of TESTS) {
            const r = results[key]?.[test.id];
            if (!r) {
                row.push('—');   // 此 suite 不跑這個測試
            } else if (!r.ok) {
                row.push('💥 err');
            } else {
                row.push(r.pass ? '✅' : '❌');
                totalScore += r.pass ? 1 : 0;
                totalMs    += r.ms;
                testCount++;
            }
        }

        row.push(`${totalScore}/${maxScore}`);
        row.push(testCount > 0 ? `${Math.round(totalMs / testCount)}ms` : '-');
        lines.push(`| ${row.join(' | ')} |`);
    }

    // 詳細結果
    lines.push('\n## 詳細結果\n');
    for (const { key, target } of order) {
        lines.push(`### ${key}\n`);
        const suiteIds = SUITES[target.suite || 'standard_suite'];
        for (const test of TESTS) {
            if (!suiteIds.includes(test.id)) continue;
            const r = results[key]?.[test.id];
            if (!r) continue;
            lines.push(`**${test.name}** (${r.ms}ms) — ${r.detail}`);
            if (r.text) {
                lines.push(`\n<details><summary>回應預覽</summary>\n\n\`\`\`\n${r.text}\n\`\`\`\n\n</details>\n`);
            }
        }
        lines.push('');
    }

    // 建議分工
    lines.push('## 建議分工\n');
    lines.push('> 根據測試結果自動生成，僅供參考。\n');

    const tristreamPass = order
        .filter(({ key }) => results[key]['tristream']?.pass)
        .map(({ key }) => key);

    const fastModels = order
        .filter(({ key }) => {
            const suiteIds = SUITES[order.find(o => o.key === key)?.target?.suite || 'standard_suite'];
            const runTests = TESTS.filter(t => suiteIds.includes(t.id));
            const avg = runTests.reduce((s, t) => s + (results[key][t.id]?.ms || 0), 0) / (runTests.length || 1);
            return avg < 3000 && results[key]['tristream']?.ok;
        })
        .sort((a, b) => {
            const suiteA  = SUITES[order.find(o => o.key === a.key)?.target?.suite || 'standard_suite'];
            const suiteB  = SUITES[order.find(o => o.key === b.key)?.target?.suite || 'standard_suite'];
            const testsA  = TESTS.filter(t => suiteA.includes(t.id));
            const testsB  = TESTS.filter(t => suiteB.includes(t.id));
            const avgA    = testsA.reduce((s, t) => s + (results[a.key][t.id]?.ms || 0), 0) / (testsA.length || 1);
            const avgB    = testsB.reduce((s, t) => s + (results[b.key][t.id]?.ms || 0), 0) / (testsB.length || 1);
            return avgA - avgB;
        })
        .map(({ key }) => key);

    lines.push('**支援三流格式的 Model：**');
    lines.push(tristreamPass.length ? tristreamPass.map(k => `- ${k}`).join('\n') : '- （無）');
    lines.push('\n**回應最快的 Model（<3s）：**');
    lines.push(fastModels.length ? fastModels.map(k => `- ${k}`).join('\n') : '- （無）');

    return lines.join('\n');
}

class BenchmarkRunner {
    /**
     * @param {object} [opts]
     * @param {Function} [opts.onProgress] - (message: string) => void，每步進度回呼
     */
    constructor(opts = {}) {
        this.onProgress = opts.onProgress || null;
    }

    _log(msg) {
        if (this.onProgress) this.onProgress(msg);
        else console.log(msg);
    }

    /**
     * 執行完整 benchmark。
     * @param {object} [overrides] - 傳入 buildTargets 的 override（如 { models: [...] }）
     * @returns {Promise<{ outPath: string, summary: string }>}
     */
    async run(overrides = {}) {
        const systemPrompt = loadSystemPrompt();
        const targets      = buildTargets(overrides);

        if (!targets.length) {
            throw new Error('沒有可用的測試目標（請確認 API key 設定）');
        }

        this._log(`\n🔬 Model Benchmark — ${targets.length} targets\n`);

        const results = {};
        const order   = [];

        for (const target of targets) {
            const key = `${target.provider}/${target.model}`;
            results[key] = {};
            order.push({ key, target });
        }

        const interleaved = interleaveByProvider(order);

        // 外層 model（interleaved），內層 test
        // 每個 model 把所有 test 做完，再 delay，再換下一個 model
        // 保證完全串行：同一時刻只有一個 LLM 請求在飛
        for (let i = 0; i < interleaved.length; i++) {
            const { key, target } = interleaved[i];
            const suiteIds = SUITES[target.suite || 'standard_suite'];

            this._log(`\n🤖 ${key}`);

            const suiteTests = TESTS.filter(t => suiteIds.includes(t.id));
            for (let ti = 0; ti < suiteTests.length; ti++) {
                const test = suiteTests[ti];

                this._log(`  📋 ${test.name.padEnd(30)} ...`);
                const r = await runTest(target, test, systemPrompt);
                results[key][test.id] = r;
                this._log(r.pass ? `  ✅ ${r.ms}ms — ${r.detail}` : `  ❌ ${r.ms}ms — ${r.detail}`);

                // test 之間也要 delay（同一 provider 的連續請求）
                if (ti < suiteTests.length - 1) {
                    const interTestDelay = providerIntervalMs(target.provider);
                    await new Promise(res => setTimeout(res, interTestDelay));
                }
            }

            // model 做完後 delay，再打下一個 model
            // 同 provider：用 providerIntervalMs；跨 provider：1s
            const next = interleaved[i + 1];
            if (next) {
                const delayMs = next.target.provider === target.provider
                    ? providerIntervalMs(target.provider)
                    : 1000;
                this._log(`  ⏱ delay ${delayMs}ms → ${next.key}`);
                await new Promise(res => setTimeout(res, delayMs));
            }
        }

        const report  = generateReport(order, results);
        const date    = new Date().toISOString().split('T')[0];
        const memDir  = path.join(PROJECT_ROOT, 'memory');
        const outPath = path.join(memDir, `model-benchmark-${date}.md`);

        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(outPath, report);

        // 寫入 provider-registry（新 benchmarkScores 格式）
        for (const { key, target } of order) {
            const { provider, model } = target;
            const suiteName  = target.suite || 'standard_suite';
            const suiteIds   = SUITES[suiteName];
            const suiteTests = TESTS.filter(t => suiteIds.includes(t.id));
            const maxScore   = SUITE_MAX_SCORE[suiteName];

            const passCount  = suiteTests.filter(t => results[key][t.id]?.pass).length;
            const passRate   = passCount / suiteTests.length;
            const totalMs    = suiteTests.reduce((s, t) => s + (results[key][t.id]?.ms || 0), 0);
            const avgLatency = Math.round(totalMs / suiteTests.length);

            // benchmarkScores：各測試 pass → 1，否則 0
            const benchmarkScores = {};
            for (const t of suiteTests) {
                benchmarkScores[t.id] = results[key][t.id]?.pass ? 1 : 0;
            }

            const patch = {
                benchmarkScores,
                benchmarkMax:  maxScore,
                benchmarkDate: date,
                avgLatencyMs:  avgLatency,
            };

            // 如果所有測試都是 quota/rate-limit skip，不更新 registry（保留原狀態）
            const allSkipped = suiteTests.every(t => results[key][t.id]?.skip);
            if (allSkipped) {
                this._log(`  ⏭ ${key} 全部 skip（quota/rate-limit），保留原 registry 狀態`);
            } else if (passRate >= 0.75) {
                // 保留非測試能力（vision、long_context），依測試結果更新測試能力
                const currentInfo   = providerRegistry.getModelInfo(provider, model);
                const existingCaps  = currentInfo?.capabilities || [];
                const testedCapKeys = ['tristream', 'code', 'reasoning'];
                const preserved     = existingCaps.filter(c => !testedCapKeys.includes(c));

                if (results[key]['tristream']?.pass)         preserved.push('tristream');
                if (results[key]['code']?.pass)              preserved.push('code');
                if (results[key]['reasoning_quality']?.pass) preserved.push('reasoning');

                patch.status        = 'active';
                patch.capabilities  = preserved;
                patch.failureStreak = 0;
                patch.notes         = '';
            } else {
                const failed = suiteTests.filter(t => !results[key][t.id]?.pass && !results[key][t.id]?.skip).map(t => t.name);
                // failureStreak 保護：連續 2 次失敗才真正 disabled，1 次只降為 benched
                const currentInfo   = providerRegistry.getModelInfo(provider, model);
                const prevStreak    = currentInfo?.failureStreak || 0;
                const newStreak     = prevStreak + 1;
                if (newStreak >= 2) {
                    patch.status       = 'disabled';
                    patch.failureStreak = newStreak;
                    patch.notes        = `benchmark failed (${newStreak}x): ${failed.join(', ')}`;
                    this._log(`  💀 ${key} 連續 ${newStreak} 次失敗 → disabled`);
                } else {
                    patch.status       = 'benched';
                    patch.failureStreak = newStreak;
                    patch.notes        = `benchmark failed (1x): ${failed.join(', ')} [benched ${date}]`;
                    this._log(`  ⬇️  ${key} 首次失敗 → benched（下次再失敗才 disabled）`);
                }
            }

            if (!allSkipped) providerRegistry.updateModelStatus(provider, model, patch);
        }
        this._log(`\n📝 Registry 已更新（${order.length} 個 model）`);

        // Roster 修剪：每個 provider 保留最優代表
        this._log('\n🏆 執行 Roster 修剪...');
        rosterManager.pruneToRoster();
        this._log('✅ Roster 修剪完成');

        // Pool 健康評估：修剪後檢查 active pool 是否充足
        this._log('\n🏥 評估 active pool 健康度...');
        const poolHealth = poolHealthChecker.checkPoolHealth();
        if (poolHealth.healthy) {
            this._log(`✅ Pool 健康：${poolHealth.activeTotal} active，${poolHealth.tristreamCount} tristream`);
        } else {
            this._log(`${poolHealth.level === 'critical' ? '🚨' : '⚠️'} Pool ${poolHealth.level.toUpperCase()}：${poolHealth.issues.join('；')}`);
            if (poolHealth.revivals.length) this._log(`🔄 已排入復測：${poolHealth.revivals.join(', ')}`);
        }

        const tristreamCount = order.filter(({ key }) => results[key]['tristream']?.pass).length;
        const summary = `${targets.length} 個 model 測試完成，${tristreamCount} 個支援三流格式。報告：${outPath}`;

        // 組裝結構化結果供 journal / warm memory 使用
        const perModelResults = {};
        const registryDelta = { activated: [], disabled: [], skipped: [] };

        for (const { key, target } of order) {
            const { provider, model } = target;
            const suiteName  = target.suite || 'standard_suite';
            const suiteIds   = SUITES[suiteName];
            const suiteTests = TESTS.filter(t => suiteIds.includes(t.id));
            const passCount  = suiteTests.filter(t => results[key][t.id]?.pass).length;
            const passRate   = Math.round((passCount / suiteTests.length) * 100);
            const totalMs    = suiteTests.reduce((s, t) => s + (results[key][t.id]?.ms || 0), 0);
            const avgLatency = Math.round(totalMs / suiteTests.length);
            const allSkipped = suiteTests.every(t => results[key][t.id]?.skip);
            const tristream  = results[key]['tristream']?.pass ?? false;

            perModelResults[key] = { passRate, tristream, avgLatency };

            if (allSkipped) {
                registryDelta.skipped.push(key);
            } else if (passRate >= 75) {
                registryDelta.activated.push(key);
            } else {
                const failed = suiteTests
                    .filter(t => !results[key][t.id]?.pass && !results[key][t.id]?.skip)
                    .map(t => t.name);
                registryDelta.disabled.push({ key, reason: failed.join(', ') });
            }
        }

        return { outPath, summary, perModelResults, registryDelta, poolHealth };
    }
}

module.exports = BenchmarkRunner;
