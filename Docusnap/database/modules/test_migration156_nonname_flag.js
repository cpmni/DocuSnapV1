#!/usr/bin/env node
'use strict';
/**
 * test_migration156_nonname_flag.js — mig 156 seeds `name_role_nonname_flag` OFF (2026-09-10; reggie+gary →
 * Oracle SIGN-OFF-W/COND). A name-role field whose whole value is a bare postcode/email/GB-VAT/IBAN is
 * flagged + held (value kept, note + `+nonname_flag` method sentinel, cap ≤69, needs_review).
 *
 * GRADUATED 2026-09-16: mig 172 (@DEFAULT_FLIP) UPSERT-forces it 'true' after the 700-doc flip census passed
 * twice (M=0, 5 fires, 1 file→hold, 0 hold→file) and the key LEFT TEST_SWITCH_KEYS in the same commit. This
 * pin now records BOTH halves of that history: the mig-156 seed is still an INSERT OR IGNORE of 'false' (an
 * old DB upgrading through 156 → 172 must end ON), the key is delisted, a fresh install ends 'true', the handler
 * still bridges it to the Python env, and a deliberate 'false' survives the next start (172 is one-shot).
 * The fuller default-on contract (upgrade path, label, kill durability for both graduated keys) is
 * database/test_default_flip_156_159.js.
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
check('migration 172 (the graduation) stamped', applied.has(172));
check("a fresh install ends with name_role_nonname_flag === 'true' (mig 172 @DEFAULT_FLIP, 2026-09-16)",
      get('name_role_nonname_flag') === 'true');
check('name_role_nonname_flag is DELISTED from TEST_SWITCH_KEYS (so build_arming never disarms it on a release launch)',
      !TEST_SWITCH_KEYS.includes('name_role_nonname_flag'));

const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 156 is still an INSERT OR IGNORE seed of false (history preserved for the upgrade path)',
      /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('name_role_nonname_flag', 'false'\)/.test(src));
check("mig 172 is the ONLY writer of 'true' and it is a labelled UPSERT (never a numbered TEST force-ON)",
      (src.match(/VALUES \('name_role_nonname_flag', 'true'\)/g) || []).length === 1
      && /\/\/ @DEFAULT_FLIP 172\s*\n\s*if \(!applied\.has\(172\)\)/.test(src)
      && /INSERT INTO settings \(key, value\) VALUES \('name_role_nonname_flag', 'true'\) ON CONFLICT\(key\) DO UPDATE SET value = 'true'/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'name_role_nonname_flag'[\s\S]*?\];/.test(src));

const hsrc = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler maps name_role_nonname_flag → env.NAME_ROLE_NONNAME_FLAG',
      /getSetting\(db, 'name_role_nonname_flag', 'false'\) === 'true'\) env\.NAME_ROLE_NONNAME_FLAG = '1'/.test(hsrc));

db.prepare("UPDATE settings SET value = 'false' WHERE key = 'name_role_nonname_flag'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check("a deliberate 'false' survives the next start (mig 172 is one-shot, not a sweep — the setting stays the kill switch)",
      get('name_role_nonname_flag') === 'false');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
