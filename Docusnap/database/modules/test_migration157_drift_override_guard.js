#!/usr/bin/env node
'use strict';
/**
 * test_migration157_drift_override_guard.js — mig 157 seeds `template_drift_override_guard` OFF (2026-09-10;
 * 007 → Oracle SIGN-OFF-W/COND). A Stage-0.5 drift-override may only DISCARD a credible absolute read on a
 * credible label match (taught/exact, or match_score >= floor) — stops a cross-word fuzzy match relocating
 * customer_name onto the postcode line. DARK. Pins: mig stamped, seeded 'false', IN TEST_SWITCH_KEYS, NO
 * force-ON twin, not in ALL_ON_DEFAULTS_93, handler maps it to the Python env, a later manual ON survives.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration157_drift_override_guard.js
 */
const path = require('path'), fs = require('fs'), Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };
const db = new Database(':memory:');
const logs = []; const orig = console.log; console.log = (m) => { logs.push(String(m)); };
runMigrations(db); console.log = orig;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 157 stamped', applied.has(157));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 157 applied/.test(l) && /seeded OFF/.test(l)));
check('fresh install: template_drift_override_guard === false', get('template_drift_override_guard') === 'false');
check('in TEST_SWITCH_KEYS', TEST_SWITCH_KEYS.includes('template_drift_override_guard'));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('template_drift_override_guard', 'false'\)/.test(src));
check('NO force-ON twin', !/VALUES \('template_drift_override_guard', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'template_drift_override_guard'[\s\S]*?\];/.test(src));
const hsrc = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler maps → env.TEMPLATE_DRIFT_OVERRIDE_GUARD',
      /getSetting\(db, 'template_drift_override_guard', 'false'\) === 'true'\) env\.TEMPLATE_DRIFT_OVERRIDE_GUARD = '1'/.test(hsrc));
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'template_drift_override_guard'").run();
console.log = () => {}; runMigrations(db); console.log = orig;
check('a later manual ON survives the next start', get('template_drift_override_guard') === 'true');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
