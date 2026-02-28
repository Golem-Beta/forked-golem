'use strict';
/**
 * @module actions/google-check
 * @role GoogleCheckAction — 智慧監控 Gmail + Tasks，兩層過濾後選擇性通知主人
 * @when-to-modify 調整過濾關鍵字、LLM 判斷 prompt、或 journal 欄位時
 *
 * deps 需求：journal, notifier, brain, googleServices
 * 設計原則：Gmail 是 Golem 的通知收件箱，絕大多數信不打擾主人
 */

// ─── 第一層：規則分類（同步，不消耗 token）────────────────────────────────

const ALWAYS_NOTIFY_KEYWORDS = [
    '帳單', '付款', '到期', '逾期', 'billing', 'payment', 'invoice', 'overdue',
    '錯誤', '警告', '異常', 'error', 'warning', 'alert', 'critical', 'failed',
    'unauthorized', 'breach', 'intrusion',
    '憑證', 'certificate', 'ssl', 'tls', 'expired',
    '配額', 'quota', 'limit exceeded', 'rate limit',
    'shut down', 'deletion', 'suspended', 'terminated',
];

// Golem 自己帳號的例行通知，不打擾主人
const ALWAYS_IGNORE_PATTERNS = [
    // Google 安全性快訊（OAuth 授權、新登入通知）— Golem 自己操作產生的
    /accounts.google.com/i,
    /no-reply@accounts.google.com/i,
    // 行銷、電子報、促銷
    /newsletter|marketing|promo|unsubscribe/i,
    // 社群媒體例行推播
    /follow-suggestions@|posts-recap@|instagram.com/i,
    // 歡迎信、onboarding
    /welcome@|support@buymeacoffee/i,
    // 其他 noreply（需在 ignore patterns 之後，避免擋掉重要 noreply）
    /notifications?@(?!github)/i,
];

// Google 平台通知：只有真正影響服務的才通知
const GOOGLE_PLATFORM_NOTIFY = [
    'shut down', 'deletion warning', 'suspended', 'terminated',
    'billing', 'payment', 'quota exceeded',
];

const GITHUB_IMPORTANT = ['security alert', 'failed', 'vulnerability', 'dependabot'];

function classifyByRules(email) {
    const text = (email.subject + ' ' + email.snippet + ' ' + email.from).toLowerCase();

    // Google platform 通知：精確判斷，不靠 security 關鍵字
    if (/google.com|googleapis.com|platformnotifications/i.test(email.from)) {
        return GOOGLE_PLATFORM_NOTIFY.some(k => text.includes(k)) ? 'notify' : 'ignore';
    }

    // GitHub：只有真正重要的
    if (/github|gitlab/.test(email.from)) {
        return GITHUB_IMPORTANT.some(k => text.includes(k)) ? 'notify' : 'ignore';
    }

    // 明確 ignore patterns
    if (ALWAYS_IGNORE_PATTERNS.some(p => p.test(email.from + ' ' + email.subject))) return 'ignore';

    // 明確 notify keywords（已移除 'security'，避免 Google 安全快訊誤觸發）
    if (ALWAYS_NOTIFY_KEYWORDS.some(k => text.includes(k))) return 'notify';

    return 'uncertain';
}

// ─── 第二層：LLM 判斷（只處理 uncertain）────────────────────────────────

async function classifyByLLM(emails, brain) {
    if (emails.length === 0) return [];
    const prompt = [
        '以下是幾封電子郵件的摘要資訊。',
        '請判斷每封郵件對一個自主 AI Agent 的重要性。',
        '只關注真正需要 Agent 採取行動或通知其主人的郵件。',
        '',
        '判斷標準：',
        '- important：真人來信、需要回覆、服務異常、費用問題、安全事件',
        '- ignore：自動通知、行銷、系統報告、例行更新',
        '',
        '郵件列表（JSON）：',
        JSON.stringify(emails.map((e, i) => ({
            index: i,
            from: e.from,
            subject: e.subject,
            snippet: e.snippet.substring(0, 100),
        }))),
        '',
        '請回覆 JSON 陣列，每項包含 index 和 verdict（"important" 或 "ignore"）。',
        '只回覆 JSON，不要其他文字。',
    ].join('\n');
    try {
        const result = await brain.sendMessage(prompt, true);
        const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
        return parsed;
    } catch (e) {
        // LLM 判斷失敗，保守策略：全部通知
        return emails.map((_, i) => ({ index: i, verdict: 'important' }));
    }
}

// ─── GoogleCheckAction ────────────────────────────────────────────────────

class GoogleCheckAction {
    constructor(deps) {
        this._deps = deps;
    }

    async run() {
        if (!this._deps.googleServices || !this._deps.googleServices._auth?.isAuthenticated()) {
            return { skipped: true, reason: 'not_authenticated' };
        }

        const results = { gmail: { total: 0, notified: 0, ignored: 0 }, tasks: { total: 0, urgent: 0 } };

        // === Gmail ===
        try {
            const emails = await this._deps.googleServices.listUnread(20);
            results.gmail.total = emails.length;

            if (emails.length > 0) {
                const notifyList = [], uncertainList = [];
                const ignoredCount = { count: 0 };

                // 批量異常偵測：統計同寄件人數量
                const senderCount = {};
                emails.forEach(e => { senderCount[e.from] = (senderCount[e.from] || 0) + 1; });

                for (const email of emails) {
                    const verdict = classifyByRules(email);
                    if (verdict === 'notify') {
                        notifyList.push(email);
                    } else if (verdict === 'uncertain') {
                        uncertainList.push(email);
                    } else {
                        ignoredCount.count++;
                    }
                    // 批量異常：同寄件人 > 3 封且非已知 ignore
                    if (senderCount[email.from] > 3 && verdict !== 'ignore' && !notifyList.includes(email)) {
                        notifyList.push(email);
                    }
                }

                // 第二層：LLM 判斷 uncertain
                if (uncertainList.length > 0) {
                    const llmResults = await classifyByLLM(uncertainList, this._deps.brain);
                    for (const r of llmResults) {
                        if (r.verdict === 'important') notifyList.push(uncertainList[r.index]);
                        else ignoredCount.count++;
                    }
                }

                if (notifyList.length > 0) {
                    const lines = ['📬 Gmail 重要通知（' + notifyList.length + ' 封）'];
                    notifyList.forEach(e => {
                        lines.push('');
                        lines.push('• ' + e.subject);
                        lines.push('  寄件人：' + e.from);
                        lines.push('  摘要：' + e.snippet.substring(0, 80));
                    });
                    await this._deps.notifier.sendToAdmin(lines.join('\n'));
                    results.gmail.notified = notifyList.length;
                }
                results.gmail.ignored = ignoredCount.count;
            }
        } catch (e) {
            console.error('[GoogleCheck] Gmail 錯誤:', e.message);
        }

        // === Tasks ===
        try {
            const tasks = await this._deps.googleServices.listTasks(50);
            results.tasks.total = tasks.length;

            const now = Date.now();
            const urgent = tasks.filter(t => {
                if (!t.due) return false;
                const due = new Date(t.due).getTime();
                return due - now < 24 * 60 * 60 * 1000 && due > now;
            });

            if (urgent.length > 0) {
                const lines = ['⏰ Golem Tasks 即將到期（' + urgent.length + ' 項）'];
                urgent.forEach(t => {
                    lines.push('• ' + t.title + '（截止：' + t.due.substring(0, 10) + '）');
                });
                await this._deps.notifier.sendToAdmin(lines.join('\n'));
                results.tasks.urgent = urgent.length;
            }
        } catch (e) {
            console.error('[GoogleCheck] Tasks 錯誤:', e.message);
        }

        // === Journal ===
        this._deps.journal.append({
            action: 'google_check',
            gmailTotal: results.gmail.total,
            gmailNotified: results.gmail.notified,
            gmailIgnored: results.gmail.ignored,
            tasksTotal: results.tasks.total,
            tasksUrgent: results.tasks.urgent,
            outcome: (results.gmail.notified + results.tasks.urgent) > 0 ? 'notified' : 'silent',
        });

        return { success: true, ...results };
    }
}

module.exports = GoogleCheckAction;
