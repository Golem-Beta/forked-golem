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
        ['MessageHandler',  'message-handler',  ['handleMessage']],
        ['CallbackHandler', 'callback-handler', ['handle']],
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
