#!/usr/bin/env node
'use strict';
/**
 * test_migration156_nonname_flag.js — mig 156 seeds `name_role_nonname_flag` OFF (2026-09-10; reggie+gary →
 * Oracle SIGN-OFF-W/COND). A name-role field whose whole value is a bare postcode/email/GB-VAT/IBAN is
 * flagged + held (value kept, note + `+nonname_flag` method sentinel, cap ≤69, needs_review). DARK until its
 * predicate pins + the both-ON mig-142 pin + accepted_names batch-stall pin + realdoc M=0 + the live Vellum
 * doc + Oracle. Pins: mig stamped, seeded 'false', IN TEST_SWITCH_KEYS (armed by the runtime test-build road,
 * never a numbered force-ON), NO force-ON twin, not in ALL_ON_DEFAULTS_93, handler maps it to the Python env,
 * a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration156_nonname_flag.js
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

check('migration 156 stamped', applied.has(156));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 156 applied/.test(l) && /seeded OFF/.test(l)));
check('a fresh (non-TEST) install ends with name_role_nonname_flag === false (DARK)',
      get('name_role_nonname_flag') === 'false');
check('name_role_nonname_flag is in TEST_SWITCH_KEYS (armed by the runtime test-build road)',
      TEST_SWITCH_KEYS.includes('name_role_nonname_flag'));

const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 156 is an INSERT OR IGNORE seed of false',
      /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('name_role_nonname_flag', 'false'\)/.test(src));
check('NO numbered force-ON twin exists', !/VALUES \('name_role_nonname_flag', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'name_role_nonname_flag'[\s\S]*?\];/.test(src));

const hsrc = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler maps name_role_nonname_flag → env.NAME_ROLE_NONNAME_FLAG',
      /getSetting\(db, 'name_role_nonname_flag', 'false'\) === 'true'\) env\.NAME_ROLE_NONNAME_FLAG = '1'/.test(hsrc));

db.prepare("UPDATE settings SET value = 'true' WHERE key = 'name_role_nonname_flag'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('name_role_nonname_flag') === 'true');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
