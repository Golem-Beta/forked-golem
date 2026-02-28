'use strict';
/**
 * @module actions/drive-sync
 * @role DriveSyncAction — 將 journal + reflections 備份至 Google Drive Golem-Data 資料夾
 * @when-to-modify 調整備份檔案列表、Drive 資料夾名稱時
 *
 * deps 需求：journal, googleServices
 * 流程：尋找 Golem-Data 資料夾 → 不存在則 skip → 逐檔 findFile+update/upload
 */

const fs = require('fs');
const path = require('path');

const DRIVE_FOLDER_NAME = 'Golem-Data';
const JOURNAL_PATH = path.join(process.cwd(), 'memory', 'journal.jsonl');
const REFLECTIONS_DIR = path.join(process.cwd(), 'memory', 'reflections');
const MAX_REFLECTIONS = 3;

class DriveSyncAction {
    constructor(deps) {
        this._deps = deps;
    }

    async run() {
        if (!this._deps.googleServices || !this._deps.googleServices._auth?.isAuthenticated()) {
            return { skipped: true, reason: 'not_authenticated' };
        }

        // 尋找 Golem-Data 資料夾
        let folders;
        try {
            folders = await this._deps.googleServices.listFiles(
                `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                1
            );
        } catch (e) {
            console.error('[DriveSync] listFiles 錯誤:', e.message);
            return { success: false, error: e.message };
        }

        if (!folders.length) {
            this._deps.journal.append({
                action: 'drive_sync',
                outcome: 'folder_missing',
                detail: `找不到 Drive 資料夾：${DRIVE_FOLDER_NAME}`,
            });
            return { skipped: true, reason: 'folder_missing' };
        }

        const folderId = folders[0].id;
        const results = { uploaded: [], updated: [], failed: [] };

        // 上傳 journal.jsonl
        await this._syncFile({
            localPath: JOURNAL_PATH,
            name: 'journal.jsonl',
            mimeType: 'application/x-ndjson',
            folderId,
            results,
        });

        // 上傳最近 3 個 reflections
        for (const filePath of this._getLatestReflections()) {
            await this._syncFile({
                localPath: filePath,
                name: path.basename(filePath),
                mimeType: 'text/plain',
                folderId,
                results,
            });
        }

        this._deps.journal.append({
            action: 'drive_sync',
            folderId,
            uploaded: results.uploaded.length,
            updated: results.updated.length,
            failed: results.failed.length,
            outcome: results.failed.length === 0 ? 'success' : 'partial',
        });

        return { success: true, ...results };
    }

    _getLatestReflections() {
        try {
            return fs.readdirSync(REFLECTIONS_DIR)
                .filter(f => f.endsWith('.txt'))
                .map(f => ({ f, mtime: fs.statSync(path.join(REFLECTIONS_DIR, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, MAX_REFLECTIONS)
                .map(({ f }) => path.join(REFLECTIONS_DIR, f));
        } catch {
            return [];
        }
    }

    async _syncFile({ localPath, name, mimeType, folderId, results }) {
        try {
            if (!fs.existsSync(localPath)) return;
            const content = fs.readFileSync(localPath, 'utf8');
            const existing = await this._deps.googleServices.findFile({ name, folderId });
            if (existing) {
                await this._deps.googleServices.updateFile({ fileId: existing.id, content, mimeType });
                results.updated.push(name);
            } else {
                await this._deps.googleServices.uploadFile({ name, content, mimeType, folderId });
                results.uploaded.push(name);
            }
        } catch (e) {
            results.failed.push({ name, error: e.message });
        }
    }
}

module.exports = DriveSyncAction;
