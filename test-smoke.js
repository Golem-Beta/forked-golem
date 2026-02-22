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
test('src/dashboard.js syntax', () => {
    require('child_process').execSync('node -c src/dashboard.js', { cwd: process.cwd(), stdio: 'pipe' });
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

// === 結果 ===
console.log(`\n🔬 結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
