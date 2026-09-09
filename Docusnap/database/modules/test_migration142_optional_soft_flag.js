#!/usr/bin/env node
'use strict';
/**
 * test_migration142_optional_soft_flag.js — mig 142 seeds `optional_soft_flag_autofile` OFF (2026-09-09;
 * owner exhibit + gary design): a soft-advisory note on an OPTIONAL non-role non-strict field stops blocking
 * auto-file on a GRADUATED scope. DARK until its OFF->ON census + Oracle. Pins: mig stamped, seeded 'false',
 * IN TEST_SWITCH_KEYS (armed by the runtime test-build road, never a numbered force-ON), NO force-ON twin,
 * not in ALL_ON_DEFAULTS_93, a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration142_optional_soft_flag.js
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

check('migration 142 stamped', applied.has(142));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 142 applied/.test(l) && /seeded OFF/.test(l)));
check('a fresh (non-TEST) install ends with optional_soft_flag_autofile === false (DARK)',
      get('optional_soft_flag_autofile') === 'false');
check('optional_soft_flag_autofile is in TEST_SWITCH_KEYS (armed by the runtime test-build road)',
      TEST_SWITCH_KEYS.includes('optional_soft_flag_autofile'));

const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 142 is an INSERT OR IGNORE seed of false',
      /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('optional_soft_flag_autofile', 'false'\)/.test(src));
check('NO numbered force-ON twin exists', !/VALUES \('optional_soft_flag_autofile', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'optional_soft_flag_autofile'[\s\S]*?\];/.test(src));

db.prepare("UPDATE settings SET value = 'true' WHERE key = 'optional_soft_flag_autofile'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('optional_soft_flag_autofile') === 'true');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
