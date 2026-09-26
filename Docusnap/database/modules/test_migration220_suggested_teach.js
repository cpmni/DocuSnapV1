#!/usr/bin/env node
'use strict';
/**
 * test_migration220_suggested_teach.js — mig 220 seeds `suggested_teach_enabled` OFF (2026-09-25; owner idea
 * "suggest the boxes I read"; advisor round 007+reggie+eric → Oracle SIGN-OFF-W/COND, DARK). The host surface
 * is the GUIDED TEACH WIZARD (owner re-scope: "I didn't want it in Review") — no Python, no handler env bridge
 * (contrast mig 219). GRADUATED via @DEFAULT_FLIP 221 (2026-09-26): DELISTED from TEST_SWITCH_KEYS (now 17), a
 * fresh install has it ON. Pins: migs 220+221 stamped, fresh install 'true', delisted, the flip is a labelled
 * @DEFAULT_FLIP 221 UPSERT, a deliberate OFF after the flip survives (one-shot); the wizard reads the setting +
 * fires maybeSuggestField reusing the shipped locateTypedValue; the ⊕ Review wiring + the Review-only
 * SuggestTeach reducer were removed. (Deep C-A/C-B/exclusion + C1 wiring: src/windows/teach/test_teach_suggest.js.)
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

console.log('\n1. mig 220 seed → GRADUATED via @DEFAULT_FLIP 221 (2026-09-26, owner "flip suggested-teach first"; Oracle SIGN-OFF-W/COND)');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migrations 220 + 221 both stamped', applied.has(220) && applied.has(221));
check('the 221 flip line says ON by default', logs.some(l => /migration 221 applied/.test(l) && /ON by default/.test(l)));
check(`a fresh install has ${KEY} === 'true' (flipped ON by 221)`, get(db, KEY) === 'true');
check(`${KEY} is DELISTED from TEST_SWITCH_KEYS (graduated)`, !TEST_SWITCH_KEYS.includes(KEY));
check('TEST_SWITCH_KEYS is 17 keys', TEST_SWITCH_KEYS.length === 17 && new Set(TEST_SWITCH_KEYS).size === 17);
const src = norm(fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8'));
check('mig 220 seed (INSERT OR IGNORE false) is intact upstream of the flip', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('the flip is a labelled @DEFAULT_FLIP 221 UPSERT to true', /@DEFAULT_FLIP 221/.test(src) && new RegExp(`VALUES \\('${KEY}', 'true'\\) ON CONFLICT`).test(src));
// kill durable — a deliberate OFF set AFTER the flip survives the next start (mig 221 is a stamped one-shot)
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'false');
{ const o = console.log; console.log = () => {}; runMigrations(db); console.log = o; }
check('a deliberate OFF after the flip survives the next start (mig 221 one-shot)', get(db, KEY) === 'false');
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
