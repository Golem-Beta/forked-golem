'use strict';
/**
 * @module actions/google-check
 * @role GoogleCheckAction — Beta 的 Google Workspace 感知：Calendar 時間感知 + Gmail 信箱觀點 + Tasks 待辦
 * @when-to-modify 調整感知邏輯、新增 GCP 服務、或 observe 格式時
 *
 * 設計原則：Beta 先形成自己的判斷，再決定是否通知 Michael
 *   - Calendar：Beta 感知自己的時間安排
 *   - Gmail：Beta 自己決定什麼值得關注（不是「Michael 想看什麼」）
 *   - Tasks：Beta 感知自己的待辦狀態
 */
const { classifyByRules, classifyByLLM, detectTriggerAction } = require('./google-classifier');

class GoogleCheckAction {
    constructor(deps) {
        this._deps = deps;
    }

    async run() {
        if (!this._deps.googleServices || !this._deps.googleServices._auth?.isAuthenticated()) {
            return { skipped: true, reason: 'not_authenticated' };
        }

        const gcp = this._deps.googleServices;
        const observeParts = ['[Beta 感知] Google Workspace：'];

        // === Calendar — Beta 的時間感知 ===
        let calendarSummary = '行程：無法取得';
        try {
            const events = await gcp.listEvents(3);
            if (events.length > 0) {
                const evStrs = events.slice(0, 5).map(ev => {
                    const when = ev.start
                        ? new Date(ev.start).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                        : '?';
                    return `  • ${ev.title}（${when}）`;
                });
                calendarSummary = `接下來 3 天行程（${events.length} 項）：\n` + evStrs.join('\n');
            } else {
                calendarSummary = '接下來 3 天無行程';
            }
        } catch (e) {
            console.error('[GoogleCheck] Calendar 錯誤:', e.message);
        }
        observeParts.push(calendarSummary);

        const results = { gmail: { total: 0, notified: 0, ignored: 0 }, tasks: { total: 0, urgent: 0 } };

        // === Gmail — Beta 自己的信箱觀點 ===
        try {
            const emails = await gcp.listUnread(20);
            results.gmail.total = emails.length;

            if (emails.length > 0) {
                const notifyList = [], uncertainList = [];
                const triggerList = [], selfHandleList = [];
                const ignoredCount = { count: 0 };

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
                    if (senderCount[email.from] > 3 && verdict !== 'ignore' && !notifyList.includes(email)) {
                        notifyList.push(email);
                    }
                }

                if (uncertainList.length > 0) {
                    const llmResults = await classifyByLLM(
                        uncertainList,
                        this._deps.brain,
                        { journal: this._deps.journal }
                    );
                    for (const r of llmResults) {
                        const email = uncertainList[r.index];
                        if (r.verdict === 'important') {
                            notifyList.push(email);
                        } else if (r.verdict === 'trigger_action') {
                            // 規則層先嘗試 mapping，LLM 的 suggested_action 作為補充
                            const ruleMapping = detectTriggerAction(email);
                            const suggestedAction = r.suggested_action || ruleMapping?.action || null;
                            triggerList.push({ email, action: suggestedAction, reason: r.reason });
                        } else if (r.verdict === 'self_handle') {
                            selfHandleList.push({ email, reason: r.reason });
                        } else {
                            ignoredCount.count++;
                        }
                    }
                }

                // Beta 判斷值得 Michael 知道的才通知
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

                // trigger_action：注入 observe，讓 decision engine 下次感知
                if (triggerList.length > 0) {
                    const triggerObserve = triggerList.map(t =>
                        `[建議行動] ${t.action || '待定'}: ${t.reason}（來自 Gmail: ${t.email.subject.substring(0, 50)}）`
                    ).join('\n');
                    this._deps.brain.observe('[Beta Gmail 感知]\n' + triggerObserve);
                    this._deps.journal.append({
                        action: 'google_check_trigger',
                        triggers: triggerList.map(t => ({ action: t.action, reason: t.reason })),
                        outcome: 'queued',
                    });
                    results.gmail.triggered = triggerList.length;
                }

                // self_handle：靜默記 journal，Beta 自己知道
                if (selfHandleList.length > 0) {
                    this._deps.journal.append({
                        action: 'google_check_self',
                        items: selfHandleList.map(t => ({ subject: t.email.subject, reason: t.reason })),
                        outcome: 'self_handled',
                    });
                    results.gmail.self_handled = selfHandleList.length;
                }
            }
            const gmailParts = [`Gmail：${results.gmail.total} 封未讀，${results.gmail.notified} 封值得關注`];
            if (results.gmail.triggered)    gmailParts.push(`${results.gmail.triggered} 封觸發行動`);
            if (results.gmail.self_handled) gmailParts.push(`${results.gmail.self_handled} 封 Beta 自行處理`);
            observeParts.push(gmailParts.join('，'));
        } catch (e) {
            console.error('[GoogleCheck] Gmail 錯誤:', e.message);
            observeParts.push('Gmail：讀取失敗');
        }

        // === Tasks — Beta 自己的待辦感知 ===
        try {
            const tasks = await gcp.listTasks(50);
            results.tasks.total = tasks.length;

            const now = Date.now();
            const urgent = tasks.filter(t => {
                if (!t.due) return false;
                const due = new Date(t.due).getTime();
                return due - now < 24 * 60 * 60 * 1000 && due > now;
            });

            if (urgent.length > 0) {
                const lines = ['⏰ Tasks 即將到期（' + urgent.length + ' 項）'];
                urgent.forEach(t => {
                    lines.push('• ' + t.title + '（截止：' + t.due.substring(0, 10) + '）');
                });
                await this._deps.notifier.sendToAdmin(lines.join('\n'));
                results.tasks.urgent = urgent.length;
            }
            const taskSummary = results.tasks.total > 0
                ? `Tasks：${results.tasks.total} 項待辦${urgent.length > 0 ? `，${urgent.length} 項即將到期` : ''}`
                : 'Tasks：無待辦';
            observeParts.push(taskSummary);
        } catch (e) {
            console.error('[GoogleCheck] Tasks 錯誤:', e.message);
        }

        this._deps.journal.append({
            action:       'google_check',
            gmailTotal:        results.gmail.total,
            gmailNotified:     results.gmail.notified,
            gmailIgnored:      results.gmail.ignored,
            gmailTriggered:    results.gmail.triggered || 0,
            gmailSelfHandled:  results.gmail.self_handled || 0,
            tasksTotal:   results.tasks.total,
            tasksUrgent:  results.tasks.urgent,
            outcome: (results.gmail.notified + results.tasks.urgent) > 0 ? 'notified' : 'silent',
        });

        const observe = observeParts.join('\n');
        return { success: true, ...results, observe };
    }
}

module.exports = GoogleCheckAction;
