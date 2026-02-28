/**
 * @module moltbook-client
 * @role Moltbook API 輕量 HTTP client — 原生 https，零 npm 依賴
 * @when-to-modify 新增 API 端點、調整 error handling 或 rate limit 邏輯時
 */

const https = require('https');

const BASE_URL = 'https://www.moltbook.com/api/v1';

class MoltbookClient {
    constructor(apiKey) {
        if (!apiKey) throw new Error('[MoltbookClient] 缺少 MOLTBOOK_API_KEY');
        this.apiKey = apiKey;
    }

    /**
     * @param {string} path - e.g. '/agents/me'
     * @returns {Promise<object>}
     */
    get(path) {
        return this._request('GET', path, null);
    }

    /**
     * @param {string} path
     * @param {object} body
     * @returns {Promise<object>}
     */
    post(path, body) {
        return this._request('POST', path, body);
    }

    /**
     * @param {string} path
     * @param {object} body
     * @returns {Promise<object>}
     */
    patch(path, body) {
        return this._request('PATCH', path, body);
    }

    _request(method, path, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(BASE_URL + path);
            const payload = body ? JSON.stringify(body) : null;

            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    let parsed;
                    try { parsed = JSON.parse(data); }
                    catch { parsed = { raw: data }; }

                    if (res.statusCode === 429) {
                        return resolve({
                            success: false,
                            rateLimited: true,
                            retry_after: parsed.retry_after_minutes
                                ? parsed.retry_after_minutes * 60
                                : (parsed.retry_after_seconds || 60),
                            error: parsed.error || 'rate_limited',
                        });
                    }

                    if (res.statusCode >= 400) {
                        return resolve({
                            success: false,
                            statusCode: res.statusCode,
                            error: parsed.error || parsed.message || 'unknown_error',
                            hint: parsed.hint || null,
                        });
                    }

                    resolve({ success: true, ...parsed });
                });
            });

            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }
}

module.exports = MoltbookClient;
