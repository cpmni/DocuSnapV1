#!/usr/bin/env node
'use strict';
/**
 * scripts/test_compile_python_keep.js — every Python script the JS spawns BY PATH must survive the bytecode
 * step as a .py (compile-python-bytecode.js KEEP_SOURCE). 2026-09-07: the owner's packaged log showed
 * "python.exe: can't open file '…\ocr\detect_angle.py'" — the angle heal's script had been compiled away, so
 * the 5b argv fix could not help a packaged install. Lint: grep src/ for resourcePath('python_backend', …'.py')
 * and assert each relative path is in KEEP_SOURCE.
 *
 *   node scripts/test_compile_python_keep.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const src = fs.readFileSync(path.join(ROOT, 'scripts', 'compile-python-bytecode.js'), 'utf8');
const keepBlock = src.slice(src.indexOf('const KEEP_SOURCE = new Set(['), src.indexOf('].map(p => p.replace'));
const keep = new Set([...keepBlock.matchAll(/'([^']+\.py)'/g)].map(m => m[1]));
check('KEEP_SOURCE parsed', keep.size >= 10);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!['node_modules', 'windows'].includes(e.name)) walk(path.join(d, e.name)); }
    else if (e.name.endsWith('.js') && !e.name.startsWith('test_')) files.push(path.join(d, e.name));
  }
})(path.join(ROOT, 'src'));
const spawned = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/resourcePath\('python_backend'((?:,\s*'[^']+')+)\)/g)) {
    const parts = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    const rel = parts.join('/');
    if (rel.endsWith('.py')) spawned.add(rel);
  }
}
check(`found the spawned scripts (${[...spawned].sort().join(', ')})`, spawned.size >= 8);
for (const rel of [...spawned].sort()) check(`${rel} is kept as .py in the packaged build`, keep.has(rel));
check('the regression itself: ocr/detect_angle.py is spawned AND kept', spawned.has('ocr/detect_angle.py') && keep.has('ocr/detect_angle.py'));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
