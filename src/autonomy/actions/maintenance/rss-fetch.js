'use strict';
/**
 * @module maintenance/rss-fetch
 * @role 抓 AI/Agent 相關 RSS，存 raw titles 到 journal 供 digest 消化
 * @llm-free true
 */
const https = require('https');
const http = require('http');
const MaintenanceAction = require('./base');

const RSS_FEEDS = [
    { name: 'Hacker News AI', url: 'https://hnrss.org/newest?q=AI+agent&count=10' },
    { name: 'Papers With Code', url: 'https://paperswithcode.com/rss' },
    { name: 'Anthropic Blog', url: 'https://www.anthropic.com/rss.xml' },
];

class RssFetchAction extends MaintenanceAction {
    constructor(deps) { super(deps, 'rss_fetch'); }

    async run() {
        const results = [];
        for (const feed of RSS_FEEDS) {
            try {
                const raw = await this._fetch(feed.url);
                const titles = this._extractTitles(raw).slice(0, 5);
                results.push({ name: feed.name, titles, count: titles.length });
            } catch (e) {
                results.push({ name: feed.name, error: e.message, count: 0 });
            }
        }

        const total = results.reduce((s, r) => s + r.count, 0);
        const summary = `抓取 ${results.length} 個 RSS，共 ${total} 則新項目`;
        console.log(`📡 [RssFetch] ${summary}`);

        this._record('completed', { feeds: results, total, summary });
        return { success: true, summary, total, results };
    }

    _fetch(url) {
        return new Promise((resolve, reject) => {
            const mod = url.startsWith('https') ? https : http;
            const req = mod.get(url, { headers: { 'User-Agent': 'Golem-Agent/1.0' }, timeout: 10000 }, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        });
    }

    _extractTitles(xml) {
        const matches = xml.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g) || [];
        return matches.slice(1) // skip channel title
            .map(m => m.replace(/<title>(?:<!\[CDATA\[)?/, '').replace(/(?:\]\]>)?<\/title>/, '').trim())
            .filter(t => t.length > 3 && t.length < 200);
    }
}

module.exports = RssFetchAction;
