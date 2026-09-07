#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration127_128_parallel_import.js — mig 127 seeds `ocr_parallel_import_enabled`
 * OFF (Oracle C7, 2026-09-07 — its OWN key, never in ALL_ON_DEFAULTS_93); mig 128 is the TEST-BUILD force-ON (the owner runs every switch ON).
 * Pins the order (127 seed → 128 force), the visible TEST-BUILD line, and that a later manual OFF survives.
 * ⚠ Delete the mig-128 half of this pin with the migration when it is reverted before a customer build.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration127_128_parallel_import.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const db = new Database(':memory:');
const logs = [];
const origLog = console.log;
console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migrations 127 and 128 stamped', applied.has(127) && applied.has(128));
const i127 = logs.findIndex(l => /migration 127 applied/.test(l)), i128 = logs.findIndex(l => /migration 128 applied/.test(l));
check('127 (seed OFF) ran before 128 (force ON)', i127 >= 0 && i128 > i127);
check("a fresh install ends with ocr_parallel_import_enabled === 'true' (the TEST build)", get('ocr_parallel_import_enabled') === 'true');
check('the 128 console line says TEST-BUILD', /TEST-BUILD/.test(logs[i128] || ''));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 127 is an INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('ocr_parallel_import_enabled', 'false'\)/.test(src));
check('mig 128 carries the revert caveat', /migration 128:[\s\S]{0,600}TEST-ONLY \/ REVERSIBLE/.test(src));
const db2 = new Database(':memory:');
console.log = () => {};
runMigrations(db2);
console.log = origLog;
db2.prepare("UPDATE settings SET value = 'false' WHERE key = 'ocr_parallel_import_enabled'").run();
console.log = () => {};
runMigrations(db2);
console.log = origLog;
check('a later manual OFF survives the next start', db2.prepare("SELECT value FROM settings WHERE key = 'ocr_parallel_import_enabled'").get().value === 'false');
// Oracle C7: the customer default stays OFF — the key must NOT ride the all-on default list.
check('ocr_parallel_import_enabled is NOT in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'ocr_parallel_import_enabled'[\s\S]*?\];/.test(src));
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
