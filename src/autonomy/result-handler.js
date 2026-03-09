/**
 * @module result-handler
 * @role 統一處理 ActionResult 的 side effects
 *
 *   1. failureTracker.record()    — 失敗追蹤
 *   2. brain.memorize()           — 長期記憶寫入（result.memorize 有值時）
 *   3. brain.observe()            — 即時感知注入 chatHistory（result.observe 有值時）
 *   4. side effect 路由           — result.needsReflection → performSelfReflection()
 *   5. driveDoc                   — 寫入 Google Drive（result.driveDoc 有值時，非阻塞）
 *   6. sheetsRow                  — 追加 Google Sheets 列（result.sheetsRow 有值時，非阻塞）
 *   7. calendarPlan               — 建立 Calendar 未來規劃事件（result.calendarPlan 有值時，非阻塞）
 *
 * 呼叫方：FreeWillRunner.run()（在 switch case 後統一交給此處）
 */

class ResultHandler {
    /**
     * @param {object} deps
     * @param {object} deps.brain           - GolemBrain
     * @param {object} deps.failureTracker  - FailureTracker
     * @param {object} deps.actions         - ActionRunner
     * @param {object} [deps.googleServices] - GoogleServices（可選，null-safe）
     */
    constructor({ brain, failureTracker, actions, googleServices = null }) {
        this.brain = brain;
        this.failureTracker = failureTracker;
        this.actions = actions;
        this._gcp = googleServices;
    }

    async handle(result) {
        if (!result) return;

        // 1. 失敗追蹤
        await this.failureTracker.record(result);

        // 2. 長期記憶寫入
        if (result.memorize) {
            const { text, metadata } = result.memorize;
            await this.brain.memorize(text, metadata || {});
        }

        // 3. 即時感知注入（不觸發 LLM）
        if (result.observe) {
            this.brain.observe(result.observe);
        }

        // 4. health_check → self_reflection side effect
        if (result.needsReflection) {
            console.log('🏥 [ResultHandler] 偵測到 needsReflection，5 分鐘後觸發 self_reflection');
            const needsReflection = result.needsReflection;
            setTimeout(
                () => this.actions.performSelfReflection({ trigger: 'health_check', ...needsReflection }),
                5 * 60 * 1000
            );
        }

        // 5-7: GCP side effects（非阻塞，失敗靜默）
        if (this._gcp && this._gcp._auth?.isAuthenticated()) {
            if (result.driveDoc) {
                this._writeDriveDoc(result.driveDoc).catch(e =>
                    console.warn('[ResultHandler] Drive Doc 寫入失敗:', e.message)
                );
            }
            if (result.sheetsRow) {
                this._appendSheetsRow(result.sheetsRow).catch(e =>
                    console.warn('[ResultHandler] Sheets 追加失敗:', e.message)
                );
            }
            if (result.calendarPlan) {
                this._createCalendarPlan(result.calendarPlan).catch(e =>
                    console.warn('[ResultHandler] Calendar 規劃失敗:', e.message)
                );
            }
        }
    }

    // 寫入 Drive 文件（find/create 資料夾 → upload/update 檔案）
    async _writeDriveDoc({ title, content, mimeType = 'text/plain', folder }) {
        let folderId = null;
        if (folder) {
            const existing = await this._gcp.findFile({ name: folder });
            folderId = existing?.id || (await this._gcp.createFolder({ name: folder })).id;
        }
        const existingFile = await this._gcp.findFile({ name: title, folderId });
        if (existingFile) {
            await this._gcp.updateFile({ fileId: existingFile.id, content, mimeType });
        } else {
            await this._gcp.uploadFile({ name: title, content, mimeType, folderId });
        }
        console.log(`[ResultHandler] Drive 已寫入：${folder ? folder + '/' : ''}${title}`);
    }

    // 追加 Sheets 列（getOrCreate 試算表 → appendRow）
    async _appendSheetsRow({ sheetTitle, values }) {
        const sheetId = await this._gcp.getOrCreateSheet(sheetTitle);
        // values 可以是 single row (array) 或 multiple rows (array of arrays)
        const rows = Array.isArray(values[0]) ? values : [values];
        for (const row of rows) {
            await this._gcp.appendRow(sheetId, row);
        }
        console.log(`[ResultHandler] Sheets 已追加 ${rows.length} 列至：${sheetTitle}`);
    }

    // 建立 Calendar 未來規劃事件（Beta 自己的行程）
    async _createCalendarPlan({ title, daysAhead = 7, description = '' }) {
        const start = new Date(Date.now() + daysAhead * 86400000);
        const end   = new Date(start.getTime() + 30 * 60 * 1000); // 30 分鐘
        await this._gcp.createEvent({
            title:       `[Beta] ${title}`,
            start:       start.toISOString(),
            end:         end.toISOString(),
            description,
        });
        console.log(`[ResultHandler] Calendar 規劃已建立：${title}（${daysAhead} 天後）`);
    }
}

module.exports = { ResultHandler };
