// Phase 4: 子模組 require 可達性
const assert = require('assert');

module.exports = function phase4(test) {
    console.log('\n[Phase 4] 子模組 require 可達性');
    const s = {};

    const autonomySubmodules = [
        ['decision',               'src/autonomy/decision'],
        ['decision-utils',         'src/autonomy/decision-utils'],
        ['action-filter',          'src/autonomy/action-filter'],
        ['notify',                 'src/autonomy/notify'],
        ['journal',                'src/autonomy/journal'],
        ['pending-patches',        'src/autonomy/pending-patches'],
        ['actions/index',          'src/autonomy/actions/index'],
        ['actions/reflect',        'src/autonomy/actions/reflect'],
        ['actions/reflect-diag',   'src/autonomy/actions/reflect-diag'],
        ['actions/reflect-patch',          'src/autonomy/actions/reflect-patch'],
        ['actions/reflect-patch-executor', 'src/autonomy/actions/reflect-patch-executor'],
        ['actions/explore',        'src/autonomy/actions/explore'],
        ['actions/web-research',   'src/autonomy/actions/web-research'],
        ['actions/github-explore', 'src/autonomy/actions/github-explore'],
        ['actions/digest',         'src/autonomy/actions/digest'],
        ['actions/social',         'src/autonomy/actions/social'],
        ['actions/health-check',   'src/autonomy/actions/health-check'],
        ['actions/drive-sync',       'src/autonomy/actions/drive-sync'],
        ['actions/x-post',           'src/autonomy/actions/x-post'],
        ['actions/moltbook-check',   'src/autonomy/actions/moltbook-check'],
        ['actions/moltbook-post',    'src/autonomy/actions/moltbook-post'],
        ['context-pressure',         'src/autonomy/context-pressure'],
    ];
    // moltbook-engagement 是純函式模組（非 class），單獨驗證
    test('actions/moltbook-engagement exports checkPostEngagement', () => {
        s['actions/moltbook-engagement'] = require('../src/autonomy/actions/moltbook-engagement');
        assert(typeof s['actions/moltbook-engagement'] === 'object');
        assert(typeof s['actions/moltbook-engagement'].checkPostEngagement === 'function');
    });
    for (const [key, modPath] of autonomySubmodules) {
        test(`autonomy/${key} is a class`, () => {
            s[key] = require(`../${modPath}`);
            assert(typeof s[key] === 'function', `expected function, got ${typeof s[key]}`);
        });
    }

    const routerSubmodules = [
        ['router/health',                'src/model-router/health'],
        ['router/configs',               'src/model-router/configs'],
        ['router/intents',               'src/model-router/intents'],
        ['router/adapters/base',         'src/model-router/adapters/base'],
        ['router/adapters/openai-compat','src/model-router/adapters/openai-compat'],
        ['router/adapters/gemini',       'src/model-router/adapters/gemini'],
        ['router/selector',              'src/model-router/selector'],
    ];
    for (const [key, modPath] of routerSubmodules) {
        test(`model-router ${key} loadable`, () => {
            s[key] = require(`../${modPath}`);
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

    test('require src/moltbook-client', () => {
        s['moltbook-client'] = require('../src/moltbook-client');
        assert(typeof s['moltbook-client'] === 'function');
        assert(s['moltbook-client'].name === 'MoltbookClient');
    });

    test('memory/index is a class', () => {
        s['memory/index'] = require('../src/memory/index');
        assert(typeof s['memory/index'] === 'function');
    });
    test('require src/dashboard-log', () => {
        s['dashboard-log'] = require('../src/dashboard-log');
        assert(typeof s['dashboard-log'] === 'function');
    });
    test('require src/dashboard-monitor', () => {
        s['dashboard-monitor'] = require('../src/dashboard-monitor');
        assert(typeof s['dashboard-monitor'] === 'function');
    });
    test('require src/autonomy/actions/health-check', () => {
        const HealthCheckAction = require('../src/autonomy/actions/health-check');
        assert(typeof HealthCheckAction === 'function');
        assert(HealthCheckAction.name === 'HealthCheckAction');
    });
    test('require src/gcp-auth', () => {
        const GCPAuth = require('../src/gcp-auth');
        assert(typeof GCPAuth === 'function');
    });
    test('require src/google-services', () => {
        const GoogleServices = require('../src/google-services');
        assert(typeof GoogleServices === 'function');
    });

    const coreModules = [
        ['react-loop',          'src/react-loop'],
        ['deploy-actions',      'src/deploy-actions'],
        ['google-commands',     'src/google-commands'],
        ['message-handler',     'src/message-handler'],
        ['message-processor',   'src/message-processor'],
        ['callback-handler',    'src/callback-handler'],
    ];
    for (const [key, modPath] of coreModules) {
        test(`${key} is a class`, () => {
            s[key] = require(`../${modPath}`);
            assert(typeof s[key] === 'function', `expected function, got ${typeof s[key]}`);
        });
    }

    return s;
};
