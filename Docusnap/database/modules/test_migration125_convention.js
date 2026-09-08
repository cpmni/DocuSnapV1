#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration125_convention.js — mig 125 seeds `buyer_issued_convention_one_confirm`
 * OFF (Oracle C8, 2026-09-07: NO force-ON twin). The test-build force-ON mig 126 was DELETED 2026-09-08 with
 * the customer-build reset (mig 137, database/modules/test_migration137_test_switch_reset.js); the key is a
 * DARK test switch (database/dark_switches.js) armed at runtime by a TEST build only. Pins: seeded 'false',
 * a fresh install ends OFF, no force-ON twin in the source, a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration125_convention.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const KEY = 'buyer_issued_convention_one_confirm';

const db = new Database(':memory:');
const logs = [];
const origLog = console.log;
console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 125 stamped', applied.has(125));
check('the 125 console line says seeded OFF', logs.some(l => /migration 125 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install ends with ${KEY} === 'false' (DARK)`, get(KEY) === 'false');
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 125 is an INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('buyer_issued_convention_one_confirm', 'false'\)/.test(src));
check('NO force-ON twin exists in the source', !/VALUES \('buyer_issued_convention_one_confirm', 'true'\)/.test(src));
check('the key is a listed DARK test switch (runtime-armed on a test build)', TEST_SWITCH_KEYS.includes(KEY));
check('mig 125 carries its ⚑ FLIP GATE line', /⚑ FLIP GATE[^\n]*\n\s*if \(!applied\.has\(125\)\)/.test(src));
db.prepare("UPDATE settings SET value = 'true' WHERE key = ?").run(KEY);
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start (mig 137 is one-shot, never a sweep)', get(KEY) === 'true');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
