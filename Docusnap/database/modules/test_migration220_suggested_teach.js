#!/usr/bin/env node
'use strict';
/**
 * test_migration220_suggested_teach.js — mig 220 seeds `suggested_teach_enabled` OFF (2026-09-25; owner idea
 * "suggest the boxes I read"; advisor round 007+reggie+eric → Oracle SIGN-OFF-W/COND C1-C7, DARK).
 * Slice 1 of the ⊕ Review suggested-teach picker: RENDERER/shared-JS only — no Python, no handler env bridge
 * (contrast mig 219). Pins: stamped, seeded 'false', listed in TEST_SWITCH_KEYS (18 keys), single-key seed,
 * no force-ON twin, a later manual ON survives; the shared SuggestTeach reducer exists and stands on
 * ValueLocate; the review renderer gates the suggest hook on the setting. Byte-identical off.
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

console.log('\n3. the shared SuggestTeach reducer stands on ValueLocate');
const stPath = path.join(ROOT, 'src', 'windows', 'shared', 'suggestTeach.js');
check('shared/suggestTeach.js exists', fs.existsSync(stPath));
const st = norm(fs.readFileSync(stPath, 'utf8'));
check('it delegates location to ValueLocate.locateValueInWords', /ValueLocate\.locateValueInWords/.test(st));
check('it classifies none / unique / multiple', /'none'/.test(st) && /'unique'/.test(st) && /'multiple'/.test(st));
global.window = global; require(stPath);
const { suggestTeachState } = require(stPath);
check('exported and callable, returns a state', typeof suggestTeachState === 'function'
      && ['none', 'unique', 'multiple'].includes(suggestTeachState(['X'], { words: [], natW: 1, natH: 1 }).state));

console.log('\n4. the review renderer gates the suggest hook on the setting');
const r = norm(fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'renderer.js'), 'utf8'));
check('renderer reads suggested_teach_enabled', /suggested_teach_enabled/.test(r));
check('renderer loads the SuggestTeach reducer', /SuggestTeach|suggestTeach\.js/.test(r) || /suggestTeach/.test(norm(fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'index.html'), 'utf8'))));

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
