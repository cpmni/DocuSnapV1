#!/usr/bin/env node
'use strict';
/**
 * test_migration154_ref_role_shape.js — mig 154 seeds `trust_ref_role_shape` OFF (2026-09-10; reggie+gary
 * → Oracle SIGN-OFF-W/COND). A REFERENCE role (ref_field_key: invoice/PO/SO/remittance number) is verified
 * by the SHAPE of its confirmed samples (classifyRefShape), not 'constant' set-membership, so a genuinely-new
 * ref value on a sparse/duplicate-confirmed scope files instead of `unverifiable-value`. DARK until its
 * OFF->ON census (M=0 + new would-file ref == GT) + a live-DB re-judge + Oracle. Pins: mig stamped, seeded
 * 'false', IN TEST_SWITCH_KEYS (armed by the runtime test-build road, never a numbered force-ON), NO force-ON
 * twin, not in ALL_ON_DEFAULTS_93, a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration154_ref_role_shape.js
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

check('migration 154 stamped', applied.has(154));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 154 applied/.test(l) && /seeded OFF/.test(l)));
check('a fresh (non-TEST) install ends with trust_ref_role_shape === false (DARK)',
      get('trust_ref_role_shape') === 'false');
check('trust_ref_role_shape is in TEST_SWITCH_KEYS (armed by the runtime test-build road)',
      TEST_SWITCH_KEYS.includes('trust_ref_role_shape'));

const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 154 is an INSERT OR IGNORE seed of false',
      /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('trust_ref_role_shape', 'false'\)/.test(src));
check('NO numbered force-ON twin exists', !/VALUES \('trust_ref_role_shape', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'trust_ref_role_shape'[\s\S]*?\];/.test(src));

db.prepare("UPDATE settings SET value = 'true' WHERE key = 'trust_ref_role_shape'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('trust_ref_role_shape') === 'true');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
