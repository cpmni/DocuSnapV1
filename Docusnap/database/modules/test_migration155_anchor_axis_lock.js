#!/usr/bin/env node
'use strict';
/**
 * test_migration155_anchor_axis_lock.js — mig 155 seeds `anchor_axis_lock` OFF (2026-09-10; 007+reggie+gary
 * → Oracle SIGN-OFF-W/COND). The FREE-TEXT twin of template_code_read_widen: an ADDITIVE width-invariant
 * label-column read for below/above/right free-text anchors, review-bound, competing only where no
 * authoritative read won. DARK until its fire-census (zero fires ⇒ stay DARK) + the both-ON mig-142 pins +
 * realdoc M=0 + Oracle. Pins: mig stamped, seeded 'false', IN TEST_SWITCH_KEYS (armed by the runtime
 * test-build road, never a numbered force-ON), NO force-ON twin, not in ALL_ON_DEFAULTS_93, a later manual
 * ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration155_anchor_axis_lock.js
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

check('migration 155 stamped', applied.has(155));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 155 applied/.test(l) && /seeded OFF/.test(l)));
check('a fresh (non-TEST) install ends with anchor_axis_lock === false (DARK)',
      get('anchor_axis_lock') === 'false');
check('anchor_axis_lock is in TEST_SWITCH_KEYS (armed by the runtime test-build road)',
      TEST_SWITCH_KEYS.includes('anchor_axis_lock'));

const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 155 is an INSERT OR IGNORE seed of false',
      /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('anchor_axis_lock', 'false'\)/.test(src));
check('NO numbered force-ON twin exists', !/VALUES \('anchor_axis_lock', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'anchor_axis_lock'[\s\S]*?\];/.test(src));

// The handler maps the setting to the Python env the engine reads.
const hsrc = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler maps anchor_axis_lock → env.ANCHOR_AXIS_LOCK',
      /getSetting\(db, 'anchor_axis_lock', 'false'\) === 'true'\) env\.ANCHOR_AXIS_LOCK = '1'/.test(hsrc));

db.prepare("UPDATE settings SET value = 'true' WHERE key = 'anchor_axis_lock'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('anchor_axis_lock') === 'true');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
