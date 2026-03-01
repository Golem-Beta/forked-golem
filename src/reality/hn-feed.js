'use strict';
/**
 * @module reality/hn-feed
 * @role 抓取 Hacker News 今日熱門，快取 60 分鐘，提供給 decision context 引導探索方向
 * @llm-free true
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const CACHE_PATH = path.join(process.cwd(), 'memory', 'hn-cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 分鐘
const TOP_N = 10;

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
            });
        }).on('error', reject);
    });
}

async function fetchTopStories() {
    const ids = await httpsGet('https://hacker-news.firebaseio.com/v0/topstories.json');
    const top = ids.slice(0, TOP_N);
    const stories = await Promise.all(
        top.map(id => httpsGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null))
    );
    return stories
        .filter(s => s && s.title)
        .map(s => ({ title: s.title, score: s.score || 0, url: s.url || '' }));
}

async function fetch() {
    // 讀快取
    try {
        if (fs.existsSync(CACHE_PATH)) {
            const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
            if (Date.now() - cache.ts < CACHE_TTL_MS) return cache.stories;
        }
    } catch {}

    // 抓新資料
    try {
        const stories = await fetchTopStories();
        fs.writeFileSync(CACHE_PATH, JSON.stringify({ ts: Date.now(), stories }));
        return stories;
    } catch (e) {
        console.warn('[HNFeed] 抓取失敗:', e.message);
        return [];
    }
}

function format(stories) {
    if (!stories || stories.length === 0) return '';
    const lines = ['【今日 HN 熱門】'];
    stories.slice(0, 8).forEach((s, i) => {
        const url = s.url ? ' ' + s.url.replace(/^https?:\/\//, '').split('/')[0] : '';
        lines.push((i + 1) + '. ' + s.title + ' (' + s.score + ')' + url);
    });
    return lines.join('\n');
}

module.exports = { fetch, format };
