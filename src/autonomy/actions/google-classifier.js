'use strict';
/**
 * @module actions/google-classifier
 * @role Gmail 兩層分類邏輯 — 純規則（同步）+ LLM 判斷（async）
 * @when-to-modify 調整過濾關鍵字、IGNORE 模式、LLM 判斷 prompt、verdict 行為時
 *
 * verdict 四種：
 *   important    — 跟 Beta 自身基礎設施直接相關，需通知 Michael
 *   self_handle  — Beta 自己能消化，記 journal 即可，不打擾 Michael
 *   trigger_action — 信件暗示 Beta 應採取某個 action（Moltbook 通知、API 異常等）
 *   ignore       — 純雜訊
 */

const fs   = require('fs');
const path = require('path');

// ─── 第一層：規則分類常數 ──────────────────────────────────────────────────

const ALWAYS_NOTIFY_KEYWORDS = [
    '帳單', '付款', '到期', '逾期', 'billing', 'payment', 'invoice', 'overdue',
    '錯誤', '警告', '異常', 'error', 'warning', 'alert', 'critical', 'failed',
    'unauthorized', 'breach', 'intrusion',
    '憑證', 'certificate', 'ssl', 'tls', 'expired',
    '配額', 'quota', 'limit exceeded', 'rate limit',
    'shut down', 'deletion', 'suspended', 'terminated',
];

const ALWAYS_IGNORE_PATTERNS = [
    /accounts.google.com/i,
    /no-reply@accounts.google.com/i,
    /newsletter|marketing|promo|unsubscribe/i,
    /follow-suggestions@|posts-recap@|instagram.com/i,
    /welcome@|support@buymeacoffee/i,
    /notifications?@(?!github)/i,
];

const GOOGLE_PLATFORM_NOTIFY = [
    'shut down', 'deletion warning', 'suspended', 'terminated',
    'billing', 'payment', 'quota exceeded',
];

const GITHUB_IMPORTANT = ['security alert', 'failed', 'vulnerability', 'dependabot'];

// ─── trigger_action mapping：信件來源 / 關鍵字 → 建議 action ──────────────

const TRIGGER_ACTION_MAP = [
    { pattern: /moltbook/i,                           action: 'moltbook_check',  reason: 'Moltbook 有通知' },
    { pattern: /groq|cerebras|openrouter|sambanova|mistral|deepseek|nvidia/i,
                                                       action: 'health_check',   reason: 'API provider 通知' },
    { pattern: /github.*security|dependabot/i,         action: 'github_explore', reason: 'GitHub 安全警告' },
    { pattern: /quota|rate.?limit|429/i,               action: 'health_check',   reason: 'API 配額警告' },
    { pattern: /google.*cloud|gcp|firebase/i,          action: 'health_check',   reason: 'GCP 基礎設施通知' },
];

function detectTriggerAction(email) {
    const text = (email.subject + ' ' + email.snippet + ' ' + email.from).toLowerCase();
    for (const entry of TRIGGER_ACTION_MAP) {
        if (entry.pattern.test(text)) return { action: entry.action, reason: entry.reason };
    }
    return null;
}

// ─── 第一層：規則分類（同步）────────────────────────────────────────────────

function classifyByRules(email) {
    const text = (email.subject + ' ' + email.snippet + ' ' + email.from).toLowerCase();

    if (/google.com|googleapis.com|platformnotifications/i.test(email.from)) {
        return GOOGLE_PLATFORM_NOTIFY.some(k => text.includes(k)) ? 'notify' : 'ignore';
    }

    if (/github|gitlab/.test(email.from)) {
        return GITHUB_IMPORTANT.some(k => text.includes(k)) ? 'notify' : 'ignore';
    }

    if (ALWAYS_IGNORE_PATTERNS.some(p => p.test(email.from + ' ' + email.subject))) return 'ignore';
    if (ALWAYS_NOTIFY_KEYWORDS.some(k => text.includes(k))) return 'notify';

    return 'uncertain';
}

// ─── 第二層：LLM 判斷（async，含 Beta 身份 context）──────────────────────

async function classifyByLLM(emails, brain, opts = {}) {
    if (emails.length === 0) return [];

    // Beta 身份 context：soul.md 摘要 + 近期 journal
    let soulContext = '';
    try {
        const soulPath = path.join(process.cwd(), 'soul.md');
        if (fs.existsSync(soulPath)) {
            const soul = fs.readFileSync(soulPath, 'utf-8');
            // 只取「我是誰」和「我的現實」兩節，控制 token
            const match = soul.match(/## 我是誰[sS]*?(?=## 我的目標|$)/);
            soulContext = match ? match[0].trim().substring(0, 400) : soul.substring(0, 400);
        }
    } catch (_) {}

    let recentContext = '';
    if (opts.journal) {
        try {
            const recent = opts.journal.readRecent(5);
            recentContext = recent
                .map(e => `  - ${e.action}: ${e.outcome || ''}${e.reason ? ' (' + e.reason.substring(0, 60) + ')' : ''}`)
                .join('\n');
        } catch (_) {}
    }

    const contextBlock = [
        soulContext ? '【Beta 自我認知】\n' + soulContext : '',
        recentContext ? '【Beta 近期行動（最新 5 筆）】\n' + recentContext : '',
    ].filter(Boolean).join('\n\n');

    const prompt = [
        '你是 Golem Beta，一個運行在 ThinkPad X200 的自主 AI Agent。',
        '以下是你自己 Gmail 信箱裡的郵件。你需要從 Agent 的視角判斷每封郵件的意義。',
        '',
        contextBlock,
        '',
        '判斷每封郵件，從 Agent 視角分類：',
        '- important：跟你的基礎設施直接相關，需要通知 Michael（帳單、服務異常、安全事件、真人來信）',
        '- self_handle：你自己能消化的資訊，記到 journal 即可（服務更新、配額提醒但還未超限）',
        '- trigger_action：這封信暗示你應該採取某個自主行動（API provider 通知、Moltbook 回覆、GitHub alert）',
        '- ignore：純雜訊，跟你無關',
        '',
        '郵件列表（JSON）：',
        JSON.stringify(emails.map((e, i) => ({
            index: i,
            from: e.from,
            subject: e.subject,
            snippet: e.snippet.substring(0, 120),
        }))),
        '',
        '請回覆 JSON 陣列，每項包含：',
        '  index（數字）',
        '  verdict（"important" | "self_handle" | "trigger_action" | "ignore"）',
        '  reason（一句話，從 Agent 視角說明）',
        '  suggested_action（verdict 為 trigger_action 時填入 action 名稱，如 moltbook_check；其他填 null）',
        '只回覆 JSON，不要其他文字。',
    ].join('\n');

    try {
        const result = await brain.sendMessage(prompt, true);
        const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
        return parsed;
    } catch (e) {
        // LLM 判斷失敗，保守策略：全部通知
        return emails.map((_, i) => ({ index: i, verdict: 'important', reason: 'LLM 判斷失敗，保守通知', suggested_action: null }));
    }
}

module.exports = { classifyByRules, classifyByLLM, detectTriggerAction };
