#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration132_pad_containment.js — mig 132 seeds `template_pad_date_containment_flag` OFF
 * (gary A2 → Oracle C12, 2026-09-07): the clipped-first-digit date flags without the +15 margin (≤70 + note + a one-click corrected_to).
 * DARK until the OFF→ON realdoc M=0 + flag census are read — pins: seeded 'false', NO force-ON twin, not in ALL_ON_DEFAULTS_93,
 * a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration132_pad_containment.js
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
check('migration 132 stamped', applied.has(132));
// mig 134 (TEST-BUILD force-ON, 2026-09-07 owner order) may sit on top: the SEED is pinned by the console line + the
// source; the final state is 'true' only while that test migration exists (revert list) — else 'false'.
check("the seed line says seeded OFF (DARK)", logs.some(l => /migration 132 applied/.test(l) && /seeded OFF/.test(l)));
check("a fresh install ends with template_pad_date_containment_flag === " + (applied.has(134) ? "'true' (mig 134 TEST force-ON on top)" : "'false' (DARK)"), get('template_pad_date_containment_flag') === (applied.has(134) ? 'true' : 'false'));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 132 is an INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('template_pad_date_containment_flag', 'false'\)/.test(src));
check('NO force-ON twin exists', !/VALUES \('template_pad_date_containment_flag', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'template_pad_date_containment_flag'[\s\S]*?\];/.test(src));
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'template_pad_date_containment_flag'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('template_pad_date_containment_flag') === 'true');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
