#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration140_name_grow_belts.js — mig 140 seeds the three NAME-GROW BELT keys OFF
 * (docs/designs/KEYWORD_SUPERSTRING_GROW_2026-09-08.md §6): template_name_grow_band_pick, template_name_cut_defer_cap,
 * keyword_superstring_name_note. Pins: seeded 'false', stamped, each key in TEST_SWITCH_KEYS (a test build arms it at
 * runtime — never a numbered force-ON), NO force-ON twin in the source, the JS bridge emits the env var iff 'true',
 * a later manual ON survives the next start (one-shot reset semantics), and the release gate still scans clean.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration140_name_grow_belts.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const H = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'));
const { scan } = require(path.join(ROOT, 'scripts', 'check-release-migrations'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const get = (db, k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const KEYS = [['template_name_grow_band_pick', 'TEMPLATE_NAME_GROW_BAND_PICK'],
              ['template_name_cut_defer_cap', 'TEMPLATE_NAME_CUT_DEFER_CAP'],
              ['keyword_superstring_name_note', 'KEYWORD_SUPERSTRING_NAME_NOTE']];
const REL = { testBuild: false, buildRev: 'release-pin' };

const db = new Database(':memory:');
const logs = [];
{ const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db, { identity: REL }); console.log = o; }
check('migration 140 stamped', new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version)).has(140));
check('the 140 console line says seeded OFF (DARK)', logs.some(l => /migration 140 applied/.test(l) && /seeded OFF/.test(l)));
for (const [k] of KEYS) check(`fresh install: ${k} = 'false'`, get(db, k) === 'false');
for (const [k] of KEYS) check(`${k} is a listed DARK test switch (runtime-armed on a test build)`, TEST_SWITCH_KEYS.includes(k));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
for (const [k] of KEYS) check(`NO force-ON twin of ${k} in the source`, !new RegExp(`VALUES \\('${k}', 'true'\\)`).test(src));
check('mig 140 carries its ⚑ FLIP GATE line', /migration 140:[\s\S]{0,1600}FLIP GATE/.test(src));
check('the release gate scan of index.js is still 0 hits', scan({ indexSrc: src }).hits.length === 0);
// The bridge: env var iff 'true'.
const envOff = H._reconcileEnv(db);
check('bridge OFF: none of the three env vars is set', KEYS.every(([, e]) => !(e in envOff)));
for (const [k] of KEYS) db.prepare("UPDATE settings SET value = 'true' WHERE key = ?").run(k);
const envOn = H._reconcileEnv(db);
check("bridge ON: each env var = '1'", KEYS.every(([, e]) => envOn[e] === '1'), JSON.stringify(KEYS.map(([, e]) => [e, envOn[e]])));
quiet(() => runMigrations(db, { identity: REL }));
check("a later manual ON survives the next start (mig 137's one-shot reset never re-fires)", KEYS.every(([k]) => get(db, k) === 'true'));
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
