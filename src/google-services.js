/**
 * 🌐 Google Services 封裝 — Gmail / Calendar / Drive / Tasks
 * 職責：封裝四項 Google API 常用操作；Lazy init；刪除操作不實作
 * 依賴：GCPAuth instance（由外部注入）
 * Gmail 操作委派至 GmailClient，Drive 操作委派至 DriveClient
 */
'use strict';

const { google } = require('googleapis');
const GmailClient = require('./google-gmail');
const DriveClient = require('./google-drive');

class GoogleServices {
    constructor(gcpAuth) {
        this._auth     = gcpAuth;
        this._calendar = null;
        this._tasks    = null;
        this._sheets   = null;
        this._mail     = new GmailClient(gcpAuth);
        this._drv      = new DriveClient(gcpAuth);
    }

    // Lazy init — Calendar + Tasks + Sheets only（Gmail/Drive 各自管理）
    async _init() {
        if (this._calendar) return;
        const client   = await this._auth.getClient();
        this._calendar = google.calendar({ version: 'v3', auth: client });
        this._tasks    = google.tasks({ version: 'v1', auth: client });
        this._sheets   = google.sheets({ version: 'v4', auth: client });
    }

    // ─── Gmail (delegated) ──────────────────────────────────

    async listUnread(maxResults = 10) { return this._mail.listUnread(maxResults); }
    async readMessage(messageId)      { return this._mail.readMessage(messageId); }

    // ─── Calendar ───────────────────────────────────────────

    // 列出未來 N 天內的事件，回傳 [{id, title, start, end, location}]
    async listEvents(days = 7) {
        try {
            await this._init();
            const now    = new Date();
            const future = new Date(now.getTime() + days * 86400000);
            const res    = await this._calendar.events.list({
                calendarId: 'primary', timeMin: now.toISOString(), timeMax: future.toISOString(),
                singleEvents: true, orderBy: 'startTime'
            });
            return (res.data.items || []).map(ev => ({
                id:       ev.id,
                title:    ev.summary || '',
                start:    (ev.start && (ev.start.dateTime || ev.start.date)) || '',
                end:      (ev.end   && (ev.end.dateTime   || ev.end.date))   || '',
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

    // ─── Drive (delegated) ──────────────────────────────────

    async listFiles(query = '', maxResults = 10) { return this._drv.listFiles(query, maxResults); }
    async findFile(opts)                          { return this._drv.findFile(opts); }
    async createFolder(opts)                      { return this._drv.createFolder(opts); }
    async uploadFile(opts)                        { return this._drv.uploadFile(opts); }
    async updateFile(opts)                        { return this._drv.updateFile(opts); }
    async readFile(fileId)                        { return this._drv.readFile(fileId); }

    // ─── Tasks ──────────────────────────────────────────────

    async _getDefaultTaskListId() {
        const res   = await this._tasks.tasklists.list({ maxResults: 1 });
        const lists = res.data.items || [];
        if (!lists.length) throw new Error('找不到預設 TaskList');
        return lists[0].id;
    }

    // 列出預設 TaskList 的未完成任務，回傳 [{id, title, notes, due}]
    async listTasks(maxResults = 20) {
        try {
            await this._init();
            const taskListId = await this._getDefaultTaskListId();
            const res        = await this._tasks.tasks.list({ tasklist: taskListId, showCompleted: false, maxResults });
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
            const resource   = { title, notes };
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

    // ─── Sheets ─────────────────────────────────────────────

    // 取得或建立 Beta 專屬試算表（按名稱查找，不存在則建立），回傳 spreadsheetId
    async getOrCreateSheet(name) {
        try {
            await this._init();
            const files = await this._drv.listFiles(
                `name='${name}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
                1
            );
            if (files.length) return files[0].id;
            const res = await this._sheets.spreadsheets.create({
                resource: { properties: { title: name } }
            });
            return res.data.spreadsheetId;
        } catch (e) {
            throw new Error(`[GoogleServices.getOrCreateSheet] ${e.message}`);
        }
    }

    // 追加一列資料至試算表（INSERT_ROWS 模式）
    async appendRow(spreadsheetId, values) {
        try {
            await this._init();
            await this._sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'A1',
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [values] },
            });
        } catch (e) {
            throw new Error(`[GoogleServices.appendRow] ${e.message}`);
        }
    }
}

module.exports = GoogleServices;
