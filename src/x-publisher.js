/**
 * 🐦 X (Twitter) 自主發文模組
 * 使用 twitter-api-v2，免費方案每月 500 篇，每日保守上限 15 篇
 */
const { TwitterApi } = require('twitter-api-v2');
const CONFIG = require('./config');

const DAILY_LIMIT = 15;
const MAX_CHARS = 280; // Twitter 加權上限：CJK 字元計 2，所以中文上限約 140 字

// CJK 字元判斷（依 Twitter 加權規則）
function _isCJK(codePoint) {
    return (
        (codePoint >= 0x1100 && codePoint <= 0x115F) ||
        (codePoint >= 0x2E80 && codePoint <= 0x303F) ||
        (codePoint >= 0x3040 && codePoint <= 0x33BF) ||
        (codePoint >= 0x33FF && codePoint <= 0xA4CF) ||
        (codePoint >= 0xA960 && codePoint <= 0xA97F) ||
        (codePoint >= 0xAC00 && codePoint <= 0xD7FF) ||
        (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
        (codePoint >= 0xFE10 && codePoint <= 0xFE1F) ||
        (codePoint >= 0xFE30 && codePoint <= 0xFE6F) ||
        (codePoint >= 0xFF00 && codePoint <= 0xFFEF)
    );
}

// 計算 Twitter 加權字元數
function _twitterWeightedLength(str) {
    let count = 0;
    for (const char of str) count += _isCJK(char.codePointAt(0)) ? 2 : 1;
    return count;
}

// 依加權長度截斷，加上 … 結尾
function _truncateToLimit(str, maxWeighted) {
    if (_twitterWeightedLength(str) <= maxWeighted) return str;
    let weighted = 0;
    let cutIdx = 0;
    for (const char of str) {
        const w = _isCJK(char.codePointAt(0)) ? 2 : 1;
        if (weighted + w > maxWeighted - 1) break;
        weighted += w;
        cutIdx += char.length; // surrogate pair 安全
    }
    return str.slice(0, cutIdx) + '…';
}

class XPublisher {
    constructor({ config } = {}) {
        const cfg = config || CONFIG;
        const apiKey          = cfg.X_API_KEY;
        const apiSecret       = cfg.X_API_SECRET;
        const accessToken     = cfg.X_ACCESS_TOKEN;
        const accessTokenSecret = cfg.X_ACCESS_TOKEN_SECRET;

        this.isEnabled = !!(apiKey && apiSecret && accessToken && accessTokenSecret);

        if (this.isEnabled) {
            this._client = new TwitterApi({
                appKey:      apiKey,
                appSecret:   apiSecret,
                accessToken,
                accessSecret: accessTokenSecret,
            });
        }

        this._dailyCount    = 0;
        this._lastResetDate = new Date().toDateString();
    }

    // 跨日重置計數
    _checkDailyReset() {
        const today = new Date().toDateString();
        if (today !== this._lastResetDate) {
            this._dailyCount    = 0;
            this._lastResetDate = today;
        }
    }

    getDailyCount() {
        this._checkDailyReset();
        return this._dailyCount;
    }

    async post(text) {
        if (!this.isEnabled) {
            return { ok: false, error: 'XPublisher 未啟用（缺少 API key）' };
        }

        this._checkDailyReset();

        if (this._dailyCount >= DAILY_LIMIT) {
            console.error(`🐦 [XPublisher] 今日發文已達上限 ${DAILY_LIMIT} 篇，拒絕發文`);
            return { ok: false, error: `今日發文已達上限 ${DAILY_LIMIT} 篇` };
        }

        // 依 Twitter 加權字元數截斷（CJK 計 2）
        let tweetText = _truncateToLimit(text, MAX_CHARS);

        try {
            const result = await this._client.v2.tweet(tweetText);
            this._dailyCount++;
            console.log(`🐦 [XPublisher] 發文成功 id=${result.data.id}，今日第 ${this._dailyCount} 篇`);
            return { ok: true, tweetId: result.data.id };
        } catch (err) {
            console.error(`🐦 [XPublisher] 發文失敗：${err.message}`);
            return { ok: false, error: err.message };
        }
    }
}

module.exports = XPublisher;
