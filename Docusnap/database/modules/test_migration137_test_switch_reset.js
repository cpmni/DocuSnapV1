#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration137_test_switch_reset.js — mig 137 = the CUSTOMER-BUILD RESET of every DARK
 * test switch (pre-deployment audit P0-1; docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §2 slice 1.2; Oracle C1-C3).
 *
 * Pins:
 *   - a fresh install ends with every TEST_SWITCH_KEYS row 'false' and mig 137 stamped;
 *   - money_sign_capture (a legitimate ALL_ON_DEFAULTS_93 default, excluded from the list) stays 'true';
 *   - a "DB at 136" (the owner's reference DBs: the test switches ON, 137 not yet stamped) ends all 'false';
 *   - TEST_SWITCH_KEYS ∩ every UPSERT-'true' promotion list (ALL_ON_DEFAULTS_93 / mig 98 / mig 103) = ∅ (C2);
 *   - resolve_ref_near_miss ends 'false' (the 121 discharge → 124 re-force → 137 reset ordering);
 *   - THE TRADE-OFF: a manual 'true' written AFTER 137 survives the next start — 137 is one-shot, never a
 *     startup sweep (a sweep would undo an SFDEV choice every launch);
 *   - the source carries NO numbered force-ON of a listed key (the 13 blocks are gone; the release gate's
 *     scan reports 0 hits on database/index.js) and requires database/dark_switches.js.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration137_test_switch_reset.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS, TEST_BUILD_MIGS } = require(path.join(ROOT, 'database', 'dark_switches'));
const { scan } = require(path.join(ROOT, 'scripts', 'check-release-migrations'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const get = (db, k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const stamped = (db) => new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));

check('TEST_SWITCH_KEYS has 24 distinct keys', new Set(TEST_SWITCH_KEYS).size === 24 && TEST_SWITCH_KEYS.length === 24);
check('money_sign_capture + ocr_parallel_import_enabled are NOT listed', !TEST_SWITCH_KEYS.includes('money_sign_capture') && !TEST_SWITCH_KEYS.includes('ocr_parallel_import_enabled'));

// 1. Fresh install.
const db = new Database(':memory:');
const logs = [];
{ const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
check('migration 137 stamped on a fresh install', stamped(db).has(137));
check('the 137 console line names the reset', logs.some(l => /migration 137 applied/.test(l) && /reset OFF/.test(l)));
const notOff = TEST_SWITCH_KEYS.filter(k => get(db, k) !== 'false');
check("every TEST switch is 'false' on a fresh install", notOff.length === 0, notOff.join(','));
check("money_sign_capture stays 'true' (legit default, excluded)", get(db, 'money_sign_capture') === 'true');
check("resolve_ref_near_miss ends 'false' (121 → 124 → 137 ordering)", get(db, 'resolve_ref_near_miss') === 'false');
for (const n of TEST_BUILD_MIGS) if (stamped(db).has(n)) fails += 0; // historical stamps are fine on old DBs; a fresh DB simply never sees them
check('a fresh install never stamps a deleted test-build migration', !TEST_BUILD_MIGS.some(n => stamped(db).has(n)));

// 2. "DB at 136": the reference DBs — switches ON, 137 not stamped.
const db136 = new Database(':memory:');
quiet(() => runMigrations(db136));
db136.prepare('DELETE FROM migrations WHERE version = 137').run();
const on = db136.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'");
for (const k of TEST_SWITCH_KEYS) on.run(k);
check("fixture: every TEST switch is 'true' before the reset", TEST_SWITCH_KEYS.every(k => get(db136, k) === 'true'));
quiet(() => runMigrations(db136));
const still = TEST_SWITCH_KEYS.filter(k => get(db136, k) !== 'false');
check("a DB at 136 ends with every TEST switch 'false' after 137", still.length === 0, still.join(','));
check('137 stamped on the reconciled DB', stamped(db136).has(137));

// 3. THE TRADE-OFF: one-shot, never a sweep.
db136.prepare("UPDATE settings SET value = 'true' WHERE key = ?").run(TEST_SWITCH_KEYS[0]);
quiet(() => runMigrations(db136));
check(`a manual 'true' written AFTER 137 survives the next start (${TEST_SWITCH_KEYS[0]})`, get(db136, TEST_SWITCH_KEYS[0]) === 'true');

// 4. Source pins.
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
const listBody = (re) => { const m = re.exec(src); return m ? m[1] : ''; };
const allOn = listBody(/const ALL_ON_DEFAULTS_93\s*=\s*\[([\s\S]*?)\];/);
// index.js is CRLF on disk (core.autocrlf) — match either ending.
const mig98 = listBody(/\/\/ @DEFAULT_FLIP 98\r?\n\s*if \(!applied\.has\(98\)\) \{([\s\S]*?)\r?\n  \}/);
const mig103 = listBody(/\/\/ @DEFAULT_FLIP 103\r?\n\s*if \(!applied\.has\(103\)\) \{([\s\S]*?)\r?\n  \}/);
const inPromo = TEST_SWITCH_KEYS.filter(k => [allOn, mig98, mig103].some(b => b.includes(`'${k}'`)));
check('TEST_SWITCH_KEYS ∩ (ALL_ON_DEFAULTS_93 ∪ mig 98 ∪ mig 103) = ∅ (Oracle C2)', inPromo.length === 0, inPromo.join(','));
check('mig 98 / 103 bodies were located (the pin is not vacuous)', mig98.includes("'true'") && mig103.includes("'true'"));
check('index.js requires database/dark_switches.js', /require\('\.\/dark_switches'\)/.test(src));
check('no @TEST_BUILD_MIG sentinel remains', !/@TEST_BUILD_MIG/.test(src));
const forced = TEST_SWITCH_KEYS.filter(k => new RegExp(`VALUES \\('${k}', 'true'\\)`).test(src));
check('no literal UPSERT-true of a listed key remains', forced.length === 0, forced.join(','));
const { hits } = scan({ indexSrc: src });
check('the release gate scan of database/index.js reports 0 hits', hits.length === 0, hits.slice(0, 3).map(h => `[${h.belt}] :${h.line} ${h.detail}`).join(' | '));
check('every deleted test-build migration number has no block left', !TEST_BUILD_MIGS.some(n => new RegExp(`applied\\.has\\(${n}\\)`).test(src)));
check('mig 137 uses the UPSERT-to-false (mig-121) shape', /applied\.has\(137\)[\s\S]{0,400}ON CONFLICT\(key\) DO UPDATE SET value = 'false'/.test(src));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
