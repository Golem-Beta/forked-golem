/**
 * @module pending-patches
 * @role 管理待審 patch 提案的持久化狀態
 */
const fs = require('fs');
const path = require('path');

class PendingPatches {
    constructor() {
        this.filePath = path.join(process.cwd(), 'memory', 'pending-patches.json');
    }

    _read() {
        try {
            if (!fs.existsSync(this.filePath)) return [];
            return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        } catch (e) { return []; }
    }

    _write(patches) {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(patches, null, 2));
    }

    // 新增提案，回傳 id
    add({ testFile, target, name, description, proposalType, diffPreview }) {
        const patches = this._read();
        const id = 'pp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        patches.push({
            id,
            status: 'pending',
            testFile,
            target,
            name,
            description: description || '',
            proposalType: proposalType || 'unknown',
            diffPreview: diffPreview || '',
            createdAt: new Date().toISOString(),
            lastNotifiedAt: new Date().toISOString(),
        });
        this._write(patches);
        return id;
    }

    // 取得所有 pending
    listPending() {
        return this._read().filter(p => p.status === 'pending');
    }

    // 用 id 取得單一提案
    getById(id) {
        return this._read().find(p => p.id === id) || null;
    }

    // 標記為 deployed / dropped
    resolve(id, status) {
        const patches = this._read();
        const p = patches.find(p => p.id === id);
        if (p) {
            p.status = status;
            p.resolvedAt = new Date().toISOString();
        }
        this._write(patches);
    }

    // 更新 lastNotifiedAt（避免重複打擾）
    updateNotified(id) {
        const patches = this._read();
        const p = patches.find(p => p.id === id);
        if (p) p.lastNotifiedAt = new Date().toISOString();
        this._write(patches);
    }

    // 計算 pending 數量
    pendingCount() {
        return this._read().filter(p => p.status === 'pending').length;
    }
}

module.exports = PendingPatches;
