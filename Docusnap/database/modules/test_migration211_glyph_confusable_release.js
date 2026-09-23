#!/usr/bin/env node
'use strict';
/**
 * test_migration211_glyph_confusable_release.js — mig 211 seeds `glyph_confusable_release` OFF (2026-09-23 evening;
 * gary design → Oracle SIGN-OFF-W/COND C0-C11 after the filtered `_absent` census). The RELEASE leg of the PP-OCR
 * second reader: when every guard passes the confusable soften note is POPPED so the doc files by the normal route.
 * It REMOVES a hold, so its flip is gated on the C0 yield census + C10 (dark_switches.js).
 * Pins (Electron-as-Node):
 *   1. mig stamped, seeded 'false', in TEST_SWITCH_KEYS, no force-ON twin, not in ALL_ON_DEFAULTS_93, a later manual
 *      ON survives the next start;
 *   2. the env bridge GLYPH_CONFUSABLE_RELEASE mirrors the setting (the engine enforces the FALLBACK+RESOLVE deps);
 *   3. C2 parity — the SAME fixture records as python tests/test_glyph_confusable_release.py PAGE_FAMILY_FIXTURES
 *      give the SAME verdict from trust.js _pageFamilyDisagrees (the Python port is byte-for-byte this rule);
 *   4. C8 named preconditions are ON on a fresh install and named beside the key in dark_switches.js;
 *   5. engine source: the release is read only inside the DOWNGRADE branch and the pop is its only mutation.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration211_glyph_confusable_release.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const H = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'));
const trust = require(path.join(ROOT, 'database', 'modules', 'trust.js'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const KEY = 'glyph_confusable_release', ENV = 'GLYPH_CONFUSABLE_RELEASE';

// ── 1. the seed ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n1. mig 211 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 211 stamped', applied.has(211));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 211 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'false'`, get(db, KEY) === 'false');
check(`${KEY} is listed in TEST_SWITCH_KEYS (dark, release-disarmed)`, TEST_SWITCH_KEYS.includes(KEY));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 211 is a single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('NO numbered force-ON twin exists', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(src));
const allOn = src.slice(src.indexOf('ALL_ON_DEFAULTS_93'), src.indexOf(']', src.indexOf('ALL_ON_DEFAULTS_93')));
check('not in ALL_ON_DEFAULTS_93', allOn.length > 0 && !allOn.includes(`'${KEY}'`));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true');
quiet(() => runMigrations(db));
check("a later manual ON survives the next start (mig 137's one-shot reset never re-fires)", get(db, KEY) === 'true');

// ── 2. the env bridge ────────────────────────────────────────────────────────────────────────────────
console.log('\n2. _reconcileEnv bridge');
setS(db, KEY, 'false');
let e = H._reconcileEnv(db);
check('OFF → no env var', !(ENV in e));
setS(db, KEY, 'true');
e = H._reconcileEnv(db);
check("ON → GLYPH_CONFUSABLE_RELEASE === '1'", e[ENV] === '1');
setS(db, 'glyph_fallback_enabled', 'true'); setS(db, 'glyph_confusable_resolve', 'true');
e = H._reconcileEnv(db);
check("the three glyph switches bridge independently (the ENGINE enforces the dep ladder)", e.GLYPH_FALLBACK_ENABLED === '1' && e.GLYPH_CONFUSABLE_RESOLVE === '1' && e[ENV] === '1');

// ── 3. C2 parity with the Python port (shared fixtures) ──────────────────────────────────────────────
console.log('\n3. trust.js _pageFamilyDisagrees parity (fixtures shared with test_glyph_confusable_release.py)');
const FIXTURES = [
  [{ disagree: [{ family: 'keyword', value: 'S0-80228' }] }, true],
  [{ disagree: [], suppressed_taught_role: [{ family: 'keyword', value: 'S0-80228' }] }, false],
  [{ disagree: [], discounted: [{ family: 'crop', value: 'SO-8022', reason: 'format' }] }, true],
  [{ disagree: [{ family: 'memory', value: 'SO-80229' }] }, false],
  [{ disagree: [] }, false],
];
for (const [rec, expect] of FIXTURES)
  check(`_pageFamilyDisagrees(${JSON.stringify(rec)}) → ${expect}`, !!trust._pageFamilyDisagrees(rec) === expect);
const py = fs.readFileSync(path.join(ROOT, 'python_backend', 'tests', 'test_glyph_confusable_release.py'), 'utf8');
check('the Python pin carries the same five fixtures (keyword-disagree / suppressed / discounted-crop / memory / empty)',
  py.includes('({"disagree": [{"family": "keyword", "value": "S0-80228"}]}, True)')
  && py.includes('"suppressed_taught_role": [{"family": "keyword", "value": "S0-80228"}]}, False)')
  && py.includes('"discounted": [{"family": "crop", "value": "SO-8022", "reason": "format"}]}, True)')
  && py.includes('({"disagree": [{"family": "memory", "value": "SO-80229"}]}, False)')
  && py.includes('({"disagree": []}, False)'));

// ── 4. C8 named preconditions ────────────────────────────────────────────────────────────────────────
console.log('\n4. C8 preconditions ON by default + named beside the key');
const fresh = new Database(':memory:'); quiet(() => runMigrations(fresh));
for (const k of ['trust_role_disagreement_refuse', 'role_disagree_refuse_at100', 'autofile_gate_unify', 'learning_exclude_machine_confirms'])
  check(`${k} === 'true' on a fresh install`, get(fresh, k) === 'true', get(fresh, k));
const ds = fs.readFileSync(path.join(ROOT, 'database', 'dark_switches.js'), 'utf8');
const block = ds.slice(ds.indexOf('// glyph_confusable_release (mig 211'), ds.indexOf(`'${KEY}',`));
check('dark_switches.js names the four preconditions beside the key',
  ['trust_role_disagreement_refuse', 'role_disagree_refuse_at100', 'autofile_gate_unify', 'learning_exclude_machine_confirms'].every(k => block.includes(k)));
check('dark_switches.js records the C0 yield census as the flip gate', /C0 yield census/.test(block) && /retire the key/.test(block));

// ── 5. engine source shape ───────────────────────────────────────────────────────────────────────────
console.log('\n5. engine.py: read only inside the DOWNGRADE branch; the pop is the only mutation');
const eng = fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'engine.py'), 'utf8');
const body = eng.slice(eng.indexOf('def _glyph_disagreement_hold'), eng.indexOf('def _glyph_release_page_family_disagrees'));
check('the GLYPH_CONFUSABLE_RELEASE env read sits after `_resolve = True` inside the hold (docstring mentions excluded)',
  body.indexOf("os.environ.get('GLYPH_CONFUSABLE_RELEASE'") > body.indexOf('_resolve = True') && body.indexOf('_resolve = True') > 0);
check("exactly one `data.pop('validation_note', None)` in the hold", (body.match(/data\.pop\('validation_note', None\)/g) || []).length === 1);
check('the handler bridge reads the setting', /glyph_confusable_release', 'false'\) === 'true'\) env\.GLYPH_CONFUSABLE_RELEASE = '1'/.test(fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8')));

console.log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} (${fails} bad)`);
process.exit(fails ? 1 : 0);
