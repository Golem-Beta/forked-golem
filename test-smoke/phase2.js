// Phase 2: export 合約驗證
const assert = require('assert');

module.exports = function phase2(test, m) {
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
};
