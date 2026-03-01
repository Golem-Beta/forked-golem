/**
 * @module codebase-indexer
 * @role 靜態程式碼符號掃描與索引生成（AST-based）
 * @when-to-modify 調整掃描規則、AST 解析邏輯、或索引架構時
 *
 * Public API:
 *   CodebaseIndexer.scan(rootDir)              → index object
 *   CodebaseIndexer.lookup(index, symbol)      → { file, lineStart, lineEnd, ... } | null
 *   CodebaseIndexer.extractSubmodules(index, dirPattern) → Array<{ key, modPath, filePath, classes, exports }>
 *   CodebaseIndexer.save(index, outPath)
 *   CodebaseIndexer.load(inPath)               → index object
 *   CodebaseIndexer.isStale(index)             → boolean  (git rev-parse HEAD 比對)
 *   CodebaseIndexer.generateSummary(index)     → string   (~200 tokens)
 *   CodebaseIndexer.rebuild(rootDir)           → index object  (掃描並寫入 data/codebase-index.json)
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_INDEX_PATH = path.join(process.cwd(), 'data', 'codebase-index.json');
const INDEX_VERSION      = '1.0';

class CodebaseIndexer {

    // ── Public API ────────────────────────────────────────────────────────

    /**
     * 掃描 src/**\/*.js（排除 *.test.js），生成索引物件
     * @param {string} rootDir
     * @returns {object} 索引物件
     */
    static scan(rootDir = process.cwd()) {
        const acorn  = require('acorn');
        const srcDir = path.join(rootDir, 'src');
        const files  = CodebaseIndexer._collectFiles(srcDir);

        const index = {
            version:     INDEX_VERSION,
            generatedAt: new Date().toISOString(),
            gitHead:     CodebaseIndexer._gitHead(),
            symbols: {
                files:             {},
                classMethods:      {},
                topLevelFunctions: {},
                moduleExports:     {},
            },
            metadata: {
                totalFiles:      0,
                totalClasses:    0,
                totalMethods:    0,
                totalFunctions:  0,
                scanDuration_ms: 0,
            },
        };

        const t0 = Date.now();
        for (const filePath of files) {
            const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
            try {
                CodebaseIndexer._parseFile(acorn, filePath, rel, index);
            } catch (e) {
                console.warn(`⚠️ [Indexer] 解析失敗 ${rel}: ${e.message}`);
            }
        }

        const classNames = new Set(Object.values(index.symbols.classMethods).map(m => m.className));
        index.metadata.totalFiles     = Object.keys(index.symbols.files).length;
        index.metadata.totalClasses   = classNames.size;
        index.metadata.totalMethods   = Object.keys(index.symbols.classMethods).length;
        index.metadata.totalFunctions = Object.keys(index.symbols.topLevelFunctions).length;
        index.metadata.scanDuration_ms = Date.now() - t0;

        return index;
    }

    /**
     * 查詢 symbol，格式："ClassName.methodName" 或 "topLevelFunctionName"
     * @param {object} index
     * @param {string} symbolName
     * @returns {{ file, lineStart, lineEnd, ... } | null}
     */
    static lookup(index, symbolName) {
        if (!index || !symbolName) return null;
        if (symbolName.includes('.')) {
            return index.symbols.classMethods[symbolName] || null;
        }
        // topLevelFunctions 優先
        const fn = index.symbols.topLevelFunctions[symbolName];
        if (fn) return fn;
        // 再查 moduleExports named keys
        for (const [filePath, exp] of Object.entries(index.symbols.moduleExports)) {
            if (exp.namedExports && exp.namedExports[symbolName]) {
                return { file: filePath, ...exp.namedExports[symbolName] };
            }
        }
        return null;
    }

    /**
     * 提取特定目錄下的子模組清單
     * @param {object} index
     * @param {string} dirPattern - 如 "src/autonomy/" 或 "src/autonomy/**"
     * @returns {Array<{ key, modPath, filePath, classes, exports }>}
     */
    static extractSubmodules(index, dirPattern) {
        const prefix = dirPattern.replace(/\*.*$/, ''); // 'src/autonomy/**' → 'src/autonomy/'
        const result = [];
        for (const [filePath, info] of Object.entries(index.symbols.files)) {
            if (!filePath.startsWith(prefix)) continue;
            const rest = filePath.slice(prefix.length).replace(/\.js$/, '');
            result.push({
                key:      rest,
                modPath:  filePath.replace(/\.js$/, ''),
                filePath,
                classes:  info.classes,
                exports:  index.symbols.moduleExports[filePath] || null,
            });
        }
        return result.sort((a, b) => a.key.localeCompare(b.key));
    }

    /**
     * 將索引寫入磁碟
     * @param {object} index
     * @param {string} outPath
     */
    static save(index, outPath = DEFAULT_INDEX_PATH) {
        const dir = path.dirname(outPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(index, null, 2), 'utf8');
    }

    /**
     * 從磁碟讀取索引（不存在時拋錯）
     * @param {string} inPath
     * @returns {object}
     */
    static load(inPath = DEFAULT_INDEX_PATH) {
        return JSON.parse(fs.readFileSync(inPath, 'utf8'));
    }

    /**
     * 用 git rev-parse HEAD 比對，檢查索引是否過期
     * @param {object} index
     * @returns {boolean}
     */
    static isStale(index) {
        try {
            const current = CodebaseIndexer._gitHead();
            return !index || index.gitHead !== current;
        } catch (e) {
            return true; // git 不可用 → 保守視為過期
        }
    }

    /**
     * 生成 codebase 結構摘要（~200 tokens，供 decision context 注入）
     * @param {object} index
     * @returns {string}
     */
    static generateSummary(index) {
        const m = index.metadata;
        const lines = [
            '【Codebase 結構摘要】',
            `檔案：${m.totalFiles}　Class：${m.totalClasses}　方法：${m.totalMethods}　函式：${m.totalFunctions}`,
        ];

        // 核心模組（src/*.js）
        const topFiles = Object.keys(index.symbols.files)
            .filter(f => /^src\/[^/]+\.js$/.test(f))
            .sort();
        if (topFiles.length > 0) {
            lines.push('', '核心模組：');
            for (const f of topFiles) {
                const info = index.symbols.files[f];
                const cls  = info.classes.length > 0 ? `（${info.classes.join('/')}）` : '';
                lines.push(`  ${path.basename(f, '.js')}${cls}`);
            }
        }

        // autonomy 子模組摘要（不含 actions/）
        const autonomyFiles = Object.keys(index.symbols.files)
            .filter(f => f.startsWith('src/autonomy/') && !f.includes('/actions/'))
            .sort();
        if (autonomyFiles.length > 0) {
            lines.push('', 'autonomy/ 子模組：');
            for (const f of autonomyFiles) {
                const info = index.symbols.files[f];
                const cls  = info.classes.length > 0 ? `（${info.classes[0]}）` : '';
                lines.push(`  ${path.basename(f, '.js')}${cls}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * 掃描並寫入索引（獨立執行入口 + health_check 呼叫點）
     * @param {string} rootDir
     * @returns {object} 生成的索引
     */
    static rebuild(rootDir = process.cwd()) {
        console.log('🔍 [Indexer] 掃描 src/**/*.js...');
        const index   = CodebaseIndexer.scan(rootDir);
        const outPath = path.join(rootDir, 'data', 'codebase-index.json');
        CodebaseIndexer.save(index, outPath);
        console.log(`✅ [Indexer] ${index.metadata.totalFiles} 檔，${index.metadata.totalMethods} 方法，耗時 ${index.metadata.scanDuration_ms}ms`);
        return index;
    }

    // ── Private helpers ───────────────────────────────────────────────────

    static _gitHead() {
        return execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();
    }

    static _collectFiles(srcDir) {
        const files = [];
        const walk = (dir) => {
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
            for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    walk(full);
                } else if (e.isFile() && e.name.endsWith('.js') && !e.name.endsWith('.test.js')) {
                    files.push(full);
                }
            }
        };
        walk(srcDir);
        return files;
    }

    static _parseFile(acorn, filePath, relPath, index) {
        const code = fs.readFileSync(filePath, 'utf8');
        const lines = code.split('\n').length;

        let ast;
        try {
            ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script' });
        } catch (e) {
            throw new Error(`AST 解析失敗: ${e.message}`);
        }

        const fileEntry = { path: relPath, lines, classes: [], functions: [] };
        index.symbols.files[relPath] = fileEntry;

        const exportsEntry = { type: 'unknown', named: [], default: null, namedExports: {} };

        for (const node of ast.body) {
            if (node.type === 'ClassDeclaration' && node.id) {
                CodebaseIndexer._extractClass(node, relPath, code, fileEntry, index);

            } else if (node.type === 'FunctionDeclaration' && node.id) {
                const name = node.id.name;
                fileEntry.functions.push(name);
                index.symbols.topLevelFunctions[name] = {
                    file: relPath, functionName: name,
                    isAsync:   !!node.async,
                    lineStart: CodebaseIndexer._lineOf(code, node.start),
                    lineEnd:   CodebaseIndexer._lineOf(code, node.end),
                };

            } else if (node.type === 'VariableDeclaration') {
                for (const decl of node.declarations) {
                    if (!decl.id || decl.id.type !== 'Identifier' || !decl.init) continue;
                    const t = decl.init.type;
                    if (t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
                        const name = decl.id.name;
                        fileEntry.functions.push(name);
                        index.symbols.topLevelFunctions[name] = {
                            file: relPath, functionName: name,
                            isAsync:   !!decl.init.async,
                            lineStart: CodebaseIndexer._lineOf(code, node.start),
                            lineEnd:   CodebaseIndexer._lineOf(code, node.end),
                        };
                    }
                }

            } else if (
                node.type === 'ExpressionStatement' &&
                node.expression.type === 'AssignmentExpression' &&
                node.expression.operator === '='
            ) {
                const left  = node.expression.left;
                const right = node.expression.right;
                if (left.type !== 'MemberExpression' || left.computed) continue;
                const isModuleExports = (
                    left.object.type === 'Identifier' && left.object.name === 'module' &&
                    left.property.type === 'Identifier' && left.property.name === 'exports'
                );
                if (!isModuleExports) continue;

                if (right.type === 'Identifier') {
                    exportsEntry.type    = 'default';
                    exportsEntry.default = right.name;
                } else if (right.type === 'ObjectExpression') {
                    exportsEntry.type = 'named';
                    for (const p of right.properties) {
                        if (p.type !== 'Property' || !p.key) continue;
                        const k = p.key.name || p.key.value;
                        if (!k) continue;
                        exportsEntry.named.push(k);
                        const isF = p.value.type === 'FunctionExpression' || p.value.type === 'ArrowFunctionExpression';
                        exportsEntry.namedExports[k] = {
                            type:      isF ? 'function' : 'value',
                            lineStart: CodebaseIndexer._lineOf(code, p.start),
                        };
                    }
                }
            }
        }

        if (exportsEntry.default || exportsEntry.named.length > 0) {
            index.symbols.moduleExports[relPath] = exportsEntry;
        }
    }

    static _extractClass(node, relPath, code, fileEntry, index) {
        const className = node.id.name;
        fileEntry.classes.push(className);
        if (!node.body || !node.body.body) return;
        for (const member of node.body.body) {
            if (member.type !== 'MethodDefinition' || !member.key) continue;
            const methodName = member.key.name || String(member.key.value || '');
            if (!methodName) continue;
            const key = `${className}.${methodName}`;
            index.symbols.classMethods[key] = {
                file:       relPath,
                className,
                methodName,
                isAsync:    !!(member.value && member.value.async),
                lineStart:  CodebaseIndexer._lineOf(code, member.start),
                lineEnd:    CodebaseIndexer._lineOf(code, member.end),
            };
        }
    }

    static _lineOf(code, offset) {
        let line = 1;
        const end = Math.min(offset, code.length);
        for (let i = 0; i < end; i++) {
            if (code[i] === '\n') line++;
        }
        return line;
    }
}

// 獨立執行入口：node src/codebase-indexer.js
if (require.main === module) {
    try {
        CodebaseIndexer.rebuild();
    } catch (e) {
        console.error('❌ [Indexer] 掃描失敗:', e.message);
        process.exit(1);
    }
}

module.exports = CodebaseIndexer;
