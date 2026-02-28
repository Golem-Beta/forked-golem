// Phase 5: 子模組介面合約
const assert = require('assert');

module.exports = function phase5(test, s) {
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
        ['XPostAction',    'actions/x-post',  ['performXPost']],
        ['ProviderHealth', 'router/health',   ['register', 'isAvailable', 'score', 'onSuccess', 'on429', 'onError', 'getSummary']],
        ['ModelSelector',  'router/selector', ['select']],
        ['ProviderAdapter','router/adapters/base', ['complete', 'isAvailable']],
        ['ExperienceMemoryLayer', 'memory/index', ['recall', 'addReflection']],
        ['DashboardLog',          'dashboard-log',     ['setupOverride']],
        ['DashboardMonitor',      'dashboard-monitor', ['startMonitoring']],
        ['DecisionUtils',         'decision-utils',    ['getAvailableActions']],
        ['HealthCheckAction',     'actions/health-check', ['run']],
        ['DriveSyncAction',       'actions/drive-sync',   ['run']],
        ['ReactLoop',       'react-loop',       ['run', 'writeJournal']],
        ['DeployActions',   'deploy-actions',   ['runSmokeGate', 'deploy', 'drop', 'listPatches']],
        ['GoogleCommands',  'google-commands',  ['gmail', 'calendar', 'tasks', 'drive']],
        ['MessageHandler',      'message-handler',          ['handleMessage']],
        ['CallbackHandler',     'callback-handler',         ['handle']],
        ['MoltbookClient',      'moltbook-client',          ['get', 'post', 'patch']],
        ['ContextPressure',     'context-pressure',          ['evaluate', '_classifyFailure', '_classifyStreak']],
        ['MoltbookCheckAction', 'actions/moltbook-check',   ['run', '_wrapExternal', '_askLLMForPlan', '_executePlan']],
        ['MoltbookPostAction',  'actions/moltbook-post',    ['run', '_generatePost', '_saveToReflection', '_loadState', '_saveState']],
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
    test('MoltbookCheckAction._loadState 回傳含 postStats 欄位', () => {
        const MoltbookCheckAction = require('../src/autonomy/actions/moltbook-check');
        const inst = new MoltbookCheckAction({ journal: { readRecent: () => [] }, notifier: null, decision: null, brain: null });
        const state = inst._loadState();
        assert('postStats' in state, 'postStats 欄位應在 _loadState 預設值中');
        assert(typeof state.postStats === 'object');
    });
    test('GCPAuth interface', () => {
        const GCPAuth = require('../src/gcp-auth');
        const auth = new GCPAuth();
        assert(typeof auth.ensureAuthenticated === 'function');
        assert(typeof auth.getClient === 'function');
        assert(typeof auth.isAuthenticated === 'function');
        assert(typeof auth.startLoopbackFlow === 'function');
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
};
