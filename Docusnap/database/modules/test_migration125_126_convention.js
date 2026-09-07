#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration125_126_convention.js — mig 125 seeds `buyer_issued_convention_one_confirm`
 * OFF (Oracle C8, 2026-09-07); mig 126 is the TEST-BUILD force-ON (owner "go, and turn it on in the build").
 * Pins the order (125 seed → 126 force), the visible TEST-BUILD line, and that a later manual OFF survives.
 * ⚠ Delete the mig-126 half of this pin with the migration when it is reverted before a customer build.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration125_126_convention.js
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
check('migrations 125 and 126 stamped', applied.has(125) && applied.has(126));
const i125 = logs.findIndex(l => /migration 125 applied/.test(l)), i126 = logs.findIndex(l => /migration 126 applied/.test(l));
check('125 (seed OFF) ran before 126 (force ON)', i125 >= 0 && i126 > i125);
check("a fresh install ends with buyer_issued_convention_one_confirm === 'true' (the TEST build)", get('buyer_issued_convention_one_confirm') === 'true');
check('the 126 console line says TEST-BUILD', /TEST-BUILD/.test(logs[i126] || ''));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 125 is an INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('buyer_issued_convention_one_confirm', 'false'\)/.test(src));
check('mig 126 carries the revert caveat', /migration 126:[\s\S]{0,600}TEST-ONLY \/ REVERSIBLE/.test(src));
const db2 = new Database(':memory:');
console.log = () => {};
runMigrations(db2);
console.log = origLog;
db2.prepare("UPDATE settings SET value = 'false' WHERE key = 'buyer_issued_convention_one_confirm'").run();
console.log = () => {};
runMigrations(db2);
console.log = origLog;
check('a later manual OFF survives the next start', db2.prepare("SELECT value FROM settings WHERE key = 'buyer_issued_convention_one_confirm'").get().value === 'false');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
