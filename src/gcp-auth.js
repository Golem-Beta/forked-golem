/**
 * 🔐 GCP OAuth2 管理 — Loopback Redirect 授權 + token 持久化
 *
 * 職責：
 *   - 管理 OAuth2 token 生命週期（載入、刷新、清除）
 *   - Loopback Redirect 授權流程（Desktop app OAuth client）
 *   - token 持久化至 config/gcp-tokens.json
 */
'use strict';

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const http = require('http');
const CONFIG = require('./config');

const TOKEN_PATH = path.join(__dirname, '../config/gcp-tokens.json');
const CONFIG_DIR = path.join(__dirname, '../config');

class GCPAuth {
    constructor() {
        this._tokens = null;
        this._client = null;
        this._scopes = [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/tasks'
        ];
        // 持久化 OAuth2Client，供 loopback flow 動態設定 redirectUri
        this._oauth2Client = new google.auth.OAuth2(
            CONFIG.GCP_CLIENT_ID,
            CONFIG.GCP_CLIENT_SECRET
        );
        this._ensureConfigDir();
    }

    // ─── 初始化 ────────────────────────────────────────────

    _ensureConfigDir() {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
            console.log('📁 [GCPAuth] 已建立 config/ 目錄');
        }
    }

    // ─── Token 持久化 ──────────────────────────────────────

    saveTokens(tokens) {
        this._tokens = tokens;
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
        console.log('🔐 [GCPAuth] token 已儲存至', TOKEN_PATH);
    }

    loadTokens() {
        if (!fs.existsSync(TOKEN_PATH)) return null;
        try {
            const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
            this._tokens = JSON.parse(raw);
            return this._tokens;
        } catch (e) {
            console.warn('⚠️ [GCPAuth] token 檔損壞，清除後等待重新授權');
            this._clearTokens();
            return null;
        }
    }

    _clearTokens() {
        this._tokens = null;
        this._client = null;
        try {
            if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
        } catch (e) {
            console.warn(`⚠️ [GCPAuth] 清除 token 檔失敗：${e.message}`);
        }
    }

    // ─── 公開介面 ──────────────────────────────────────────

    /**
     * 同步檢查是否已有 refresh_token（不觸發網路）
     */
    isAuthenticated() {
        if (!this._tokens) this.loadTokens();
        return !!(this._tokens && this._tokens.refresh_token);
    }

    /**
     * 確保已授權：有 refresh_token 就靜默刷新，否則回傳 false（需 loopback flow）
     * @returns {Promise<boolean>} true = 授權有效
     */
    async ensureAuthenticated() {
        if (!this._tokens) {
            this.loadTokens();
        }
        if (!this._tokens || !this._tokens.refresh_token) {
            return false;
        }

        try {
            this._oauth2Client.setCredentials(this._tokens);
            const { credentials } = await this._oauth2Client.refreshAccessToken();
            this.saveTokens(credentials);
            this._client = this._oauth2Client;
            return true;
        } catch (e) {
            console.error(`❌ [GCPAuth] token 刷新失敗：${e.message}`);
            this._clearTokens();
            throw new Error(`[GCPAuth] token 刷新失敗，需重新授權：${e.message}`);
        }
    }

    /**
     * 回傳已授權的 OAuth2Client，呼叫前自動 ensureAuthenticated
     * @returns {Promise<OAuth2Client>}
     */
    async getClient() {
        if (this._client && this.isAuthenticated()) {
            return this._client;
        }
        const ok = await this.ensureAuthenticated();
        if (!ok) {
            throw new Error('[GCPAuth] 尚未授權，請先執行 startLoopbackFlow()');
        }
        return this._client;
    }

    /**
     * 啟動 Loopback Redirect 授權流程（適用 Desktop app OAuth client）
     * @param {Function} notifyFn  (authUrl) => Promise<void>  — 收到授權 URL 後呼叫
     * @returns {Promise<Object>} 取得的 token
     */
    async startLoopbackFlow(notifyFn) {
        if (!CONFIG.GCP_CLIENT_ID || !CONFIG.GCP_CLIENT_SECRET) {
            throw new Error('[GCPAuth] GCP_CLIENT_ID / GCP_CLIENT_SECRET 未設定，請檢查 .env');
        }

        // 1. 開臨時 HTTP server，先嘗試 port 9876，被佔用就用 OS 分配
        let server, port;
        await new Promise((resolve, reject) => {
            server = http.createServer();
            server.listen(9876, '127.0.0.1', () => {
                port = server.address().port;
                resolve();
            });
            server.on('error', () => {
                server = http.createServer();
                server.listen(0, '127.0.0.1', () => {
                    port = server.address().port;
                    resolve();
                });
                server.on('error', reject);
            });
        });

        // 2. 設定 redirectUri，產生授權 URL
        this._oauth2Client.redirectUri = `http://127.0.0.1:${port}/callback`;
        const authUrl = this._oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: this._scopes,
        });

        // 3. 通知外部（透過 Telegram 發給主人）
        console.log(`🔐 [GCPAuth] Loopback Flow 啟動 → port: ${port} | url: ${authUrl}`);
        if (typeof notifyFn === 'function') {
            await notifyFn(authUrl);
        }

        // 4. 等待 callback（10 分鐘 timeout）
        const code = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                server.close();
                reject(new Error('[GCPAuth] 授權逾時（10 分鐘）'));
            }, 10 * 60 * 1000);

            server.on('request', (req, res) => {
                const url = new URL(req.url, `http://127.0.0.1:${port}`);
                if (url.pathname !== '/callback') { res.end(); return; }

                clearTimeout(timeout);

                if (url.searchParams.get('error')) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h1>❌ 授權失敗</h1><p>可以關閉這個視窗。</p>');
                    server.close();
                    reject(new Error(url.searchParams.get('error_description') || url.searchParams.get('error')));
                    return;
                }

                const authCode = url.searchParams.get('code');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>✅ Golem 授權完成</h1><p>可以關閉這個視窗了。</p>');
                server.close();
                resolve(authCode);
            });
        });

        // 5. 換 token
        const { tokens } = await this._oauth2Client.getToken(code);
        this._oauth2Client.setCredentials(tokens);
        this._client = this._oauth2Client;
        this.saveTokens(tokens);
        console.log('✅ [GCPAuth] Loopback Flow 授權完成');
        return tokens;
    }
}

module.exports = GCPAuth;
