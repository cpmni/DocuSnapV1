#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration192_anchor_code_left_grow.js — mig 192 seeds `anchor_code_left_grow` OFF
 * (2026-09-20; 007+gary → Oracle SIGN-OFF-W/COND). The Stage-2 taught-crop left-clip recovery: on a ref
 * crop disagreement, re-read the taught box with the mig-161 left-slack window; on INDEPENDENT convergence
 * with the full-page read, commit the correct value CLEAN (no needless "please verify" click). DARK until the
 * census gate is read. Pins: seeded 'false', NO force-ON twin, in TEST_SWITCH_KEYS, handler env-wiring present,
 * a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration192_anchor_code_left_grow.js
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
check('migration 192 stamped', applied.has(192));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 192 applied/.test(l) && /seeded OFF/.test(l)));
check("a fresh install ends with anchor_code_left_grow === 'false' (DARK)", get('anchor_code_left_grow') === 'false');
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 192 is an INSERT OR IGNORE seed of false',
  /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('anchor_code_left_grow', 'false'\)/.test(src));
check('NO force-ON twin exists', !/VALUES \('anchor_code_left_grow', 'true'\)/.test(src));
check('anchor_code_left_grow is in TEST_SWITCH_KEYS', TEST_SWITCH_KEYS.includes('anchor_code_left_grow'));
const handler = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler wires the setting to env.ANCHOR_CODE_LEFT_GROW',
  /getSetting\(db, 'anchor_code_left_grow'[\s\S]{0,80}env\.ANCHOR_CODE_LEFT_GROW = '1'/.test(handler));
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'anchor_code_left_grow'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('anchor_code_left_grow') === 'true');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
