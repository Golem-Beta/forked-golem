/**
 * 🐦 X (Twitter) 自主發文模組
 * 使用 twitter-api-v2，免費方案每月 500 篇，每日保守上限 15 篇
 */
const { TwitterApi } = require('twitter-api-v2');
const CONFIG = require('./config');

const DAILY_LIMIT = 15;
const MAX_CHARS = 280;

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

        // 超過 280 字元自動截斷
        let tweetText = text;
        if (tweetText.length > MAX_CHARS) {
            tweetText = tweetText.slice(0, MAX_CHARS - 1) + '…';
        }

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
