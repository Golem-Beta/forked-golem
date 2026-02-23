/**
 * 📓 JournalManager — 經驗日誌 CRUD + 全文索引
 * 
 * 零外部依賴（只用 fs, path, flexsearch）。
 * 所有 journal 相關的狀態和邏輯集中在這裡。
 */
const fs = require('fs');
const path = require('path');
const { Index: FlexIndex } = require('flexsearch');

class JournalManager {
    constructor() {
        this.journalPath = path.join(process.cwd(), 'memory', 'journal.jsonl');
        this._index = null;
        this._entries = [];
        this._ensureSaneSize();   // 啟動時檢查，防止爆檔
        this.rebuildIndex();
    }

    /**
     * 防爆：journal 超過 2MB 就截斷保留最後 500 行
     */
    _ensureSaneSize() {
        try {
            if (!fs.existsSync(this.journalPath)) return;
            const stat = fs.statSync(this.journalPath);
            if (stat.size > 2 * 1024 * 1024) {
                console.warn('[Journal] ⚠️ 檔案過大 (' + (stat.size / 1024 / 1024).toFixed(1) + 'MB)，截斷保留最後 500 行');
                const buf = fs.readFileSync(this.journalPath, 'utf-8');
                const lines = buf.trim().split('\n');
                const kept = lines.slice(-500);
                fs.writeFileSync(this.journalPath, kept.join('\n') + '\n');
                console.log('[Journal] 截斷完成: ' + lines.length + ' → ' + kept.length + ' 行');
            }
        } catch (e) {
            console.warn('[Journal] _ensureSaneSize 失敗:', e.message);
        }
    }

    // === 全文索引 ===

    rebuildIndex() {
        try {
            this._index = new FlexIndex({ tokenize: 'forward', resolution: 5 });
            this._entries = [];
            if (!fs.existsSync(this.journalPath)) return;
            const lines = fs.readFileSync(this.journalPath, 'utf-8').trim().split('\n');
            lines.forEach((line, i) => {
                try {
                    const entry = JSON.parse(line);
                    this._entries.push(entry);
                    this._index.add(i, this._toSearchText(entry));
                } catch {}
            });
            console.log('🔍 [JournalIndex] 索引完成: ' + this._entries.length + ' 條');
        } catch (e) {
            console.warn('🔍 [JournalIndex] 建立失敗:', e.message);
            this._index = null;
            this._entries = [];
        }
    }

    search(query, limit = 5) {
        if (!this._index || !query) return [];
        try {
            const ids = this._index.search(query, { limit });
            return ids.map(id => this._entries[id]).filter(Boolean);
        } catch (e) {
            console.warn('🔍 [JournalIndex] 搜尋失敗:', e.message);
            return [];
        }
    }

    // === CRUD ===

    readRecent(n = 10) {
        try {
            if (!fs.existsSync(this.journalPath)) return [];
            // 安全檢查：超過 5MB 直接拒絕整檔讀取，用 tail 方式
            const stat = fs.statSync(this.journalPath);
            if (stat.size > 5 * 1024 * 1024) {
                console.warn('[Journal] 檔案過大 (' + (stat.size / 1024 / 1024).toFixed(1) + 'MB)，執行截斷...');
                this._ensureSaneSize();
            }
            const lines = fs.readFileSync(this.journalPath, 'utf-8').trim().split('\n');
            return lines.slice(-n).map(l => {
                try { return JSON.parse(l); } catch { return null; }
            }).filter(Boolean);
        } catch (e) {
            console.warn('[Journal] 讀取失敗:', e.message);
            return [];
        }
    }

    /**
     * ReAct Loop 結束時，寫入 loop-level 執行摘要
     * entry: { action, loop_steps, loop_success, loop_failed, step_summary, skipped_cmds, outcome, duration_ms }
     */
    appendLoopResult(entry) {
        this.append(entry);
    }

    append(entry) {
        try {
            const memDir = path.dirname(this.journalPath);
            if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
            const record = { ts: new Date().toISOString(), ...entry };
            fs.appendFileSync(this.journalPath, JSON.stringify(record) + '\n');
            console.log(`📓 [Journal] 記錄: ${entry.action} → ${entry.outcome || 'done'}`);
            if (this._index) {
                this._index.add(this._entries.length, this._toSearchText(record));
                this._entries.push(record);
            }
        } catch (e) {
            console.warn('[Journal] 寫入失敗:', e.message);
        }
    }

    // === 統計 ===

    buildStats() {
        try {
            if (!fs.existsSync(this.journalPath)) return '(無 journal 資料)';
            const lines = fs.readFileSync(this.journalPath, 'utf-8').trim().split('\n');
            const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
            if (all.length === 0) return '(無 journal 資料)';

            const actionCounts = {};
            const outcomeMap = {};
            let droppedProposals = [];
            let deployedProposals = [];
            let repoCount = 0;
            let firstTs = all[0].ts, lastTs = all[all.length - 1].ts;

            for (const j of all) {
                actionCounts[j.action] = (actionCounts[j.action] || 0) + 1;
                const key = j.action + ':' + (j.outcome || '?');
                outcomeMap[key] = (outcomeMap[key] || 0) + 1;
                if (j.action === 'github_explore' && j.repo) repoCount++;
                if (j.action === 'self_reflection_feedback' && j.outcome === 'dropped') {
                    droppedProposals.push(j.description || '未知');
                }
                if (j.action === 'self_reflection_feedback' && j.outcome === 'deployed') {
                    deployedProposals.push(j.description || '未知');
                }
            }

            const parts = [];
            parts.push('總記錄: ' + all.length + ' 條 (' + firstTs.substring(0,10) + ' ~ ' + lastTs.substring(0,10) + ')');

            const actionStr = Object.entries(actionCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => k + '=' + v)
                .join(', ');
            parts.push('行動分佈: ' + actionStr);

            if (repoCount > 0) parts.push('已探索 GitHub repo: ' + repoCount + ' 個');

            const reflTotal = actionCounts['self_reflection'] || 0;
            const reflSuccess = (outcomeMap['self_reflection:proposed'] || 0) + (outcomeMap['self_reflection:skill_created'] || 0);
            if (reflTotal > 0) {
                parts.push('self_reflection: ' + reflTotal + ' 次, 成功產出 ' + reflSuccess + ' 次');
            }

            const socialSent = outcomeMap['spontaneous_chat:sent'] || 0;
            const socialReplied = outcomeMap['social_feedback:replied'] || 0;
            const socialNoReply = outcomeMap['social_feedback:no_response'] || 0;
            if (socialSent > 0) {
                parts.push('社交互動: 發起 ' + socialSent + ' 次, 老哥回覆 ' + socialReplied + ' 次, 無回應 ' + socialNoReply + ' 次');
            }

            if (deployedProposals.length > 0) {
                parts.push('✅ 老哥接受的提案: ' + deployedProposals.slice(-3).join('; '));
            }
            if (droppedProposals.length > 0) {
                parts.push('⚠️ 老哥拒絕的提案: ' + droppedProposals.slice(-3).join('; '));
            }

            return parts.join('\n');
        } catch (e) {
            return '(journal 統計失敗: ' + e.message + ')';
        }
    }

    hasActionToday(actionType) {
        const today = new Date().toISOString().slice(0, 10);
        const recent = this.readRecent(20);
        return recent.some(j => j.action === actionType && j.ts && j.ts.startsWith(today));
    }

    // === 內部 ===

    _toSearchText(entry) {
        return [
            entry.action, entry.outcome, entry.topic, entry.context,
            entry.preview, entry.note, entry.repo, entry.reply_preview,
            entry.error, entry.learning
        ].filter(Boolean).join(' ');
    }
}

module.exports = JournalManager;
