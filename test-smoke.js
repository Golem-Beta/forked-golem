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

const m     = require('./test-smoke/phase1')(test);
              require('./test-smoke/phase2')(test, m);
              require('./test-smoke/phase3')(test, m);
const s     = require('./test-smoke/phase4')(test);
              require('./test-smoke/phase5')(test, s);
const warns = require('./test-smoke/phase6')(test);

console.log(`\n🔬 結果: ${passed} passed, ${failed} failed`);
if (warns.length > 0) {
    console.log('\n⚠️  大小警告（不計入 failed）:');
    for (const w of warns) console.warn(`  ${w}`);
}
process.exit(failed > 0 ? 1 : 0);
