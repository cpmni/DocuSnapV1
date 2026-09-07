#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration130_corrob_release.js — mig 130 seeds `reread_hold_corrob_release` OFF
 * (gary → Oracle C13-C17, 2026-09-07): the S3-C5 hold releases a licensed keyword-witnessed re-read over an unlicensed old record.
 * DARK until the C17 eligibility-delta census is vetted — pins: seeded 'false', NO force-ON twin, not in ALL_ON_DEFAULTS_93,
 * a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration130_corrob_release.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const db = new Database(':memory:');
const logs = []; const origLog = console.log; console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 130 stamped', applied.has(130));
// mig 134 (TEST-BUILD force-ON, 2026-09-07 owner order) may sit on top: the SEED is pinned by the console line + the
// source; the final state is 'true' only while that test migration exists (revert list) — else 'false'.
check("the seed line says seeded OFF (DARK)", logs.some(l => /migration 130 applied/.test(l) && /seeded OFF/.test(l)));
check("a fresh install ends with reread_hold_corrob_release === " + (applied.has(134) ? "'true' (mig 134 TEST force-ON on top)" : "'false' (DARK)"), get('reread_hold_corrob_release') === (applied.has(134) ? 'true' : 'false'));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 130 is an INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('reread_hold_corrob_release', 'false'\)/.test(src));
check('NO force-ON twin exists', !/VALUES \('reread_hold_corrob_release', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'reread_hold_corrob_release'[\s\S]*?\];/.test(src));
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'reread_hold_corrob_release'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('reread_hold_corrob_release') === 'true');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
