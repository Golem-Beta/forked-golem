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
    static apply(originalCode, patch) {
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
        if (secondIdx !== -1) {
            throw new Error(`❌ 匹配不唯一：目標段落出現多次，無法安全替換。`);
        }
        return originalCode.replace(patch.search, patch.replace);
    }
    static createTestClone(originalPath, patchContent) {
        try {
            const originalCode = fs.readFileSync(originalPath, 'utf-8');
            let patchedCode = originalCode;
            const patches = Array.isArray(patchContent) ? patchContent : [patchContent];
            patches.forEach(p => { patchedCode = PatchManager.apply(patchedCode, p); });
            const ext = path.extname(originalPath);
            const name = path.basename(originalPath, ext);
            const testFile = `${name}.test${ext}`;
            fs.writeFileSync(testFile, patchedCode, 'utf-8');
            return testFile;
        } catch (e) { throw new Error(`補丁應用失敗: ${e.message}`); }
    }
    static verify(filePath) {
        try {
            execSync(`node -c "${filePath}"`);
            if (filePath.includes('index.test.js')) {
                execSync(`node "${filePath}"`, { env: { ...process.env, GOLEM_TEST_MODE: 'true' }, timeout: 5000, stdio: 'pipe' });
            }
            // OCR 靜態檢查：任何 patch 若呼叫 sendToAdmin/sendNotification 必須接回傳值
            const content = fs.readFileSync(filePath, 'utf-8');
            const sendCalls = content.match(/await this\.notifier\.(sendToAdmin|sendNotification)\(/g) || [];
            const capturedCalls = content.match(/(?:const|let|var)\s+\w+\s*=\s*await this\.notifier\.(sendToAdmin|sendNotification)\(/g) || [];
            if (sendCalls.length > capturedCalls.length) {
                const uncaptured = sendCalls.length - capturedCalls.length;
                console.error(`❌ [PatchManager] OCR 違規：${uncaptured} 個 sendToAdmin/sendNotification 呼叫未接回傳值。所有發送操作必須用 const sent = await ... 接回傳值，並依結果記錄 journal outcome。`);
                try { fs.unlinkSync(filePath); } catch (_) {}
                return false;
            }
            console.log(`✅ [PatchManager] ${filePath} 驗證通過`);
            return true;
        } catch (e) {
            console.error(`❌ [PatchManager] 驗證失敗: ${e.message}`);
            try { fs.unlinkSync(filePath); console.log(`🗑️ [PatchManager] 已清理: ${filePath}`); } catch (_) {}
            return false;
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
                const isValid = PatchManager.verify(item.tempPath);
                if (!isValid) throw new Error(`檔案 ${item.file} 驗證失敗，更新已終止以保護系統。`);
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
