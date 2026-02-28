/**
 * ⚙️ 全域配置 — 唯一真相來源
 * 所有模組透過 require('./config') 取得 CONFIG
 */
require('dotenv').config();

const cleanEnv = (str, allowSpaces = false) => {
    if (!str) return "";
    let cleaned = str.replace(/[^\x20-\x7E]/g, "");
    if (!allowSpaces) cleaned = cleaned.replace(/\s/g, "");
    return cleaned.trim();
};

const isPlaceholder = (str) => {
    if (!str) return true;
    return /你的|這裡|YOUR_|TOKEN/i.test(str) || str.length < 10;
};

const CONFIG = {
    TG_TOKEN: cleanEnv(process.env.TELEGRAM_TOKEN),
    DC_TOKEN: cleanEnv(process.env.DISCORD_TOKEN),
    USER_DATA_DIR: cleanEnv(process.env.USER_DATA_DIR || './golem_memory', true),
    API_KEYS: (process.env.GEMINI_API_KEYS || '').split(',').map(k => cleanEnv(k)).filter(k => k),
    SPLIT_TOKEN: '---GOLEM_ACTION_PLAN---',
    ADMIN_ID: cleanEnv(process.env.ADMIN_ID),
    DISCORD_ADMIN_ID: cleanEnv(process.env.DISCORD_ADMIN_ID),
    GITHUB_TOKEN: cleanEnv(process.env.GITHUB_TOKEN || ''),
    ADMIN_IDS: [process.env.ADMIN_ID, process.env.DISCORD_ADMIN_ID]
        .map(k => cleanEnv(k))
        .filter(k => k),
    GITHUB_REPO: cleanEnv(process.env.GITHUB_REPO || 'https://raw.githubusercontent.com/Arvincreator/project-golem/main/', true),
    QMD_PATH: cleanEnv(process.env.GOLEM_QMD_PATH || 'qmd', true),
    DONATE_URL: 'https://buymeacoffee.com/arvincreator',
    GCP_CLIENT_ID: cleanEnv(process.env.GCP_CLIENT_ID || '', true),
    GCP_CLIENT_SECRET: cleanEnv(process.env.GCP_CLIENT_SECRET || '', true)
};

// 驗證關鍵 Token
if (isPlaceholder(CONFIG.TG_TOKEN)) { console.warn("⚠️ [Config] TELEGRAM_TOKEN 看起來是預設值或無效，TG Bot 將不啟動。"); CONFIG.TG_TOKEN = ""; }
if (isPlaceholder(CONFIG.DC_TOKEN)) { console.warn("⚠️ [Config] DISCORD_TOKEN 看起來是預設值或無效，Discord Bot 將不啟動。"); CONFIG.DC_TOKEN = ""; }
if (CONFIG.API_KEYS.some(isPlaceholder)) {
    console.warn("⚠️ [Config] 偵測到部分 API_KEYS 為無效預設值，已自動過濾。");
    CONFIG.API_KEYS = CONFIG.API_KEYS.filter(k => !isPlaceholder(k));
}

module.exports = CONFIG;
module.exports.cleanEnv = cleanEnv;
module.exports.isPlaceholder = isPlaceholder;
