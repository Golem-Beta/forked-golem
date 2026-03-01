// Phase 4: 子模組 require 可達性
const assert = require('assert');

module.exports = function phase4(test) {
    console.log('\n[Phase 4] 子模組 require 可達性');
    const s = {};

    // 從 codebase 索引動態生成 autonomy 子模組清單（有 class 的才列入「is a class」驗證）
    let codebaseIndex;
    try {
        const CodebaseIndexer = require('../src/codebase-indexer');
        try {
            codebaseIndex = CodebaseIndexer.load();
        } catch (e) {
            codebaseIndex = CodebaseIndexer.rebuild();
        }
    } catch (e) {
        throw new Error(`Codebase 索引不可用，無法執行動態測試: ${e.message}`);
    }

    const autonomySubmodules = Object.entries(codebaseIndex.symbols.files)
        .filter(([f, info]) => {
            if (!f.startsWith('src/autonomy/') || info.classes.length === 0) return false;
            const exp = codebaseIndex.symbols.moduleExports[f];
            return exp && exp.type === 'default'; // module.exports = ClassName 才列入 is-a-class 驗證
        })
        .map(([f]) => [
            f.replace(/^src\/autonomy\//, '').replace(/\.js$/, ''),
            f.replace(/\.js$/, ''),
        ])
        .sort((a, b) => a[0].localeCompare(b[0]));
    // moltbook-engagement 是純函式模組（非 class），單獨驗證
    test('actions/moltbook-engagement exports checkPostEngagement', () => {
        s['actions/moltbook-engagement'] = require('../src/autonomy/actions/moltbook-engagement');
        assert(typeof s['actions/moltbook-engagement'] === 'object');
        assert(typeof s['actions/moltbook-engagement'].checkPostEngagement === 'function');
    });
    // failure-classifier 是純函式模組（非 class），單獨驗證
    test('failure-classifier exports { isFailed, classifyFailure, classifyStreak, checkFailurePatterns }', () => {
        s['failure-classifier'] = require('../src/autonomy/failure-classifier');
        assert(typeof s['failure-classifier'] === 'object');
        assert(typeof s['failure-classifier'].isFailed === 'function');
        assert(typeof s['failure-classifier'].classifyFailure === 'function');
        assert(typeof s['failure-classifier'].classifyStreak === 'function');
        assert(typeof s['failure-classifier'].checkFailurePatterns === 'function');
    });
    // google-classifier 是純函式模組（非 class），單獨驗證
    test('actions/google-classifier exports { classifyByRules, classifyByLLM }', () => {
        s['actions/google-classifier'] = require('../src/autonomy/actions/google-classifier');
        assert(typeof s['actions/google-classifier'] === 'object');
        assert(typeof s['actions/google-classifier'].classifyByRules === 'function');
        assert(typeof s['actions/google-classifier'].classifyByLLM === 'function');
    });
    for (const [key, modPath] of autonomySubmodules) {
        test(`autonomy/${key} is a class`, () => {
            s[key] = require(`../${modPath}`);
            assert(typeof s[key] === 'function', `expected function, got ${typeof s[key]}`);
        });
    }

    const routerSubmodules = [
        ['router/health',                'src/model-router/health'],
        ['router/health-reporter',       'src/model-router/health-reporter'],
        ['router/configs',               'src/model-router/configs'],
        ['router/intents',               'src/model-router/intents'],
        ['router/adapters/base',         'src/model-router/adapters/base'],
        ['router/adapters/openai-compat','src/model-router/adapters/openai-compat'],
        ['router/adapters/openai-http',    'src/model-router/adapters/openai-http'],
        ['router/adapters/gemini',         'src/model-router/adapters/gemini'],
        ['router/adapters/gemini-generate','src/model-router/adapters/gemini-generate'],
        ['router/selector',              'src/model-router/selector'],
        ['router/router-execute',        'src/model-router/router-execute'],
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
    test('memory/cold-index is a class', () => {
        s['memory/cold-index'] = require('../src/memory/cold-index');
        assert(typeof s['memory/cold-index'] === 'function');
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
        ['codebase-indexer',    'src/codebase-indexer'],
        ['react-loop',          'src/react-loop'],
        ['deploy-actions',      'src/deploy-actions'],
        ['google-commands',     'src/google-commands'],
        ['message-handler',     'src/message-handler'],
        ['message-processor',   'src/message-processor'],
        ['callback-handler',    'src/callback-handler'],
        ['persona-manager',     'src/persona-manager'],
        ['skill-loader',        'src/skill-loader'],
        ['google-gmail',        'src/google-gmail'],
        ['google-drive',        'src/google-drive'],
        ['virtual-cmd-handler', 'src/virtual-cmd-handler'],
        ['optic-nerve',         'src/optic-nerve'],
        ['message-manager',     'src/message-manager'],
    ];
    for (const [key, modPath] of coreModules) {
        test(`${key} is a class`, () => {
            s[key] = require(`../${modPath}`);
            assert(typeof s[key] === 'function', `expected function, got ${typeof s[key]}`);
        });
    }

    return s;
};
