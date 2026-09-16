'use strict';
/*
 * test_segment_hold_default.js — migration 176: the split-segment "look first" hold seeded ON (2026-09-16;
 * gary → Oracle SIGN-OFF-W/COND; owner go). A multi-page segment of a heuristic split is held for one
 * human look on both arrival paths. Hold-only: it never files and never edits a value, so it ships as a
 * plain INSERT OR IGNORE seed of an UNLISTED key (the mig-169 shape) — not a DARK reading fix. A deliberate
 * 'false' is the durable kill. This pin is the seed's home: a future dev cannot drop the seed, force it by
 * UPSERT, or list the key in dark_switches (which would disarm it on every release launch) without going red.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_segment_hold_default.js
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
const KEY = 'split_segment_multipage_hold';

console.log('1. a fresh install has the hold ON');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check(`${KEY} is 'true' for a new install`, get(db, KEY) === 'true');
  check('mig 176 stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 176').get());
  db.close();
}

console.log("\n2. kill durable — a deliberate 'false' survives the next start (a seed, never a sweep)");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
  quiet(() => runMigrations(db));
  check(`${KEY} stays 'false' across a relaunch`, get(db, KEY) === 'false');
  db.prepare('DELETE FROM migrations WHERE version = 176').run();
  quiet(() => runMigrations(db));
  check("…even if mig 176 re-ran (INSERT OR IGNORE respects the operator's row)", get(db, KEY) === 'false');
  db.close();
}

console.log('\n3. not a DARK key — never listed, never force-ON, gate-clean');
{
  check(`${KEY} is NOT in TEST_SWITCH_KEYS (a listed key is disarmed on every release launch)`, !TEST_SWITCH_KEYS.includes(KEY));
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check('mig 176 seeds by INSERT OR IGNORE', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'true'\\)`).test(src));
  check("no UPSERT/UPDATE-to-'true' of the key anywhere in index.js", !new RegExp(`'${KEY}'[^\\n]*ON CONFLICT`).test(src) && !new RegExp(`UPDATE settings SET value = 'true' WHERE key = '${KEY}'`).test(src));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => /176/.test(String(h.detail)) || String(h.detail).includes(KEY));
  check('the release gate raises NO hit on migration 176', hits.length === 0);
}

console.log('\n4. the consumer reads the setting with the same default (a rowless DB still holds)');
{
  const hsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check(`handler gates the stamp on getSetting(db, '${KEY}', 'true') === 'true'`, hsrc.includes(`learning.getSetting(db, '${KEY}', 'true') === 'true'`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
