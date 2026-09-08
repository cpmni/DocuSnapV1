#!/usr/bin/env node
'use strict';
/**
 * scripts/run-pins.js — the JS pin runner (Oracle re-vet 2026-09-08, item 5: "a pin nobody runs rots").
 *
 * Discovers every `test_*.js` under the five JS pin locations and runs each as its own process under
 * Electron-as-Node (native better-sqlite3 ABI), printing one line per file and a summary; exits 1 on any
 * failure (non-zero exit OR a "N failed" summary line with N>0). No test framework — every pin is a
 * self-contained script that prints PASS/FAIL lines and exits non-zero on a red.
 *
 *   npm run test:pins                 # all JS pins
 *   node scripts/run-pins.js scripts  # one location (scripts | database | modules | services | windows)
 *   FILTER=release node scripts/run-pins.js   # only files whose path contains "release"
 *
 * Python pins are NOT run here (two styles, see memory reference_running_test_suite): pytest-style via
 * `py -3.12 -m pytest $(grep -l "def test_" tests/test_*.py)`, script-style one module at a time.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const LOCATIONS = {
  scripts: ['scripts'],
  database: ['database', 'database/modules'],
  modules: ['src/modules'],            // recursed one level: src/modules/<area>/test_*.js
  services: ['src/services'],
  windows: ['src/windows'],            // recursed one level: src/windows/<win>/test_*.js
};

function listPins(dir, depth) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isFile() && /^test_.*\.js$/.test(e.name)) out.push(path.join(dir, e.name));
    else if (e.isDirectory() && depth > 0 && e.name !== 'node_modules') out.push(...listPins(path.join(dir, e.name), depth - 1));
  }
  return out;
}

function discover(which) {
  const keys = which ? [which] : Object.keys(LOCATIONS);
  const files = [];
  for (const k of keys) {
    if (!LOCATIONS[k]) { console.error(`unknown location "${k}" (one of ${Object.keys(LOCATIONS).join(', ')})`); process.exit(2); }
    for (const d of LOCATIONS[k]) files.push(...listPins(d, k === 'modules' || k === 'windows' ? 1 : 0));
  }
  const filter = process.env.FILTER;
  return [...new Set(files)].filter(f => !filter || f.includes(filter)).sort();
}

function electronExe() {
  const p = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  return fs.existsSync(p) ? p : null;
}

function runOne(file, exe) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const r = spawnSync(exe || process.execPath, [path.join(ROOT, file)], { cwd: ROOT, env, encoding: 'utf8', timeout: 300000, windowsHide: true });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\s+failed/i);
  const failedCount = m ? Number(m[1]) : 0;
  const ok = !r.error && r.status === 0 && failedCount === 0;
  return { ok, status: r.error ? `spawn: ${r.error.message}` : r.status, failedCount, out };
}

if (require.main === module) {
  const which = process.argv[2];
  const files = discover(which);
  const exe = electronExe();
  if (!exe) console.error('[run-pins] node_modules/electron not found — running under plain node (native-module pins will fail)');
  let pass = 0, fail = 0; const failures = [];
  const t0 = Date.now();
  for (const f of files) {
    const r = runOne(f, exe);
    if (r.ok) { pass++; console.log(`  OK   ${f}`); }
    else { fail++; failures.push([f, r]); console.log(`  FAIL ${f} (exit ${r.status}${r.failedCount ? `, ${r.failedCount} failed` : ''})`); }
  }
  for (const [f, r] of failures) {
    console.log(`\n──── ${f} ────`);
    console.log(r.out.split(/\r?\n/).filter(l => /FAIL|Error|error|failed/.test(l)).slice(0, 12).join('\n'));
  }
  console.log(`\n[run-pins] ${files.length} pin file(s): ${pass} green, ${fail} red (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(fail ? 1 : 0);
}

module.exports = { discover, listPins, runOne, LOCATIONS };
