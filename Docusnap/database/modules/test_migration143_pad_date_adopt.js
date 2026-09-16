#!/usr/bin/env node
'use strict';
/**
 * test_migration143_pad_date_adopt.js — mig 143 seeds `template_pad_date_adopt` OFF (2026-09-09; Q4 owner exhibit + gary design; reggie
 * polarity): ADOPT a corroborated widened date instead of holding it (Q4).
 *
 * GRADUATED 2026-09-16: mig 174 (@DEFAULT_FLIP) UPSERT-forces it 'true' after the 700-doc flip census passed twice
 * (M=0; exactly one adopt both times and it equals GT; 0 new filers) and the key LEFT TEST_SWITCH_KEYS in the same
 * commit. This pin records BOTH halves: the mig-143 seed is still an INSERT OR IGNORE of 'false' (an old DB
 * upgrading 143 → 174 must end ON), the key is delisted, a fresh install ends 'true', the handler still bridges it
 * to the Python env, its HARD dependency template_pad_window_read is ON on a fresh install, and a deliberate
 * 'false' survives the next start (174 is one-shot). The shared default-on contract for every flip-census
 * graduate is database/test_default_flip_156_159.js.
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
check('migration 174 (the graduation) stamped', applied.has(174));
check("a fresh install ends with template_pad_date_adopt === 'true' (mig 174 @DEFAULT_FLIP, 2026-09-16)",
      get('template_pad_date_adopt') === 'true');
check("its HARD dependency template_pad_window_read is 'true' on a fresh install (the adopt can never run without the wide read)",
      get('template_pad_window_read') === 'true');
check('template_pad_date_adopt is DELISTED from TEST_SWITCH_KEYS (so build_arming never disarms it on a release launch)',
      !TEST_SWITCH_KEYS.includes('template_pad_date_adopt'));

const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 143 is still an INSERT OR IGNORE seed of false (history preserved for the upgrade path)',
      /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('template_pad_date_adopt', 'false'\)/.test(src));
check("mig 174 is the ONLY writer of 'true' and it is a labelled UPSERT (never a numbered TEST force-ON)",
      (src.match(/VALUES \('template_pad_date_adopt', 'true'\)/g) || []).length === 1
      && /\/\/ @DEFAULT_FLIP 174\s*\n\s*if \(!applied\.has\(174\)\)/.test(src)
      && /INSERT INTO settings \(key, value\) VALUES \('template_pad_date_adopt', 'true'\) ON CONFLICT\(key\) DO UPDATE SET value = 'true'/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'template_pad_date_adopt'[\s\S]*?\];/.test(src));

const hsrc = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler maps template_pad_date_adopt → env.TEMPLATE_PAD_DATE_ADOPT',
      /getSetting\(db, 'template_pad_date_adopt', 'false'\) === 'true'\) env\.TEMPLATE_PAD_DATE_ADOPT = '1'/.test(hsrc));

db.prepare("UPDATE settings SET value = 'false' WHERE key = 'template_pad_date_adopt'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check("a deliberate 'false' survives the next start (mig 174 is one-shot, not a sweep — the setting stays the kill switch)",
      get('template_pad_date_adopt') === 'false');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
