/**
 * 🔬 Smoke Test — 模組完整性驗證
 * 用途：確認所有模組可 require、export 合約正確、關鍵方法存在
 * 執行：node test-smoke.js（成功 exit 0，失敗 exit 1）
 */
process.env.GOLEM_TEST_MODE = 'true';

const assert = require('assert');
let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch(e) { failed++; console.error(`  ❌ ${name}: ${e.message}`); }
}

console.log('🔬 Smoke Test: 模組完整性驗證\n');

// === Phase 1: require 可達性 ===
console.log('[Phase 1] require 可達性');
const m = {};
const moduleList = [
    'config', 'context', 'message-buffer', 'memory-drivers',
    'security', 'brain', 'parsers', 'executor', 'node-router',
    'chronos', 'upgrader', 'tools', 'prompt-loader',
    'autonomy', 'skills', 'model-router', 'task-controller'
];
for (const name of moduleList) {
    test(`require src/${name}`, () => {
        m[name] = require(`./src/${name}`);
        assert(m[name] !== undefined);
    });
}
test('require src/dashboard', () => {
    m['dashboard'] = require('./src/dashboard');
    assert(typeof m['dashboard'] === 'function');
});

// === Phase 2: export 合約驗證 ===
console.log('\n[Phase 2] export 合約驗證');
test('config exports object with ADMIN_IDS', () => {
    assert(typeof m['config'] === 'object');
    assert(Array.isArray(m['config'].ADMIN_IDS));
});
test('brain exports { GolemBrain }', () => {
    assert(typeof m['brain'].GolemBrain === 'function');
});
test('parsers exports { TriStreamParser, ResponseParser }', () => {
    assert(typeof m['parsers'].TriStreamParser === 'function');
    assert(typeof m['parsers'].ResponseParser === 'function');
});
test('security exports SecurityManager class', () => {
    assert(typeof m['security'] === 'function');
    assert(m['security'].name === 'SecurityManager');
});
test('executor exports Executor class', () => {
    assert(typeof m['executor'] === 'function');
    assert(m['executor'].name === 'Executor');
});
test('task-controller exports TaskController class', () => {
    assert(typeof m['task-controller'] === 'function');
    assert(m['task-controller'].name === 'TaskController');
});
test('context exports { UniversalContext, OpticNerve }', () => {
    assert(typeof m['context'].UniversalContext === 'function');
    assert(typeof m['context'].OpticNerve === 'function');
});
test('memory-drivers exports 3 drivers', () => {
    assert(typeof m['memory-drivers'].ExperienceMemory === 'function');
    assert(typeof m['memory-drivers'].SystemQmdDriver === 'function');
    assert(typeof m['memory-drivers'].SystemNativeDriver === 'function');
});
test('upgrader exports { Introspection, PatchManager, SystemUpgrader }', () => {
    assert(typeof m['upgrader'].SystemUpgrader === 'function');
    assert(typeof m['upgrader'].Introspection === 'function');
    assert(typeof m['upgrader'].PatchManager === 'function');
});
test('tools exports { ToolScanner, HelpManager }', () => {
    assert(typeof m['tools'].ToolScanner === 'function');
    assert(typeof m['tools'].HelpManager === 'function');
});
test('prompt-loader exports { loadPrompt }', () => {
    assert(typeof m['prompt-loader'].loadPrompt === 'function');
});
test('chronos exports ChronosManager class', () => {
    assert(typeof m['chronos'] === 'function');
});
test('autonomy exports AutonomyManager class', () => {
    assert(typeof m['autonomy'] === 'function');
});
test('node-router exports NodeRouter class', () => {
    assert(typeof m['node-router'] === 'function');
});
test('model-router exports ModelRouter class', () => {
    assert(typeof m['model-router'] === 'function');
});
test('skills exports object with skillLoader', () => {
    assert(typeof m['skills'] === 'object');
});

// === Phase 3: 關鍵方法存在 ===
console.log('\n[Phase 3] 介面合約驗證');
const Brain = m['brain'].GolemBrain;
test('GolemBrain.prototype.sendMessage', () => assert(typeof Brain.prototype.sendMessage === 'function'));
test('GolemBrain.prototype.memorize', () => assert(typeof Brain.prototype.memorize === 'function'));
test('SecurityManager.prototype.assess', () => assert(typeof m['security'].prototype.assess === 'function'));
test('Executor.prototype.run', () => assert(typeof m['executor'].prototype.run === 'function'));
test('TaskController.prototype.runSequence', () => assert(typeof m['task-controller'].prototype.runSequence === 'function'));
test('TriStreamParser.parse (static)', () => assert(typeof m['parsers'].TriStreamParser.parse === 'function'));
test('ResponseParser.extractJson (static)', () => assert(typeof m['parsers'].ResponseParser.extractJson === 'function'));
test('PatchManager.verify (static)', () => assert(typeof m['upgrader'].PatchManager.verify === 'function'));
test('PatchManager.createTestClone (static)', () => assert(typeof m['upgrader'].PatchManager.createTestClone === 'function'));

// === Phase 4: 子模組 require 可達性 ===
console.log('\n[Phase 4] 子模組 require 可達性');
const s = {};

const autonomySubmodules = [
    ['decision',               'src/autonomy/decision'],
    ['decision-utils',         'src/autonomy/decision-utils'],
    ['notify',                 'src/autonomy/notify'],
    ['journal',                'src/autonomy/journal'],
    ['pending-patches',        'src/autonomy/pending-patches'],
    ['actions/index',          'src/autonomy/actions/index'],
    ['actions/reflect',        'src/autonomy/actions/reflect'],
    ['actions/reflect-diag',   'src/autonomy/actions/reflect-diag'],
    ['actions/reflect-patch',  'src/autonomy/actions/reflect-patch'],
    ['actions/explore',        'src/autonomy/actions/explore'],
    ['actions/digest',         'src/autonomy/actions/digest'],
    ['actions/social',         'src/autonomy/actions/social'],
    ['actions/health-check',   'src/autonomy/actions/health-check'],
];
for (const [key, modPath] of autonomySubmodules) {
    test(`autonomy/${key} is a class`, () => {
        s[key] = require(`./${modPath}`);
        assert(typeof s[key] === 'function', `expected function, got ${typeof s[key]}`);
    });
}

const routerSubmodules = [
    ['router/health',            'src/model-router/health'],
    ['router/configs',           'src/model-router/configs'],
    ['router/intents',           'src/model-router/intents'],
    ['router/adapters/base',     'src/model-router/adapters/base'],
    ['router/adapters/openai-compat', 'src/model-router/adapters/openai-compat'],
    ['router/adapters/gemini',   'src/model-router/adapters/gemini'],
    ['router/selector',          'src/model-router/selector'],
];
for (const [key, modPath] of routerSubmodules) {
    test(`model-router ${key} loadable`, () => {
        s[key] = require(`./${modPath}`);
        assert(s[key] !== undefined);
    });
}
test('router/health is a class', () => assert(typeof s['router/health'] === 'function'));
test('router/selector is a class', () => assert(typeof s['router/selector'] === 'function'));
test('router/configs has gemini/groq/deepseek keys', () => {
    const cfg = s['router/configs'];
    assert(typeof cfg === 'object');
    assert('gemini' in cfg, 'missing gemini');
    assert('groq' in cfg, 'missing groq');
    assert('deepseek' in cfg, 'missing deepseek');
});
test('router/intents has chat/decision/utility keys', () => {
    const intents = s['router/intents'];
    assert(typeof intents === 'object');
    assert('chat' in intents, 'missing chat');
    assert('decision' in intents, 'missing decision');
    assert('utility' in intents, 'missing utility');
});
test('router/adapters/base is a class', () => assert(typeof s['router/adapters/base'] === 'function'));
test('router/adapters/openai-compat is a class', () => assert(typeof s['router/adapters/openai-compat'] === 'function'));
test('router/adapters/gemini is a class', () => assert(typeof s['router/adapters/gemini'] === 'function'));

test('memory/index is a class', () => {
    s['memory/index'] = require('./src/memory/index');
    assert(typeof s['memory/index'] === 'function');
});
test('require src/dashboard-log', () => {
    s['dashboard-log'] = require('./src/dashboard-log');
    assert(typeof s['dashboard-log'] === 'function');
});
test('require src/dashboard-monitor', () => {
    s['dashboard-monitor'] = require('./src/dashboard-monitor');
    assert(typeof s['dashboard-monitor'] === 'function');
});
test('require src/autonomy/actions/health-check', () => {
    const HealthCheckAction = require('./src/autonomy/actions/health-check');
    assert(typeof HealthCheckAction === 'function');
    assert(HealthCheckAction.name === 'HealthCheckAction');
});

// === Phase 5: 子模組介面合約 ===
console.log('\n[Phase 5] 子模組介面合約');
const proto = (key) => s[key] && s[key].prototype;

const methodTests = [
    ['DecisionEngine', 'decision',        ['makeDecision', 'callLLM', 'getAvailableActions', 'readSoul', 'loadAutonomyConfig']],
    ['Notifier',       'notify',          ['sendToAdmin', 'setQuietMode', 'drainQuietQueue', 'isHardFailed']],
    ['JournalManager', 'journal',         ['append', 'readRecent']],
    ['ReflectAction',  'actions/reflect', ['performSelfReflection']],
    ['ReflectDiag',    'actions/reflect-diag', ['run']],
    ['ReflectPatch',   'actions/reflect-patch', ['run']],
    ['ExploreAction',  'actions/explore', ['performGitHubExplore', 'performWebResearch']],
    ['DigestAction',   'actions/digest',  ['performDigest', 'performMorningDigest']],
    ['SocialAction',   'actions/social',  ['performSpontaneousChat']],
    ['ProviderHealth', 'router/health',   ['register', 'isAvailable', 'score', 'onSuccess', 'on429', 'onError', 'getSummary']],
    ['ModelSelector',  'router/selector', ['select']],
    ['ProviderAdapter','router/adapters/base', ['complete', 'isAvailable']],
    ['ExperienceMemoryLayer', 'memory/index', ['recall', 'addReflection']],
    ['DashboardLog',          'dashboard-log',     ['setupOverride']],
    ['DashboardMonitor',      'dashboard-monitor', ['startMonitoring']],
    ['DecisionUtils',         'decision-utils',    ['getAvailableActions']],
    ['HealthCheckAction',     'actions/health-check', ['run']],
];
for (const [className, key, methods] of methodTests) {
    for (const method of methods) {
        test(`${className}.prototype.${method}`, () => {
            assert(typeof proto(key)[method] === 'function', `${className}.prototype.${method} not found`);
        });
    }
}
test('ActionRunner.prototype.performHealthCheck', () => {
    assert(typeof proto('actions/index').performHealthCheck === 'function',
        'ActionRunner.prototype.performHealthCheck not found');
});

// === Phase 6: 模組大小健康檢查 ===
console.log('\n[Phase 6] 模組大小健康檢查');
const fs2 = require('fs');
const path2 = require('path');
const warns = [];

function findJsFiles(dir) {
    const results = [];
    for (const entry of fs2.readdirSync(dir, { withFileTypes: true })) {
        const full = path2.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...findJsFiles(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) results.push(full);
    }
    return results;
}

const WARN_THRESHOLD = {
    'src/dashboard.js': 350,   // UI 骨架，blessed widget 宣告較多
    _default: 300,
};
const FAIL_THRESHOLD = 400;  // 所有檔案統一硬限制不變

const jsFiles = findJsFiles(path2.join(process.cwd(), 'src'));
for (const filePath of jsFiles.sort()) {
    const rel = path2.relative(process.cwd(), filePath);
    const lines = fs2.readFileSync(filePath, 'utf-8').split('\n').length;
    const warnLimit = WARN_THRESHOLD[rel] ?? WARN_THRESHOLD._default;
    if (lines > FAIL_THRESHOLD) {
        test(`${rel} 不超過 ${FAIL_THRESHOLD} 行`, () => {
            assert(false, `${rel} 超過 ${FAIL_THRESHOLD} 行（實際: ${lines} 行），必須拆分`);
        });
    } else if (lines > warnLimit) {
        warns.push(`⚠️  ${rel} 警戒區（${lines} 行），建議拆分`);
    }
}

// === 結果 ===
console.log(`\n🔬 結果: ${passed} passed, ${failed} failed`);
if (warns.length > 0) {
    console.log('\n⚠️  大小警告（不計入 failed）:');
    for (const w of warns) console.warn(`  ${w}`);
}
process.exit(failed > 0 ? 1 : 0);
