/**
 * 🌐 Google Services 封裝 — Gmail / Calendar / Drive / Tasks
 * 職責：封裝四項 Google API 常用操作；Lazy init；刪除操作不實作
 * 依賴：GCPAuth instance（由外部注入）
 */
'use strict';

const { google } = require('googleapis');

class GoogleServices {
    constructor(gcpAuth) {
        this._auth = gcpAuth;
        this._gmail = null;
        this._calendar = null;
        this._drive = null;
        this._tasks = null;
    }

    // 第一次呼叫時建立所有 service instance
    async _init() {
        if (this._gmail) return;
        const client = await this._auth.getClient();
        this._gmail = google.gmail({ version: 'v1', auth: client });
        this._calendar = google.calendar({ version: 'v3', auth: client });
        this._drive = google.drive({ version: 'v3', auth: client });
        this._tasks = google.tasks({ version: 'v1', auth: client });
    }

    // ─── Gmail ─────────────────────────────────────────────

    // 列出未讀郵件，回傳 [{id, subject, from, snippet, date}]
    async listUnread(maxResults = 10) {
        try {
            await this._init();
            const res = await this._gmail.users.messages.list({ userId: 'me', q: 'is:unread', maxResults });
            const messages = res.data.messages || [];
            if (!messages.length) return [];
            const results = await Promise.all(messages.map(m => this._fetchMessageMeta(m.id)));
            return results.filter(Boolean);
        } catch (e) {
            throw new Error(`[GoogleServices.listUnread] ${e.message}`);
        }
    }

    async _fetchMessageMeta(messageId) {
        const res = await this._gmail.users.messages.get({
            userId: 'me', id: messageId, format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
        });
        const headers = res.data.payload.headers || [];
        const h = name => (headers.find(x => x.name === name) || {}).value || '';
        return { id: messageId, subject: h('Subject'), from: h('From'), snippet: res.data.snippet || '', date: h('Date') };
    }

    // 讀取單封郵件，回傳 {subject, from, date, body}（body 已解碼 base64）
    async readMessage(messageId) {
        try {
            await this._init();
            const res = await this._gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
            const headers = res.data.payload.headers || [];
            const h = name => (headers.find(x => x.name === name) || {}).value || '';
            return { subject: h('Subject'), from: h('From'), date: h('Date'), body: this._extractBody(res.data.payload) };
        } catch (e) {
            throw new Error(`[GoogleServices.readMessage] ${e.message}`);
        }
    }

    _extractBody(payload) {
        if (!payload) return '';
        if (payload.body && payload.body.data) {
            return Buffer.from(payload.body.data, 'base64').toString('utf8');
        }
        const parts = payload.parts || [];
        for (const part of parts) {
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                return Buffer.from(part.body.data, 'base64').toString('utf8');
            }
        }
        for (const part of parts) {
            const nested = this._extractBody(part);
            if (nested) return nested;
        }
        return '';
    }

    // ─── Calendar ──────────────────────────────────────────

    // 列出未來 N 天內的事件，回傳 [{id, title, start, end, location}]
    async listEvents(days = 7) {
        try {
            await this._init();
            const now = new Date();
            const future = new Date(now.getTime() + days * 86400000);
            const res = await this._calendar.events.list({
                calendarId: 'primary', timeMin: now.toISOString(), timeMax: future.toISOString(),
                singleEvents: true, orderBy: 'startTime'
            });
            return (res.data.items || []).map(ev => ({
                id: ev.id,
                title: ev.summary || '',
                start: (ev.start && (ev.start.dateTime || ev.start.date)) || '',
                end: (ev.end && (ev.end.dateTime || ev.end.date)) || '',
                location: ev.location || ''
            }));
        } catch (e) {
            throw new Error(`[GoogleServices.listEvents] ${e.message}`);
        }
    }

    // 建立事件，回傳 eventId
    async createEvent({ title, start, end, description = '', location = '' }) {
        try {
            await this._init();
            const res = await this._calendar.events.insert({
                calendarId: 'primary',
                resource: { summary: title, description, location, start: { dateTime: start }, end: { dateTime: end } }
            });
            return res.data.id;
        } catch (e) {
            throw new Error(`[GoogleServices.createEvent] ${e.message}`);
        }
    }

    // ─── Drive ─────────────────────────────────────────────

    // 列出 Drive 檔案，回傳 [{id, name, mimeType, modifiedTime}]
    async listFiles(query = '', maxResults = 10) {
        try {
            await this._init();
            const params = { pageSize: maxResults, fields: 'files(id, name, mimeType, modifiedTime)', orderBy: 'modifiedTime desc' };
            if (query) params.q = query;
            const res = await this._drive.files.list(params);
            return (res.data.files || []).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime }));
        } catch (e) {
            throw new Error(`[GoogleServices.listFiles] ${e.message}`);
        }
    }

    // 尋找特定資料夾內的檔案（name 精確比對），回傳 {id, name} 或 null
    async findFile({ name, folderId }) {
        try {
            await this._init();
            let q = `name='${name}' and trashed=false`;
            if (folderId) q += ` and '${folderId}' in parents`;
            const res = await this._drive.files.list({ q, pageSize: 1, fields: 'files(id, name)' });
            const files = res.data.files || [];
            return files.length ? { id: files[0].id, name: files[0].name } : null;
        } catch (e) {
            throw new Error(`[GoogleServices.findFile] ${e.message}`);
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
            throw new Error(`[GoogleServices.uploadFile] ${e.message}`);
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
            throw new Error(`[GoogleServices.updateFile] ${e.message}`);
        }
    }

    // 讀取檔案文字內容（僅支援 text/* 和 Google Docs export）
    async readFile(fileId) {
        try {
            await this._init();
            const meta = await this._drive.files.get({ fileId, fields: 'mimeType' });
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
            throw new Error(`[GoogleServices.readFile] ${e.message}`);
        }
    }

    // ─── Tasks ─────────────────────────────────────────────

    async _getDefaultTaskListId() {
        const res = await this._tasks.tasklists.list({ maxResults: 1 });
        const lists = res.data.items || [];
        if (!lists.length) throw new Error('找不到預設 TaskList');
        return lists[0].id;
    }

    // 列出預設 TaskList 的未完成任務，回傳 [{id, title, notes, due}]
    async listTasks(maxResults = 20) {
        try {
            await this._init();
            const taskListId = await this._getDefaultTaskListId();
            const res = await this._tasks.tasks.list({ tasklist: taskListId, showCompleted: false, maxResults });
            return (res.data.items || []).map(t => ({ id: t.id, title: t.title || '', notes: t.notes || '', due: t.due || '' }));
        } catch (e) {
            throw new Error(`[GoogleServices.listTasks] ${e.message}`);
        }
    }

    // 建立任務，回傳 taskId
    async createTask({ title, notes = '', due = null }) {
        try {
            await this._init();
            const taskListId = await this._getDefaultTaskListId();
            const resource = { title, notes };
            if (due) resource.due = due;
            const res = await this._tasks.tasks.insert({ tasklist: taskListId, resource });
            return res.data.id;
        } catch (e) {
            throw new Error(`[GoogleServices.createTask] ${e.message}`);
        }
    }

    // 標記任務完成，回傳 true
    async completeTask(taskId) {
        try {
            await this._init();
            const taskListId = await this._getDefaultTaskListId();
            await this._tasks.tasks.patch({ tasklist: taskListId, task: taskId, resource: { status: 'completed' } });
            return true;
        } catch (e) {
            throw new Error(`[GoogleServices.completeTask] ${e.message}`);
        }
    }
}

module.exports = GoogleServices;
