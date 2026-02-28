// Phase 6: 模組大小健康檢查
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function findJsFiles(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...findJsFiles(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) results.push(full);
    }
    return results;
}

const WARN_THRESHOLD = {
    'src/dashboard.js': 350,   // UI 骨架，blessed widget 宣告較多
    _default: 300,
};
const FAIL_THRESHOLD = 400;  // 所有檔案統一硬限制不變

module.exports = function phase6(test) {
    console.log('\n[Phase 6] 模組大小健康檢查');
    const warns = [];
    const jsFiles = findJsFiles(path.join(process.cwd(), 'src'));
    for (const filePath of jsFiles.sort()) {
        const rel = path.relative(process.cwd(), filePath);
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').length;
        const warnLimit = WARN_THRESHOLD[rel] ?? WARN_THRESHOLD._default;
        if (lines > FAIL_THRESHOLD) {
            test(`${rel} 不超過 ${FAIL_THRESHOLD} 行`, () => {
                assert(false, `${rel} 超過 ${FAIL_THRESHOLD} 行（實際: ${lines} 行），必須拆分`);
            });
        } else if (lines > warnLimit) {
            warns.push(`⚠️  ${rel} 警戒區（${lines} 行），建議拆分`);
        }
    }
    return warns;
};
