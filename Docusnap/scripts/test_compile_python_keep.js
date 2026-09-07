#!/usr/bin/env node
'use strict';
/**
 * scripts/test_compile_python_keep.js — SOURCE-PROTECTION pin (Build 1, 2026-09-07; Oracle SIGN-OFF-W/COND).
 *
 * The packaged build ships EVERY python_backend module as sourceless .pyc (KEEP_SOURCE=∅ in
 * compile-python-bytecode.js). The JS-spawned entry scripts used to stay .py because they were launched
 * as `python.exe <path>.py`; main.js pythonArgs() now swaps .py -> .pyc when packaged (the ONE choke
 * point every Python spawn routes through). This pin locks that contract so a future dev can't:
 *   (1) reintroduce a readable-.py KEEP_SOURCE without also removing the pythonArgs swap, or
 *   (2) drop the swap while the build strips the .py (which would 404 every packaged Python spawn), or
 *   (3) add a NEW python_backend spawn site whose entry the compile-gate doesn't ship as .pyc.
 *
 *   node scripts/test_compile_python_keep.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// ── 1. compile-python-bytecode.js ships NO source: KEEP_SOURCE is empty + the SPAWN_ENTRIES gate exists.
const comp = fs.readFileSync(path.join(ROOT, 'scripts', 'compile-python-bytecode.js'), 'utf8');
check('KEEP_SOURCE is the empty set (no readable .py entries ship)', /const KEEP_SOURCE = new Set\(\)\s*;/.test(comp));
check('the compile gate asserts SPAWN_ENTRIES exist as .pyc', /const SPAWN_ENTRIES = \[/.test(comp));
check('the compile gate refuses any leftover .py (sanity gate 2)', /still present after strip — gate failed/.test(comp));

// ── 2. main.js pythonArgs swaps .py -> .pyc when packaged (the choke point), with an existsSync fallback.
const mainJs = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const paBody = mainJs.slice(mainJs.indexOf('function pythonArgs('), mainJs.indexOf('function tesseractPath('));
check('pythonArgs is packaged-gated', /app\.isPackaged/.test(paBody));
check("pythonArgs swaps a python_backend .py to .pyc", /script \+ 'c'/.test(paBody) && /python_backend/.test(paBody));
check('pythonArgs falls back to the .py when the .pyc is absent (SHIP_PY_SOURCE kill switch)', /fs\.existsSync\(compiled\)/.test(paBody));
check('the dev branch still spawns the .py (py -3.12 script.py)', /'-3\.12', script/.test(paBody));

// ── 3. every python_backend script the JS spawns BY PATH is one the compile gate ships as .pyc.
//    (Covers BOTH resourcePath('python_backend',…'.py') AND path.dirname(backendScript())+'X.py' siblings.)
const seStart = comp.indexOf('const SPAWN_ENTRIES = [');
const seBlock = comp.slice(seStart, comp.indexOf('];', seStart));
const spawnSet = new Set([...seBlock.matchAll(/'([^']+\.py)'/g)].map(m => m[1]));
check(`SPAWN_ENTRIES parsed from the compile gate (${spawnSet.size})`, spawnSet.size >= 15);

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
  // resourcePath('python_backend', 'a', 'b.py')  /  ctx.resourcePath('python_backend', …)
  for (const m of s.matchAll(/resourcePath\('python_backend'((?:,\s*'[^']+')+)\)/g)) {
    const parts = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    const rel = parts.join('/');
    if (rel.endsWith('.py')) spawned.add(rel);
  }
  // path.dirname(backendScript()) + 'X.py' siblings — the sites the old regex missed (Oracle's catch).
  for (const m of s.matchAll(/dirname\([^)]*backendScript\(\)\)\s*,\s*'([^']+\.py)'/g)) spawned.add(m[1]);
}
check(`found the JS-spawned python_backend scripts (${[...spawned].sort().join(', ')})`, spawned.size >= 12);
for (const rel of [...spawned].sort()) check(`${rel} is shipped as .pyc by the compile gate`, spawnSet.has(rel));
check('the 09-07 regression stays covered: ocr/detect_angle.py is spawned AND compiled', spawned.has('ocr/detect_angle.py') && spawnSet.has('ocr/detect_angle.py'));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
