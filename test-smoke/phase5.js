// Phase 5: 子模組介面合約
const assert = require('assert');

module.exports = function phase5(test, s) {
    console.log('\n[Phase 5] 子模組介面合約');
    const proto = (key) => s[key] && s[key].prototype;

    const methodTests = [
        ['DecisionEngine', 'decision',        ['makeDecision', 'callLLM', 'getAvailableActions', 'readSoul', 'loadAutonomyConfig']],
        ['DecisionContext', 'decision-context', ['build']],
        ['Notifier',       'notify',          ['sendToAdmin', 'setQuietMode', 'drainQuietQueue', 'isHardFailed']],
        ['JournalManager', 'journal',         ['append', 'readRecent']],
        ['ReflectAction',  'actions/reflect', ['performSelfReflection']],
        ['ReflectDiag',    'actions/reflect-diag', ['run']],
        ['ReflectPatch',         'actions/reflect-patch',          ['run']],
        ['PatchExecutor',        'actions/reflect-patch-executor', ['autoDeploy', 'sendForReview']],
        ['ExploreAction',       'actions/explore',        ['performGitHubExplore', 'performWebResearch']],
        ['WebResearchAction',   'actions/web-research',   ['performWebResearch']],
        ['GitHubExploreAction', 'actions/github-explore', ['performGitHubExplore']],
        ['DigestAction',   'actions/digest',  ['performDigest', 'performMorningDigest']],
        ['SocialAction',   'actions/social',  ['performSpontaneousChat']],
        ['XPostAction',    'actions/x-post',  ['performXPost']],
        ['ProviderHealth', 'router/health',   ['register', 'isAvailable', 'score', 'onSuccess', 'on429', 'onError', 'getSummary']],
        ['HealthReporter', 'router/health-reporter', ['fetchDeepSeekBalance', 'getDeepSeekBalance', 'getSummary']],
        ['ModelSelector',  'router/selector', ['select']],
        ['ProviderAdapter','router/adapters/base', ['complete', 'isAvailable']],
        // openai-http 是純函式模組，單獨驗證（見下方）
        ['ExperienceMemoryLayer', 'memory/index', ['recall', 'addReflection']],
        ['DashboardLog',          'dashboard-log',     ['setupOverride']],
        ['DashboardMonitor',      'dashboard-monitor', ['startMonitoring']],
        ['DecisionUtils',         'decision-utils',    ['loadAutonomyConfig', 'readSoul', 'getTimeContext', 'extractCodeSection', 'saveReflection']],
        ['ActionFilter',          'action-filter',     ['getAvailableActions']],
        ['HealthCheckAction',     'actions/health-check', ['run']],
        ['DriveSyncAction',       'actions/drive-sync',   ['run']],
        ['ReactLoop',       'react-loop',       ['run', 'writeJournal']],
        ['DeployActions',   'deploy-actions',   ['runSmokeGate', 'deploy', 'drop', 'listPatches']],
        ['GoogleCommands',  'google-commands',  ['gmail', 'calendar', 'tasks', 'drive']],
        ['MessageHandler',      'message-handler',          ['handleMessage']],
        ['MessageProcessor',    'message-processor',        ['process']],
        ['CallbackHandler',     'callback-handler',         ['handle']],
        ['MoltbookClient',      'moltbook-client',          ['get', 'post', 'patch']],
        ['ContextPressure',     'context-pressure',          ['evaluate', '_classifyFailure', '_classifyStreak']],
        ['FreeWillRunner',      'free-will',                 ['run']],
        ['MoltbookCheckAction',    'actions/moltbook-check',          ['run', '_wrapExternal', '_askLLMForPlan', '_saveInteractionToReflection']],
        ['MoltbookCheckExecutor',  'actions/moltbook-check-executor', ['execute']],
        ['MoltbookPostAction',     'actions/moltbook-post',           ['run', '_generatePost', '_saveToReflection']],
        ['PersonaManager',      'persona-manager',          ['get', 'save', 'setName', 'setRole']],
        ['SkillLoader',         'skill-loader',             ['loadSkill', 'getAutoLoadSkills', 'matchByKeywords', 'listSkills', 'reload']],
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
    test('ActionRunner.prototype.performGoogleCheck', () => {
        assert(typeof proto('actions/index').performGoogleCheck === 'function',
            'ActionRunner.prototype.performGoogleCheck not found');
    });
    test('ActionRunner.prototype.performDriveSync', () => {
        assert(typeof proto('actions/index').performDriveSync === 'function',
            'ActionRunner.prototype.performDriveSync not found');
    });
    test('ActionRunner.prototype.performXPost', () => {
        assert(typeof proto('actions/index').performXPost === 'function',
            'ActionRunner.prototype.performXPost not found');
    });
    test('MoltbookCheckAction memoryLayer alias（memory key 正確接入）', () => {
        const MoltbookCheckAction = require('../src/autonomy/actions/moltbook-check');
        const stub = { recall: () => ({ hot: '', warm: '', cold: '' }) };
        const inst = new MoltbookCheckAction({ memory: stub });
        assert(inst.memoryLayer === stub, 'memoryLayer 應透過 memory alias 注入');
    });
    test('MoltbookPostAction memoryLayer alias（memory key 正確接入）', () => {
        const MoltbookPostAction = require('../src/autonomy/actions/moltbook-post');
        const stub = { recall: () => ({ hot: '', warm: '', cold: '' }) };
        const inst = new MoltbookPostAction({ memory: stub });
        assert(inst.memoryLayer === stub, 'memoryLayer 應透過 memory alias 注入');
    });

    test('moltbook-engagement checkPostEngagement 是 async function', () => {
        const { checkPostEngagement } = require('../src/autonomy/actions/moltbook-engagement');
        assert(typeof checkPostEngagement === 'function');
        // async function 的 return value 是 Promise（instance of Function）
        assert(checkPostEngagement.constructor.name === 'AsyncFunction');
    });
    test('moltbook-state.loadState 回傳含 postStats 欄位', () => {
        const { loadState, saveState, appendCapped } = require('../src/autonomy/actions/moltbook-state');
        assert(typeof loadState === 'function', 'loadState 應是 function');
        assert(typeof saveState === 'function', 'saveState 應是 function');
        assert(typeof appendCapped === 'function', 'appendCapped 應是 function');
        const state = loadState();
        assert('postStats' in state, 'postStats 欄位應在 loadState 預設值中');
        assert(typeof state.postStats === 'object');
    });
    test('HealthCheckAction._shouldTriggerReflection 無異常回傳 null', () => {
        const HealthCheckAction = require('../src/autonomy/actions/health-check');
        const inst = new HealthCheckAction({ journal: null, notifier: null, decision: null });
        const data = {
            journal: { verificationFailed: 0, errors: [], byOutcome: {} },
            log: { errors: [] },
            reflections: { patches: { stale: 0 } },
        };
        assert(inst._shouldTriggerReflection(data) === null, '無異常應回傳 null');
    });
    test('HealthCheckAction._shouldTriggerReflection 有異常回傳 { reason, failedActions, errorType }', () => {
        const HealthCheckAction = require('../src/autonomy/actions/health-check');
        const inst = new HealthCheckAction({ journal: null, notifier: null, decision: null });
        const data = {
            journal: { verificationFailed: 2, errors: [], byOutcome: { 'github_explore/verification_failed': 2 } },
            log: { errors: [] },
            reflections: { patches: { stale: 0 } },
        };
        const r = inst._shouldTriggerReflection(data);
        assert(r !== null, '有異常不應回傳 null');
        assert(typeof r.reason === 'string', 'r.reason 應為字串');
        assert(Array.isArray(r.failedActions), 'r.failedActions 應為陣列');
        assert(typeof r.errorType === 'string', 'r.errorType 應為字串');
        assert(r.errorType === 'config', 'verification_failed 應分類為 config');
    });
    test('openai-http.doRequest 是 function', () => {
        const { doRequest } = require('../src/model-router/adapters/openai-http');
        assert(typeof doRequest === 'function', 'doRequest 應是 function');
    });
    test('gemini-generate.doGenerate 是 async function', () => {
        const { doGenerate } = require('../src/model-router/adapters/gemini-generate');
        assert(typeof doGenerate === 'function', 'doGenerate 應是 function');
        assert(doGenerate.constructor.name === 'AsyncFunction', 'doGenerate 應是 async function');
    });
    test('router-execute.execute 是 async function', () => {
        const { execute } = require('../src/model-router/router-execute');
        assert(typeof execute === 'function', 'execute 應是 function');
        assert(execute.constructor.name === 'AsyncFunction', 'execute 應是 async function');
    });
    test('dashboard-renderer exports { createWidgets, setupScreenKeys, startStdinListener, stopStdinListener }', () => {
        const r = require('../src/dashboard-renderer');
        assert(typeof r.createWidgets === 'function', 'createWidgets 應是 function');
        assert(typeof r.setupScreenKeys === 'function', 'setupScreenKeys 應是 function');
        assert(typeof r.startStdinListener === 'function', 'startStdinListener 應是 function');
        assert(typeof r.stopStdinListener === 'function', 'stopStdinListener 應是 function');
    });
    test('GCPAuth interface', () => {
        const GCPAuth = require('../src/gcp-auth');
        const auth = new GCPAuth();
        assert(typeof auth.ensureAuthenticated === 'function');
        assert(typeof auth.getClient === 'function');
        assert(typeof auth.isAuthenticated === 'function');
        assert(typeof auth.startLoopbackFlow === 'function');
    });
    test('prompts/self-reflection-diag.md 存在且含必要 {{VAR}} 佔位符', () => {
        const fs = require('fs');
        const path = require('path');
        const fp = path.join(process.cwd(), 'prompts', 'self-reflection-diag.md');
        assert(fs.existsSync(fp), 'self-reflection-diag.md 不存在');
        const content = fs.readFileSync(fp, 'utf-8');
        for (const v of ['{{SOUL}}', '{{TRIGGER_SECTION}}', '{{JOURNAL_CONTEXT}}',
                         '{{RECENT_REFLECTIONS}}', '{{GIT_LOG}}', '{{FILE_LIST}}',
                         '{{ADVICE}}', '{{COLD_INSIGHTS}}', '{{WARM_INSIGHTS}}']) {
            assert(content.includes(v), `缺少佔位符 ${v}`);
        }
        assert(content.includes('capability_gap'), 'schema 缺少 capability_gap 欄位');
    });
    test('GoogleServices interface', () => {
        const GoogleServices = require('../src/google-services');
        const GCPAuth = require('../src/gcp-auth');
        const svc = new GoogleServices(new GCPAuth());
        assert(typeof svc.listUnread === 'function');
        assert(typeof svc.listTasks === 'function');
        assert(typeof svc.createTask === 'function');
        assert(typeof svc.listEvents === 'function');
        assert(typeof svc.findFile === 'function');
        assert(typeof svc.uploadFile === 'function');
        assert(typeof svc.updateFile === 'function');
    });
    test('prompts/self-reflection-patch.md 存在且含必要 {{VAR}} 佔位符', () => {
        const fs = require('fs');
        const path = require('path');
        const fp = path.join(process.cwd(), 'prompts', 'self-reflection-patch.md');
        assert(fs.existsSync(fp), 'self-reflection-patch.md 不存在');
        const content = fs.readFileSync(fp, 'utf-8');
        for (const v of ['{{EVOLUTION_SKILL}}', '{{DIAGNOSIS}}', '{{APPROACH}}',
                         '{{TARGET_FILE}}', '{{CODE_SNIPPET}}', '{{JOURNAL_CONTEXT}}']) {
            assert(content.includes(v), `缺少佔位符 ${v}`);
        }
    });
};
