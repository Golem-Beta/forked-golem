// Phase 3: 核心模組介面合約驗證
const assert = require('assert');

module.exports = function phase3(test, m) {
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
};
