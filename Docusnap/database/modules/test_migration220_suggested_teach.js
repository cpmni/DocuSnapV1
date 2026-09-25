#!/usr/bin/env node
'use strict';
/**
 * test_migration220_suggested_teach.js — mig 220 seeds `suggested_teach_enabled` OFF (2026-09-25; owner idea
 * "suggest the boxes I read"; advisor round 007+reggie+eric → Oracle SIGN-OFF-W/COND, DARK). The host surface
 * is the GUIDED TEACH WIZARD (owner re-scope: "I didn't want it in Review") — no Python, no handler env bridge
 * (contrast mig 219). Pins: stamped, seeded 'false', listed in TEST_SWITCH_KEYS (18 keys), single-key seed,
 * no force-ON twin, a later manual ON survives; the wizard reads the setting + fires maybeSuggestField reusing
 * the shipped locateTypedValue; the ⊕ Review wiring + the Review-only SuggestTeach reducer were removed.
 * Byte-identical off. (Deep C-A/C-B/exclusion wiring: src/windows/teach/test_teach_suggest.js.)
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration220_suggested_teach.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const KEY = 'suggested_teach_enabled';
const norm = (s) => s.replace(/\r\n/g, '\n');

console.log('\n1. mig 220 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 220 stamped', applied.has(220));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 220 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'false'`, get(db, KEY) === 'false');
check(`${KEY} is listed in TEST_SWITCH_KEYS`, TEST_SWITCH_KEYS.includes(KEY));
check('TEST_SWITCH_KEYS is 18 keys', TEST_SWITCH_KEYS.length === 18 && new Set(TEST_SWITCH_KEYS).size === 18);
const src = norm(fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8'));
check('single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('NO force-ON of the key anywhere in the migrations', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(src));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true');
{ const o = console.log; console.log = () => {}; runMigrations(db); console.log = o; }
check('a later manual ON survives the next start (the seed is INSERT OR IGNORE)', get(db, KEY) === 'true');
db.close();

console.log('\n2. RENDERER/shared-JS only — no Python engine env, no handler bridge (contrast mig 219)');
const h = norm(fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8'));
check('no engine env bridge for this key (Slice 1 touches no Python)', !/SUGGESTED_TEACH/.test(h));

console.log('\n3. the GUIDED TEACH WIZARD gates the suggest hook on the setting (the host surface — NOT Review)');
const w = norm(fs.readFileSync(path.join(ROOT, 'src', 'windows', 'shared', 'teach-ui', 'teach.js'), 'utf8'));
check('the wizard reads suggested_teach_enabled into SUGGEST_ON (default OFF)',
      /let SUGGEST_ON = false;/.test(w) && /getSetting\?\.\('suggested_teach_enabled'\)/.test(w));
check('promptField fires maybeSuggestField (the per-field auto-suggest)', /maybeSuggestField\(f\);/.test(w));
check('it reuses ValueLocate via the shipped locateTypedValue (no new engine, no removed reducer)',
      /await locateTypedValue\(/.test(w) && !/SuggestTeach/.test(w));
// The deep C-A/C-B/exclusion wiring is pinned in src/windows/teach/test_teach_suggest.js.

console.log('\n4. the ⊕ Review surface was REMOVED (owner: not in Review) — the Review-only reducer is gone');
const r = norm(fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'renderer.js'), 'utf8'));
check('the review renderer no longer references the suggest feature', !/suggested_teach_enabled|suggestTeachBoxes/.test(r));
check('the Review-only shared/suggestTeach.js reducer was deleted',
      !fs.existsSync(path.join(ROOT, 'src', 'windows', 'shared', 'suggestTeach.js')));

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
