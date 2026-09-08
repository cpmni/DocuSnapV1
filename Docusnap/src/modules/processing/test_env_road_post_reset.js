#!/usr/bin/env node
'use strict';
/**
 * src/modules/processing/test_env_road_post_reset.js — the DB→spawn-env road after the customer-build reset
 * (docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §2 slice 1.3, the "env-road unit"). The cold corpus harness
 * inherits the shell env, so it can never prove that a 'false' settings row reaches Python as an UNSET env
 * var; this pin does, on the real builders (_reconcileEnv / _anchorCropEnv / _ocrDpiEnv):
 *
 *   1. LEARN the mapping — for each TEST_SWITCH_KEYS key, flip it 'true' alone and record which env vars
 *      appear (non-vacuous: at least 10 keys must map to an env var — the JS-only keys map to none);
 *   2. on a post-mig-137 DB (every key 'false') NONE of the learned vars is present;
 *   3. on a "reference DB at 136" (all 'true') every learned var IS present — the road is live both ways;
 *   4. a 'false' row and an ABSENT row produce the same env (the mig-137 UPSERT-to-false shape is exactly OFF).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/processing/test_env_road_post_reset.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const H = require(path.join(__dirname, 'handler.js'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const db = new Database(':memory:');
quiet(() => runMigrations(db, { identity: { testBuild: false, buildRev: 'release-pin' } }));
const set = (k, v) => db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, v);
const del = (k) => db.prepare('DELETE FROM settings WHERE key = ?').run(k);
const builders = ['_reconcileEnv', '_anchorCropEnv', '_ocrDpiEnv'].map(n => { check(`handler exports ${n}`, typeof H[n] === 'function'); return H[n]; }).filter(Boolean);
const envOf = () => Object.assign({}, ...builders.map(f => { try { return f(db) || {}; } catch (e) { return { __err: e.message }; } }));

const base = envOf();
check('the builders run on the post-reset DB', !base.__err, base.__err);

// 1. learn the mapping
const mapping = {};
for (const k of TEST_SWITCH_KEYS) {
  set(k, 'true');
  const e = envOf();
  mapping[k] = Object.keys(e).filter(v => e[v] !== base[v]);
  set(k, 'false');
}
const mapped = Object.entries(mapping).filter(([, vars]) => vars.length);
check(`at least 10 keys map to a spawn env var (non-vacuous; ${mapped.length} do)`, mapped.length >= 10, mapped.map(([k, v]) => `${k}→${v.join('/')}`).join(', '));
const learnedVars = new Set(mapped.flatMap(([, v]) => v));

// 2. post-137: none present
const after = envOf();
const leaked = [...learnedVars].filter(v => v in after);
check('post-mig-137 (every key false): NONE of the learned env vars is set', leaked.length === 0, leaked.join(','));
check('the post-reset env equals the pre-learning baseline (flipping and restoring left no residue)', JSON.stringify(after) === JSON.stringify(base));

// 3. reference DB at 136: all present
for (const k of TEST_SWITCH_KEYS) set(k, 'true');
const on = envOf();
const missing = [...learnedVars].filter(v => !(v in on));
check("a 'reference DB at 136' (all true): EVERY learned env var is set", missing.length === 0, missing.join(','));
for (const k of TEST_SWITCH_KEYS) set(k, 'false');

// 4. 'false' row == absent row
const withFalse = envOf();
for (const k of TEST_SWITCH_KEYS) del(k);
const withAbsent = envOf();
check("a 'false' row and an ABSENT row yield the same spawn env (UPSERT-to-false == OFF)", JSON.stringify(withFalse) === JSON.stringify(withAbsent));

console.log(`\n  mapping: ${mapped.map(([k, v]) => `${k}→${v.join('/')}`).join('; ')}`);
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
