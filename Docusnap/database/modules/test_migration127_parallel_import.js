#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration127_parallel_import.js — mig 127 seeds `ocr_parallel_import_enabled` OFF
 * (Oracle C7, 2026-09-07 — its OWN key, never in ALL_ON_DEFAULTS_93). The test-build force-ON mig 128 was
 * DELETED 2026-09-08 with the customer-build reset (mig 137). The key is deliberately NOT in
 * database/dark_switches.js: it graduates by its own promotion migration (mig 139, AUDIT_FIX_PLAN §4 3.3),
 * whose UPSERT would otherwise be undone by the runtime disarm (Oracle C2). Until 139 lands a fresh install
 * ends OFF. Pins: seeded 'false', not in ALL_ON_DEFAULTS_93, not a runtime-armed test switch, a later manual
 * OFF survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration127_parallel_import.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const KEY = 'ocr_parallel_import_enabled';

const db = new Database(':memory:');
const logs = [];
const origLog = console.log;
console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 127 stamped', applied.has(127));
check('the 127 console line says seeded OFF', logs.some(l => /migration 127 applied/.test(l) && /seeded OFF/.test(l)));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 127 is an INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('ocr_parallel_import_enabled', 'false'\)/.test(src));
// Oracle C7: the customer default stays OFF — the key must NOT ride the all-on default list.
check('ocr_parallel_import_enabled is NOT in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'ocr_parallel_import_enabled'[\s\S]*?\];/.test(src));
// Oracle C2 (2026-09-08): promoted by its own migration, so it must NOT be a runtime-armed test switch.
check('ocr_parallel_import_enabled is NOT in TEST_SWITCH_KEYS (mig 139 is its sole writer)', !TEST_SWITCH_KEYS.includes(KEY));
const promoted = applied.has(139);
check(`a fresh install ends with ${KEY} === '${promoted ? 'true' : 'false'}' (${promoted ? 'mig 139 promotion' : 'DARK until mig 139'})`, get(KEY) === (promoted ? 'true' : 'false'));
db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual OFF survives the next start', get(KEY) === 'false');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
