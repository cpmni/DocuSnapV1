#!/usr/bin/env node
'use strict';
/**
 * test_migration144_145_friction.js — the 2026-09-09 friction DARK arcs seeded OFF:
 *   mig 144 `type_split_teach_scope_suppress` (Q1, herald) — a taught type no longer re-triggers the split ask.
 *   mig 145 `corrob_autofile_band88`        (Q3, gary)   — corroborated auto-file down to the 88 floor.
 * Both DARK until their OFF->ON gate passes. Pins: mig stamped, seeded 'false', IN TEST_SWITCH_KEYS (armed by
 * the runtime test-build road, NEVER a numbered force-ON — the mig-137 contract), NO force-ON twin, not in
 * ALL_ON_DEFAULTS_93, a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration144_145_friction.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const db = new Database(':memory:');
const logs = []; const origLog = console.log; console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');

for (const [ver, key] of [[144, 'type_split_teach_scope_suppress'], [145, 'corrob_autofile_band88']]) {
  check(`migration ${ver} stamped`, applied.has(ver));
  check(`mig ${ver} seed line says seeded OFF (DARK)`, logs.some(l => new RegExp(`migration ${ver} applied`).test(l) && /seeded OFF/.test(l)));
  check(`a fresh (non-TEST) install ends with ${key} === false (DARK)`, get(key) === 'false');
  check(`${key} is in TEST_SWITCH_KEYS (armed by the runtime test-build road, not a numbered force-ON)`, TEST_SWITCH_KEYS.includes(key));
  check(`mig ${ver} is an INSERT OR IGNORE seed of false`,
        new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${key}', 'false'\\)`).test(src));
  check(`NO numbered force-ON twin for ${key}`, !new RegExp(`VALUES \\('${key}', 'true'\\)`).test(src));
  check(`${key} not in ALL_ON_DEFAULTS_93`, !new RegExp(`ALL_ON_DEFAULTS_93 = \\[[\\s\\S]*?'${key}'[\\s\\S]*?\\];`).test(src));
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('true', key);
}
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start (both)',
      get('type_split_teach_scope_suppress') === 'true' && get('corrob_autofile_band88') === 'true');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
