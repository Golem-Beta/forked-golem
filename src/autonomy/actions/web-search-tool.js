'use strict';
/**
 * @module actions/web-search-tool
 * @role 統一網路搜尋工具層：Brave Search + DDG fallback / Jina Reader + native fallback
 * @when-to-modify 調整搜尋來源、截斷字數、解析邏輯時
 *
 * 不繼承 BaseAction（工具層，非 action）。
 * 統一介面：
 *   .search(query, options)   → [{ title, url, snippet, score? }]
 *   .fetchPage(url, options)  → markdown string
 */

const https = require('https');
const http  = require('http');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class WebSearchTool {
    /**
     * @param {object} [opts]
     * @param {object} [opts.config]  CONFIG 物件（含 BRAVE_API_KEY / JINA_API_KEY）
     *                                若無 config，從 process.env 讀（測試用）
     */
    constructor({ config } = {}) {
        this.braveKey = (config && config.BRAVE_API_KEY) || process.env.BRAVE_API_KEY || '';
        this.jinaKey  = (config && config.JINA_API_KEY)  || process.env.JINA_API_KEY  || '';
    }

    // ─── Public API ─────────────────────────────────────────────────────────────

    /**
     * 搜尋網頁。內部路由：Brave API → DDG scrape fallback。
     * @param {string} query
     * @param {object} [options]
     * @param {number} [options.limit=10]
     * @returns {Promise<Array<{title:string, url:string, snippet:string, score?:number}>>}
     */
    async search(query, options = {}) {
        const limit = options.limit || 10;

        if (this.braveKey) {
            try {
                console.log('🔍 [WebSearch] Brave Search: ' + query);
                return await this._braveSearch(query, limit);
            } catch (e) {
                console.warn('⚠️ [WebSearch] Brave 失敗 (' + e.message + ')，降級 DDG');
            }
        } else {
            console.log('🦆 [WebSearch] 無 BRAVE_API_KEY，走 DDG fallback: ' + query);
        }

        return await this._ddgSearch(query, limit);
    }

    /**
     * 抓取頁面並轉換成 LLM 友好格式。內部路由：Jina Reader → native https fallback。
     * @param {string} url
     * @param {object} [options]
     * @param {number} [options.maxChars=8000]
     * @returns {Promise<string>}
     */
    async fetchPage(url, options = {}) {
        const maxChars = options.maxChars || 8000;

        try {
            console.log('📄 [WebSearch] Jina Reader: ' + url);
            return await this._jinaFetch(url, maxChars);
        } catch (e) {
            console.warn('⚠️ [WebSearch] Jina 失敗 (' + e.message + ')，降級原生 https');
            return await this._nativeFetch(url, Math.floor(maxChars / 2));
        }
    }

    // ─── Private: Brave Search ──────────────────────────────────────────────────

    _braveSearch(query, limit) {
        return new Promise((resolve, reject) => {
            const qs = new URLSearchParams({ q: query, count: String(limit), search_lang: 'en' });
            const opts = {
                hostname: 'api.search.brave.com',
                path: '/res/v1/web/search?' + qs.toString(),
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': this.braveKey
                }
            };

            const req = https.get(opts, res => {
                if (res.statusCode >= 400) {
                    res.resume();
                    return reject(new Error('Brave HTTP ' + res.statusCode));
                }
                const chunks = [];
                res.on('data', d => chunks.push(d));
                res.on('end', () => {
                    try {
                        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                        const raw = (body && body.web && body.web.results) ? body.web.results : [];
                        const results = raw.slice(0, limit).map(r => ({
                            title:   r.title || '',
                            url:     r.url || '',
                            snippet: r.description || '',
                            score:   r.relevance_score != null ? r.relevance_score : null
                        }));
                        console.log('✅ [WebSearch] Brave 回傳 ' + results.length + ' 筆');
                        resolve(results);
                    } catch (err) {
                        reject(new Error('Brave 解析失敗: ' + err.message));
                    }
                });
            });

            req.on('error', e => reject(new Error('Brave 請求錯誤: ' + e.message)));
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('Brave 超時')); });
        });
    }

    // ─── Private: DDG fallback ──────────────────────────────────────────────────

    _ddgSearch(query, limit) {
        return new Promise(resolve => {
            const qs = new URLSearchParams({ q: query, kl: 'en-us' });
            const opts = {
                hostname: 'html.duckduckgo.com',
                path: '/html/?' + qs.toString(),
                headers: {
                    'User-Agent': UA,
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            };

            const req = https.get(opts, res => {
                if (res.statusCode >= 400) {
                    res.resume();
                    console.warn('🦆 [WebSearch] DDG HTTP ' + res.statusCode + '，回傳空陣列');
                    return resolve([]);
                }
                const chunks = [];
                res.on('data', d => chunks.push(d));
                res.on('end', () => {
                    try {
                        const html = Buffer.concat(chunks).toString('utf8');
                        const results = this._parseDDGHtml(html, limit);
                        console.log('✅ [WebSearch] DDG 回傳 ' + results.length + ' 筆');
                        resolve(results);
                    } catch (err) {
                        console.error('🦆 [WebSearch] DDG 解析失敗: ' + err.message);
                        resolve([]);
                    }
                });
            });

            req.on('error', e => {
                console.error('🦆 [WebSearch] DDG 請求失敗: ' + e.message);
                resolve([]);
            });
            req.setTimeout(15000, () => { req.destroy(); resolve([]); });
        });
    }

    /**
     * 從 DDG HTML 回應解析搜尋結果。
     * DDG 結構：<a class="result__a" href="..."> + <div class="result__snippet">
     */
    _parseDDGHtml(html, limit) {
        const results = [];

        // 找 result__a 標籤（包含 title + href）
        const aRe = /<a\b[^>]*\bclass="result__a"[^>]*>([\s\S]*?)<\/a>/g;
        // 找 result__snippet（可能是 div 或 a）
        const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:div|a)>/g;

        const links = [];
        const snippets = [];
        let m;

        while ((m = aRe.exec(html)) !== null && links.length < limit) {
            const fullTag = m[0];
            const hrefM = fullTag.match(/\bhref="([^"]*)"/);
            const title = m[1].replace(/<[^>]+>/g, '').trim();
            links.push({ href: hrefM ? hrefM[1] : '', title });
        }

        while ((m = snipRe.exec(html)) !== null && snippets.length < limit) {
            snippets.push(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
        }

        for (let i = 0; i < links.length; i++) {
            let url = links[i].href;
            // DDG href 可能是 //duckduckgo.com/l/?uddg=<encoded_url>
            if (url.startsWith('//')) url = 'https:' + url;
            try {
                const parsed = new URL(url, 'https://duckduckgo.com');
                const uddg = parsed.searchParams.get('uddg');
                if (uddg) url = decodeURIComponent(uddg);
            } catch { /* 保留原始 href */ }

            results.push({ title: links[i].title, url, snippet: snippets[i] || '' });
        }

        return results;
    }

    // ─── Private: Jina Reader ───────────────────────────────────────────────────

    _jinaFetch(targetUrl, maxChars) {
        return new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': UA,
                'Accept': 'text/markdown,text/plain,*/*',
                'X-Return-Format': 'markdown'
            };
            if (this.jinaKey) headers['Authorization'] = 'Bearer ' + this.jinaKey;

            // path = /https://example.com → Jina 伺服器側解析目標 URL
            const opts = {
                hostname: 'r.jina.ai',
                path: '/' + targetUrl,
                headers
            };

            const req = https.get(opts, res => {
                if (res.statusCode >= 400) {
                    res.resume();
                    return reject(new Error('Jina HTTP ' + res.statusCode));
                }
                const chunks = [];
                res.on('data', d => chunks.push(d));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    const out = text.length > maxChars
                        ? text.slice(0, maxChars) + '\n...[truncated]'
                        : text;
                    console.log('✅ [WebSearch] Jina 完成 (' + text.length + ' → ' + out.length + ' chars)');
                    resolve(out);
                });
            });

            req.on('error', e => reject(new Error('Jina 請求錯誤: ' + e.message)));
            req.setTimeout(20000, () => { req.destroy(); reject(new Error('Jina 超時')); });
        });
    }

    // ─── Private: Native https fallback ────────────────────────────────────────

    _nativeFetch(targetUrl, maxChars) {
        return new Promise(resolve => {
            try {
                const u = new URL(targetUrl);
                const lib = u.protocol === 'http:' ? http : https;
                const opts = {
                    hostname: u.hostname,
                    path: u.pathname + u.search,
                    port: u.port || undefined,
                    headers: { 'User-Agent': UA, 'Accept': 'text/html' }
                };

                const req = lib.get(opts, res => {
                    if (res.statusCode >= 400) { res.resume(); return resolve(''); }
                    const chunks = [];
                    res.on('data', d => chunks.push(d));
                    res.on('end', () => {
                        const html = Buffer.concat(chunks).toString('utf8');
                        // 去除 script/style 後 strip 所有 HTML 標籤
                        const stripped = html
                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                            .replace(/<style[\s\S]*?<\/style>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s{2,}/g, ' ')
                            .trim()
                            .slice(0, maxChars);
                        console.log('✅ [WebSearch] 原生 https 完成 (' + stripped.length + ' chars)');
                        resolve(stripped);
                    });
                });

                req.on('error', e => {
                    console.error('🌐 [WebSearch] 原生 https 失敗: ' + e.message);
                    resolve('');
                });
                req.setTimeout(15000, () => { req.destroy(); resolve(''); });

            } catch (e) {
                console.error('🌐 [WebSearch] URL 解析失敗: ' + e.message);
                resolve('');
            }
        });
    }
}

module.exports = WebSearchTool;
