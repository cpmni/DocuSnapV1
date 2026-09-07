#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration123_test_force_on.js
 * ---------------------------------------------------
 * The 2026-09-07 TEST BUILD ("build it with the toggles on"): mig 122 seeds the three log-review arcs OFF, mig 123
 * then FORCE-flips them + money_sign_capture ON (UPSERT). Pins the ORDER (122 before 123 — a fresh install must
 * end ON), the four keys, the mig-122 keys being exactly the seeded set, and that the force-ON migration is
 * VISIBLE as a test migration (its console line names "TEST-BUILD") so a customer build cannot ship it unnoticed.
 * ⚠ When mig 123 is reverted before a customer build, DELETE this pin with it.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration123_test_force_on.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const KEYS = ['anchor_bare_label_fuzzy', 'anchor_labelless_currency_refuse', 'type_uninstalled_heading_fold', 'money_sign_capture'];
const db = new Database(':memory:');
const logs = [];
const origLog = console.log;
console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));

console.log('§1 a fresh install ends with the four switches ON');
for (const k of KEYS) check(`${k} === 'true'`, get(k) === 'true');
check('migrations 122 and 123 both stamped', applied.has(122) && applied.has(123));
const i122 = logs.findIndex(l => /migration 122 applied/.test(l)), i123 = logs.findIndex(l => /migration 123 applied/.test(l));
check('122 (seed OFF) ran BEFORE 123 (force ON)', i122 >= 0 && i123 > i122);
check('the 123 console line says TEST-BUILD (visible test migration)', /TEST-BUILD/.test(logs[i123] || ''));

console.log('§2 the source: mig 123 is marked TEST-ONLY / REVERSIBLE and lists exactly the four keys');
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
const blk = src.slice(src.indexOf('migration 123:'), src.indexOf('applied.has(123)') + 900);
check('the comment carries the revert caveat', /TEST-ONLY \/ REVERSIBLE/.test(blk));
check('the key list is exactly the four', KEYS.every(k => blk.includes(`'${k}'`)));

console.log('§3 an install that already turned one of them OFF by hand is still forced ON once (the test-build intent), then untouched');
const db2 = new Database(':memory:');
console.log = () => {};
runMigrations(db2);
console.log = origLog;
db2.prepare("UPDATE settings SET value = 'false' WHERE key = 'money_sign_capture'").run();
console.log = () => {};
runMigrations(db2);            // second start: 123 already applied -> the owner's choice stands
console.log = origLog;
check("a later manual OFF survives the next start (123 does not re-run)", db2.prepare("SELECT value FROM settings WHERE key = 'money_sign_capture'").get().value === 'false');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
