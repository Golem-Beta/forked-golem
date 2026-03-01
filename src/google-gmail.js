'use strict';
/**
 * @module google-gmail
 * @role Gmail API 封裝 — 列出未讀、讀取郵件、解碼 body
 * @when-to-modify 調整 Gmail 操作時；依賴 GCPAuth，不直接依賴其他 Google service
 */
const { google } = require('googleapis');

class GmailClient {
    constructor(gcpAuth) {
        this._auth  = gcpAuth;
        this._gmail = null;
    }

    async _init() {
        if (this._gmail) return;
        const client = await this._auth.getClient();
        this._gmail  = google.gmail({ version: 'v1', auth: client });
    }

    // 列出未讀郵件，回傳 [{id, subject, from, snippet, date}]
    async listUnread(maxResults = 10) {
        try {
            await this._init();
            const res      = await this._gmail.users.messages.list({ userId: 'me', q: 'is:unread', maxResults });
            const messages = res.data.messages || [];
            if (!messages.length) return [];
            const results  = await Promise.all(messages.map(m => this._fetchMessageMeta(m.id)));
            return results.filter(Boolean);
        } catch (e) {
            throw new Error(`[GmailClient.listUnread] ${e.message}`);
        }
    }

    async _fetchMessageMeta(messageId) {
        const res     = await this._gmail.users.messages.get({
            userId: 'me', id: messageId, format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
        });
        const headers = res.data.payload.headers || [];
        const h       = name => (headers.find(x => x.name === name) || {}).value || '';
        return { id: messageId, subject: h('Subject'), from: h('From'), snippet: res.data.snippet || '', date: h('Date') };
    }

    // 讀取單封郵件，回傳 {subject, from, date, body}（body 已解碼 base64）
    async readMessage(messageId) {
        try {
            await this._init();
            const res     = await this._gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
            const headers = res.data.payload.headers || [];
            const h       = name => (headers.find(x => x.name === name) || {}).value || '';
            return { subject: h('Subject'), from: h('From'), date: h('Date'), body: this._extractBody(res.data.payload) };
        } catch (e) {
            throw new Error(`[GmailClient.readMessage] ${e.message}`);
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
}

module.exports = GmailClient;
