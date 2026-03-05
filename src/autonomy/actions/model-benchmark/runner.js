'use strict';
/**
 * @module model-benchmark/runner
 * @role Benchmark orchestration — 可被 ModelBenchmarkAction 或外部直接呼叫
 *
 * 輸出：memory/model-benchmark-YYYY-MM-DD.md
 */

const fs   = require('fs');
const path = require('path');

const { buildTargets }              = require('./targets');
const { TESTS, MAX_SCORE }          = require('./tests');
const { callGemini, callOpenAICompat } = require('./callers');
const providerRegistry              = require('../../../model-router/provider-registry');

// 專案根目錄（model-benchmark/ 往上四層）
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..');

/**
 * 載入 system prompt（system-core + tristream-protocol 合併）。
 * @returns {string}
 */
function loadSystemPrompt() {
    const promptDir = path.join(PROJECT_ROOT, 'prompts');
    const systemCore = fs.readFileSync(path.join(promptDir, 'system-core.md'), 'utf-8')
        .replace('{{SOUL}}', '你是 Golem，一個運行在本地機器上的自主 AI Agent。')
        .replace('{{PERSONA}}', '')
        .replace('{{VERSION}}', '9.13.x')
        .replace('{{ENV_INFO}}', 'ThinkPad X200, Arch Linux, Node.js v22');
    const tristream = fs.readFileSync(path.join(promptDir, 'tristream-protocol.md'), 'utf-8');
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
        return { ok: false, ms: Date.now() - start, pass: false, detail: `❌ ${e.message}`, score: 0, text: '' };
    }
}

/**
 * interleaveByProvider：重排 order 使同 provider 的 model 之間插入其他 provider
 * 例：[gemini/flash, gemini/lite, groq/llama, groq/kimi]
 *  → [gemini/flash, groq/llama, gemini/lite, groq/kimi]
 */
function interleaveByProvider(items) {
    const byProvider = {};
    for (const item of items) {
        const p = item.target.provider;
        if (!byProvider[p]) byProvider[p] = [];
        byProvider[p].push(item);
    }
    const providers = Object.keys(byProvider);
    const result = [];
    const maxLen = Math.max(...providers.map(p => byProvider[p].length));
    for (let i = 0; i < maxLen; i++) {
        for (const p of providers) {
            if (byProvider[p][i]) result.push(byProvider[p][i]);
        }
    }
    return result;
}

/**
 * 產生 Markdown 報告字串。
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

    for (const { key } of order) {
        const row = [key];
        let totalScore = 0;
        let totalMs    = 0;
        let testCount  = 0;

        for (const test of TESTS) {
            const r = results[key][test.id];
            if (!r.ok) {
                row.push('💥 err');
            } else {
                row.push(r.pass ? '✅' : '❌');
                totalScore += r.pass ? 1 : 0;  // pass/fail 各 1 分
                totalMs    += r.ms;
                testCount++;
            }
        }

        row.push(`${totalScore}/${MAX_SCORE}`);
        row.push(testCount > 0 ? `${Math.round(totalMs / testCount)}ms` : '-');
        lines.push(`| ${row.join(' | ')} |`);
    }

    // 詳細結果
    lines.push('\n## 詳細結果\n');
    for (const { key } of order) {
        lines.push(`### ${key}\n`);
        for (const test of TESTS) {
            const r = results[key][test.id];
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
            const avg = TESTS.reduce((s, t) => s + (results[key][t.id]?.ms || 0), 0) / TESTS.length;
            return avg < 3000 && results[key]['tristream']?.ok;
        })
        .sort((a, b) => {
            const avgA = TESTS.reduce((s, t) => s + (results[a.key][t.id]?.ms || 0), 0) / TESTS.length;
            const avgB = TESTS.reduce((s, t) => s + (results[b.key][t.id]?.ms || 0), 0) / TESTS.length;
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

        this._log(`\n🔬 Model Benchmark — ${targets.length} targets × ${TESTS.length} tests\n`);

        const results = {};
        const order   = [];

        // 先初始化 results / order（保持原本順序顯示）
        for (const target of targets) {
            const key = `${target.provider}/${target.model}`;
            results[key] = {};
            order.push({ key, target });
        }

        // interleaveByProvider：同 provider 的 model 之間插入其他 provider
        const interleaved = interleaveByProvider(order);

        // 外層 test，內層 interleaved target
        for (const test of TESTS) {
            this._log(`\n📋 ${test.name}\n`);
            for (let i = 0; i < interleaved.length; i++) {
                const { key, target } = interleaved[i];
                this._log(`  ${key.padEnd(50)} ...`);
                const r = await runTest(target, test, systemPrompt);
                results[key][test.id] = r;
                this._log(r.pass ? `  ✅ ${r.ms}ms — ${r.detail}` : `  ❌ ${r.ms}ms — ${r.detail}`);

                // 同 provider 間隔 5s，跨 provider 間隔 1s
                const next = interleaved[i + 1];
                if (next) {
                    const delayMs = next.target.provider === target.provider ? 5000 : 1000;
                    await new Promise(res => setTimeout(res, delayMs));
                }
            }
        }

        const report  = generateReport(order, results);
        const date    = new Date().toISOString().split('T')[0];
        const memDir  = path.join(PROJECT_ROOT, 'memory');
        const outPath = path.join(memDir, `model-benchmark-${date}.md`);

        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(outPath, report);

        // 寫入 provider-registry：benchmark 通過率 ≥ 75% → active，否則 disabled
        for (const { key, target } of order) {
            const { provider, model } = target;
            const passCount  = TESTS.filter(t => results[key][t.id]?.pass).length;
            const passRate   = passCount / TESTS.length;
            const totalMs    = TESTS.reduce((s, t) => s + (results[key][t.id]?.ms || 0), 0);
            const avgLatency = Math.round(totalMs / TESTS.length);
            const patch = {
                benchmarkScore: passCount,
                benchmarkMax:   TESTS.length,
                benchmarkDate:  date,
                avgLatencyMs:   avgLatency,
            };
            if (passRate >= 0.75) {
                const capabilities = [];
                if (results[key]['tristream']?.pass) capabilities.push('tristream');
                patch.status       = 'active';
                patch.capabilities = capabilities;
                patch.notes        = '';
            } else {
                const failed = TESTS.filter(t => !results[key][t.id]?.pass).map(t => t.name);
                patch.status = 'disabled';
                patch.notes  = `benchmark failed: ${failed.join(', ')}`;
            }
            providerRegistry.updateModelStatus(provider, model, patch);
        }
        this._log(`\n📝 Registry 已更新（${order.length} 個 model）`);

        const tristreamCount = order.filter(({ key }) => results[key]['tristream']?.pass).length;
        const summary = `${targets.length} 個 model 測試完成，${tristreamCount} 個支援三流格式。報告：${outPath}`;

        return { outPath, summary };
    }
}

module.exports = BenchmarkRunner;
