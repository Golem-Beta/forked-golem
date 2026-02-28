// Phase 1: require 可達性
const assert = require('assert');

module.exports = function phase1(test) {
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
            m[name] = require(`../src/${name}`);
            assert(m[name] !== undefined);
        });
    }
    test('require src/dashboard', () => {
        m['dashboard'] = require('../src/dashboard');
        assert(typeof m['dashboard'] === 'function');
    });
    return m;
};
