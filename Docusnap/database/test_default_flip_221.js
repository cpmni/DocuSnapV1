'use strict';
/*
 * test_default_flip_221.js — @DEFAULT_FLIP 221 (2026-09-26, owner "flip suggested-teach first"; Oracle
 * SIGN-OFF-W/COND C1-C3): `suggested_teach_enabled` (mig 220, the guided-teach auto-draw) graduates DARK →
 * customer-default-ON + is DELISTED from dark_switches.js. Contract (the mig-206/215 shape): a fresh install
 * has it 'true'; an existing install seeded 'false' is UPSERT-flipped on upgrade; a deliberate 'false' AFTER
 * the flip survives (one-shot, not a sweep); the release gate accepts the labelled block; it is JS-only (no
 * Python env mirror — the wizard reads the setting into SUGGEST_ON, pinned in test_teach_suggest.js).
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/test_default_flip_221.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('./index');
const { TEST_SWITCH_KEYS } = require('./dark_switches');
const { scan } = require(path.join(REPO, 'scripts', 'check-release-migrations'));
let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const KEY = 'suggested_teach_enabled';

console.log('== @DEFAULT_FLIP 221: suggested_teach_enabled DARK → default-ON + DELISTED ==');

console.log('1. a fresh install');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check(`${KEY} is 'true' for a new install (flipped by 221)`, get(db, KEY) === 'true');
  check('migs 220 + 221 both stamped', [220, 221].every(v => !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(v)));
  check(`${KEY} is DELISTED from TEST_SWITCH_KEYS (graduated)`, !TEST_SWITCH_KEYS.includes(KEY));
  check('TEST_SWITCH_KEYS is 17 (mig 220 left it; the 4 DARK keys 216/217/218/219 + the 13 held remain)', TEST_SWITCH_KEYS.length === 17);
  db.close();
}
console.log("2. an existing install seeded 'false' is flipped ON on upgrade");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
  db.prepare('DELETE FROM migrations WHERE version = 221').run();
  quiet(() => runMigrations(db));
  check(`${KEY}: the seed 'false' is UPSERT-flipped to 'true' by mig 221`, get(db, KEY) === 'true');
  db.close();
}
console.log("3. kill durable — a deliberate 'false' AFTER the flip survives the next start (one-shot, not a sweep)");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
  quiet(() => runMigrations(db));
  check(`${KEY} stays 'false' across a relaunch`, get(db, KEY) === 'false');
  db.close();
}
console.log('4. the release gate accepts the labelled flip');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check('the block carries the @DEFAULT_FLIP 221 label', /@DEFAULT_FLIP 221/.test(src));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits;
  const bad = hits.filter(h => new RegExp(KEY).test(String(h.detail)));
  check('scan() reports no violation naming the flipped key (delisted + labelled)', bad.length === 0);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
