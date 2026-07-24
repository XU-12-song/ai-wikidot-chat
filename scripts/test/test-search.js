import { searchPages } from '../../src/tools/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件所在目录，并确保 output 目录存在
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// 用于收集所有输出内容
const outputLines = [];

// 重定向 console.log 到数组
const originalLog = console.log;
console.log = (...args) => {
    const line = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg))).join(' ');
    outputLines.push(line);
    originalLog(...args); // 同时保留控制台输出（可选）
};

// Test 1: old-style pattern
const r1 = searchPages({ pattern: 'keter' });
console.log('Test 1 (pattern=keter):', r1.length, 'results');
console.log('  first:', r1[0]?.name, r1[0]?.tags);

// Test 2: single column filter
const r2 = searchPages({ name: '4725' });
console.log('Test 2 (name=4725):', r2.length, 'results');
for (const r of r2) console.log('  ', r.name, r.title);

// Test 3: tags filter (AND)
const r3 = searchPages({ tags: ['scp', 'keter'], limit: 5, sort: 'upvote', order: 'desc' });
console.log('Test 3 (tags=[scp,keter], top-5 by upvote):', r3.length, 'results');
for (const r of r3) console.log('  ', r.name, 'up:', r.upvote, r.tags);

// Test 4: sourceForm + tags
const r4 = searchPages({ sourceForm: 'html', tags: ['scp'], limit: 3 });
console.log('Test 4 (sourceForm=html, tags=[scp]):', r4.length, 'results');
for (const r of r4) console.log('  ', r.name, r.source_form, r.tags);

// Test 5: parent filter
const r5 = searchPages({ parent: 'scp-cn-4725' });
console.log('Test 5 (parent=scp-cn-4725):', r5.length, 'results');
for (const r of r5) console.log('  ', r.name, r.parent_name);

// Test 6: combined (author + tags)
const r6 = searchPages({ author: 'Dr', tags: ['scp'], limit: 3, sort: 'upvote', order: 'desc' });
console.log('Test 6 (author=Dr, tags=[scp]):', r6.length, 'results');
for (const r of r6) console.log('  ', r.name, r.author.name, r.tags);

// Test 7: no filters
const r7 = searchPages({});
console.log('Test 7 (no filters):', r7.length, 'results');

// Test 8: content search
const r8 = searchPages({ content: 'Keter', limit: 3 });
console.log('Test 8 (content=Keter):', r8.length, 'results');
for (const r of r8) console.log('  ', r.name, r.title);

// Test 9: ascending sort
const r9 = searchPages({ tags: ['scp'], limit: 5, sort: 'created_at', order: 'asc' });
console.log('Test 9 (scp, oldest first):', r9.length, 'results');
for (const r of r9) console.log('  ', r.name, r.created_at);

// Test 10: pattern + tags combined
const r10 = searchPages({ pattern: 'experiment', tags: ['scp'], limit: 5 });
console.log('Test 10 (pattern=experiment, tags=[scp]):', r10.length, 'results');
for (const r of r10) console.log('  ', r.name, r.tags);

console.log('\nAll tests passed');

// 将所有输出写入文件
const outputPath = path.join(outputDir, 'test_results.txt');
fs.writeFileSync(outputPath, outputLines.join('\n'), 'utf-8');
console.log = originalLog; // 恢复 console.log（可选）
console.log(`Results written to ${outputPath}`);