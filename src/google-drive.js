'use strict';
/**
 * @module google-drive
 * @role Google Drive API 封裝 — 列表、查找、資料夾、上傳、更新、讀取
 * @when-to-modify 調整 Drive 操作時；依賴 GCPAuth，不直接依賴其他 Google service
 */
const { google } = require('googleapis');

class DriveClient {
    constructor(gcpAuth) {
        this._auth  = gcpAuth;
        this._drive = null;
    }

    async _init() {
        if (this._drive) return;
        const client = await this._auth.getClient();
        this._drive  = google.drive({ version: 'v3', auth: client });
    }

    // 列出 Drive 檔案，回傳 [{id, name, mimeType, modifiedTime}]
    async listFiles(query = '', maxResults = 10) {
        try {
            await this._init();
            const params = { pageSize: maxResults, fields: 'files(id, name, mimeType, modifiedTime)', orderBy: 'modifiedTime desc' };
            if (query) params.q = query;
            const res = await this._drive.files.list(params);
            return (res.data.files || []).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime }));
        } catch (e) {
            throw new Error(`[DriveClient.listFiles] ${e.message}`);
        }
    }

    // 尋找特定資料夾內的檔案（name 精確比對），回傳 {id, name} 或 null
    async findFile({ name, folderId }) {
        try {
            await this._init();
            let q = `name='${name}' and trashed=false`;
            if (folderId) q += ` and '${folderId}' in parents`;
            const res   = await this._drive.files.list({ q, pageSize: 1, fields: 'files(id, name)' });
            const files = res.data.files || [];
            return files.length ? { id: files[0].id, name: files[0].name } : null;
        } catch (e) {
            throw new Error(`[DriveClient.findFile] ${e.message}`);
        }
    }

    async createFolder({ name, parentId = null }) {
        try {
            await this._init();
            const res = await this._drive.files.create({
                requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : [] },
                fields: 'id, name',
            });
            return { id: res.data.id, name: res.data.name };
        } catch (e) {
            throw new Error(`[DriveClient.createFolder] ${e.message}`);
        }
    }

    // 上傳新檔案至指定資料夾，回傳 fileId
    async uploadFile({ name, content, mimeType, folderId }) {
        try {
            await this._init();
            const { Readable } = require('stream');
            const res = await this._drive.files.create({
                requestBody: { name, mimeType, parents: folderId ? [folderId] : [] },
                media: { mimeType, body: Readable.from([content]) },
                fields: 'id',
            });
            return res.data.id;
        } catch (e) {
            throw new Error(`[DriveClient.uploadFile] ${e.message}`);
        }
    }

    // 更新現有檔案內容，回傳 true
    async updateFile({ fileId, content, mimeType }) {
        try {
            await this._init();
            const { Readable } = require('stream');
            await this._drive.files.update({
                fileId,
                media: { mimeType, body: Readable.from([content]) },
            });
            return true;
        } catch (e) {
            throw new Error(`[DriveClient.updateFile] ${e.message}`);
        }
    }

    // 讀取檔案文字內容（僅支援 text/* 和 Google Docs export）
    async readFile(fileId) {
        try {
            await this._init();
            const meta     = await this._drive.files.get({ fileId, fields: 'mimeType' });
            const mimeType = meta.data.mimeType;
            if (mimeType === 'application/vnd.google-apps.document') {
                const res = await this._drive.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
                return res.data;
            }
            if (mimeType && mimeType.startsWith('text/')) {
                const res = await this._drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
                return res.data;
            }
            throw new Error(`不支援的 mimeType：${mimeType}（僅支援 text/plain 和 Google Docs）`);
        } catch (e) {
            throw new Error(`[DriveClient.readFile] ${e.message}`);
        }
    }
}

module.exports = DriveClient;
