#!/usr/bin/env node
'use strict';
/**
 * test_migration143_pad_date_adopt.js — mig 143 seeds `template_pad_date_adopt` OFF (2026-09-09; Q4 owner exhibit + gary design; reggie
 * polarity): ADOPT a corroborated widened date instead of holding it (Q4).
 * DARK until its OFF->ON realdoc M=0 + fire census pass. Pins: mig stamped, seeded 'false', IN
 * TEST_SWITCH_KEYS (armed by the runtime test-build road, NEVER a numbered force-ON — the mig-137 contract),
 * NO force-ON twin, not in ALL_ON_DEFAULTS_93, a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration143_pad_date_adopt.js
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

check('migration 143 stamped', applied.has(143));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 143 applied/.test(l) && /seeded OFF/.test(l)));
// No numbered force-ON twin (never had one); a fresh, non-TEST install ends DARK.
check('a fresh (non-TEST) install ends with template_pad_date_adopt === false (DARK)',
      get('template_pad_date_adopt') === 'false');
check('template_pad_date_adopt is in TEST_SWITCH_KEYS (armed by the runtime test-build road, not a numbered force-ON)',
      TEST_SWITCH_KEYS.includes('template_pad_date_adopt'));

const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 143 is an INSERT OR IGNORE seed of false',
      /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('template_pad_date_adopt', 'false'\)/.test(src));
check('NO numbered force-ON twin exists', !/VALUES \('template_pad_date_adopt', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'template_pad_date_adopt'[\s\S]*?\];/.test(src));

db.prepare("UPDATE settings SET value = 'true' WHERE key = 'template_pad_date_adopt'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('template_pad_date_adopt') === 'true');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
