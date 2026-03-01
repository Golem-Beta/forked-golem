/**
 * 🪞 Introspection + 🩹 PatchManager + ☁️ SystemUpgrader
 * 依賴：fs, path, child_process (Node built-in), CONFIG
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const CONFIG = require('./config');

class Introspection {
    static readSelf() {
        try {
            // 讀取 index.js（主入口）
            let main = fs.readFileSync(path.join(process.cwd(), 'index.js'), 'utf-8');
            main = main.replace(/TOKEN: .*,/, 'TOKEN: "HIDDEN",').replace(/API_KEYS: .*,/, 'API_KEYS: "HIDDEN",');
            let skills = "";
            try { skills = fs.readFileSync(path.join(process.cwd(), 'src', 'skills.js'), 'utf-8'); } catch (e) { }
            return `=== index.js ===\n${main}\n\n=== skills.js ===\n${skills}`;
        } catch (e) { return `無法讀取自身代碼: ${e.message}`; }
    }
}

class PatchManager {
    /**
     * AST-aware 頂層節點定位（格式 A 專用）
     * 支援：FunctionDeclaration、VariableDeclaration（含箭頭函數）、ExpressionStatement（如 Foo.bar = ...）
     * @param {string} code - 原始 JS 程式碼
     * @param {string} targetName - 節點名稱（如 "myFunc"、"Foo.bar"）
     * @returns {{ start: number, end: number }}
     * @throws {Error} 找不到、不唯一、或 AST 解析失敗
     */
    static _locateNode(code, targetName) {
        let acorn;
        try { acorn = require('acorn'); } catch (e) { throw new Error('acorn 模組不可用，請執行 npm install acorn'); }
        let ast;
        try { ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' }); } catch (e) { throw new Error(`AST 解析失敗: ${e.message}`); }
        const isDotted = targetName.includes('.');
        const matches = [];
        for (const node of ast.body) {
            let hit = false;
            if (node.type === 'FunctionDeclaration' && node.id) {
                hit = !isDotted && node.id.name === targetName;
            } else if (node.type === 'VariableDeclaration') {
                const decl = node.declarations[0];
                hit = !isDotted && !!(decl && decl.id.type === 'Identifier' && decl.id.name === targetName);
            } else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression') {
                const left = node.expression.left;
                if (left.type === 'Identifier') {
                    hit = !isDotted && left.name === targetName;
                } else if (left.type === 'MemberExpression' && !left.computed) {
                    // 建立完整點路徑，如 "Foo.bar"
                    const parts = [];
                    let cur = left;
                    while (cur.type === 'MemberExpression') { parts.unshift(cur.property.name); cur = cur.object; }
                    if (cur.type === 'Identifier') parts.unshift(cur.name);
                    const fullPath = parts.join('.');
                    // isDotted → 全路徑精確比對；非 dotted → 比對最後一個識別符
                    hit = isDotted ? fullPath === targetName : parts[parts.length - 1] === targetName;
                }
            }
            if (hit) matches.push(node);
        }
        if (matches.length === 0) throw new Error(`target_node "${targetName}" 不存在（頂層節點中找不到）`);
        if (matches.length > 1) throw new Error(`target_node "${targetName}" 不唯一（找到 ${matches.length} 個同名頂層節點）`);
        return { start: matches[0].start, end: matches[0].end };
    }

    static apply(originalCode, patch) {
        // 格式 A：AST 節點整體替換（優先）
        if (patch.target_node !== undefined) {
            if (typeof patch.target_node !== 'string' || !patch.target_node) throw new Error('❌ target_node 必須是非空字串');
            if (typeof patch.replace !== 'string') throw new Error('❌ replace 欄位必須是字串');
            const { start, end } = PatchManager._locateNode(originalCode, patch.target_node);
            // 保護區位置重疊檢查
            const protectedPattern = /\/\/ =+ \[KERNEL PROTECTED START\] =+([\s\S]*?)\/\/ =+ \[KERNEL PROTECTED END\] =+/g;
            let protMatch;
            while ((protMatch = protectedPattern.exec(originalCode)) !== null) {
                const pStart = protMatch.index;
                const pEnd = protMatch.index + protMatch[0].length;
                if (start < pEnd && end > pStart) throw new Error(`⛔ 權限拒絕：試圖修改系統核心禁區。`);
            }
            return originalCode.slice(0, start) + patch.replace + originalCode.slice(end);
        }
        // 格式 B：字串精確替換（向後相容 fallback）
        if (patch.search !== undefined) {
            const protectedPattern = /\/\/ =+ \[KERNEL PROTECTED START\] =+([\s\S]*?)\/\/ =+ \[KERNEL PROTECTED END\] =+/g;
            let match;
            while ((match = protectedPattern.exec(originalCode)) !== null) {
                if (match[1].includes(patch.search)) throw new Error(`⛔ 權限拒絕：試圖修改系統核心禁區。`);
            }
            if (!originalCode.includes(patch.search)) {
                throw new Error(`❌ 精確匹配失敗：找不到目標代碼段落 (長度:${patch.search.length})。請確認 patch 內容與原始碼完全一致。`);
            }
            const firstIdx = originalCode.indexOf(patch.search);
            const secondIdx = originalCode.indexOf(patch.search, firstIdx + 1);
            if (secondIdx !== -1) throw new Error(`❌ 匹配不唯一：目標段落出現多次，無法安全替換。`);
            return originalCode.replace(patch.search, patch.replace);
        }
        throw new Error('❌ patch 格式錯誤：缺少 target_node 或 search 欄位');
    }

    static createTestClone(originalPath, patchContent) {
        try {
            const originalCode = fs.readFileSync(originalPath, 'utf-8');
            let patchedCode = originalCode;
            const patches = Array.isArray(patchContent) ? patchContent : [patchContent];
            patches.forEach(p => { patchedCode = PatchManager.apply(patchedCode, p); });
            if (patchedCode === originalCode) throw new Error('patch 未產生任何變更');
            const ext = path.extname(originalPath);
            const name = path.basename(originalPath, ext);
            const dir = path.dirname(originalPath); // 修正：寫到原始檔所在目錄
            const testFile = path.join(dir, `${name}.test${ext}`);
            fs.writeFileSync(testFile, patchedCode, 'utf-8');
            return testFile;
        } catch (e) { throw new Error(`補丁應用失敗: ${e.message}`); }
    }
    static verify(filePath) {
        try {
            execSync(`node -c "${filePath}"`);
            execSync(`node "${path.join(process.cwd(), 'test-smoke.js')}"`, { timeout: 15000, stdio: 'pipe' });
            if (filePath.includes('index.test.js')) {
                execSync(`node "${filePath}"`, { env: { ...process.env, GOLEM_TEST_MODE: 'true' }, timeout: 5000, stdio: 'pipe' });
            }
            // OCR 靜態檢查：任何 patch 若呼叫 sendToAdmin/sendNotification 必須接回傳值
            const content = fs.readFileSync(filePath, 'utf-8');
            const sendCalls = content.match(/await this\.notifier\.(sendToAdmin|sendNotification)\(/g) || [];
            const capturedCalls = content.match(/(?:const|let|var)\s+\w+\s*=\s*await this\.notifier\.(sendToAdmin|sendNotification)\(/g) || [];
            if (sendCalls.length > capturedCalls.length) {
                const uncaptured = sendCalls.length - capturedCalls.length;
                const errMsg = `OCR 違規：${uncaptured} 個 sendToAdmin/sendNotification 呼叫未接回傳值`;
                console.error(`❌ [PatchManager] ${errMsg}`);
                try { fs.unlinkSync(filePath); } catch (_) {}
                return { ok: false, error: errMsg };
            }
            console.log(`✅ [PatchManager] ${filePath} 驗證通過`);
            return { ok: true };
        } catch (e) {
            console.error(`❌ [PatchManager] 驗證失敗: ${e.message}`);
            try { fs.unlinkSync(filePath); console.log(`🗑️ [PatchManager] 已清理: ${filePath}`); } catch (_) {}
            return { ok: false, error: e.message };
        }
    }
}

class SystemUpgrader {
    static async performUpdate(ctx) {
        if (!CONFIG.GITHUB_REPO) return ctx.reply("❌ 未設定 GitHub Repo 來源，無法更新。");
        await ctx.reply("☁️ 連線至 GitHub 母體，開始下載最新核心...");
        await ctx.sendTyping();

        const filesToUpdate = ['index.js', 'skills.js'];
        const downloadedFiles = [];
        try {
            for (const file of filesToUpdate) {
                const url = `${CONFIG.GITHUB_REPO}${file}?t=${Date.now()}`;
                const tempPath = path.join(process.cwd(), `${file}.new`);
                console.log(`📥 Downloading ${file} from ${url}...`);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`無法下載 ${file} (Status: ${response.status})`);
                const code = await response.text();
                fs.writeFileSync(tempPath, code);
                downloadedFiles.push({ file, tempPath });
            }

            await ctx.reply("🛡️ 下載完成，正在進行語法完整性掃描...");
            for (const item of downloadedFiles) {
                const verifyResult = PatchManager.verify(item.tempPath);
                if (!verifyResult.ok) throw new Error(`檔案 ${item.file} 驗證失敗，更新已終止以保護系統。`);
            }

            await ctx.reply("✅ 驗證通過。正在寫入系統...");
            for (const item of downloadedFiles) {
                const targetPath = path.join(process.cwd(), item.file);
                if (fs.existsSync(targetPath)) fs.copyFileSync(targetPath, `${targetPath}.bak`);
                fs.renameSync(item.tempPath, targetPath);
            }

            await ctx.reply("🚀 系統更新成功！Golem 正在重啟以套用新靈魂...");
            const subprocess = spawn(process.argv[0], process.argv.slice(1), {
                detached: true, stdio: 'ignore', cwd: process.cwd()
            });
            subprocess.unref();
            process.exit(0);
        } catch (e) {
            console.error(e);
            downloadedFiles.forEach(item => {
                if (fs.existsSync(item.tempPath)) fs.unlinkSync(item.tempPath);
            });
            await ctx.reply(`❌ 更新失敗：${e.message}\n系統已回滾至安全狀態。`);
        }
    }
}

module.exports = { Introspection, PatchManager, SystemUpgrader };
