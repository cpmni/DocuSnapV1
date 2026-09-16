'use strict';
/*
 * test_watch_separate_default_on.js — migration 175: watch-folder separation ON by default (2026-09-16).
 *
 * The watch folder runs the same multi-document separation pre-pass a manual import runs, so a bundled scan
 * dropped there is split into per-document segments (each HELD for review — the unattended-path belt in
 * src/modules/watch/handler.js, autoFileRun=false) instead of importing as one document under page 1's identity.
 * Gate: the soak of docs/designs/WATCH_SEPARATE_SOAK_GATE_2026-09-02.md, run 2026-09-16 in a sandbox
 * (TESTING/_measure/watch_separate_soak_20260916/) — analyzer PASS, the real 34-page bundle 34/34, 0 over-split,
 * 0 auto-filed segments. This pin is the flip's home: a future dev cannot silently drop it (returning watch
 * folders to whole-bundle imports) or re-list the key (which would let build_arming disarm it on a release
 * launch) without going red.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_watch_separate_default_on.js
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
const KEY = 'watch_separate_enabled';

console.log('1. a fresh install has watch-folder separation ON');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check(`${KEY} is 'true' for a new install`, get(db, KEY) === 'true');
  check('mig 175 stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 175').get());
  db.close();
}

console.log("\n2. an existing install left 'false' by the mig-137 dark reset is flipped ON on upgrade");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
  db.prepare('DELETE FROM migrations WHERE version = 175').run();
  quiet(() => runMigrations(db));
  check("the 'false' row is UPSERT-flipped to 'true' by mig 175", get(db, KEY) === 'true');
  db.close();
}

console.log("\n3. kill durable — a deliberate 'false' AFTER the flip survives the next start (one-shot, not a sweep)");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
  quiet(() => runMigrations(db));
  check(`${KEY} stays 'false' across a relaunch`, get(db, KEY) === 'false');
  db.close();
}

console.log('\n4. the key LEFT dark_switches.js (a listed key is disarmed on every release launch)');
check(`${KEY} is not in TEST_SWITCH_KEYS`, !TEST_SWITCH_KEYS.includes(KEY));

console.log('\n5. the flip is a labelled UPSERT migration the release gate accepts');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check('mig 175 block present + labelled @DEFAULT_FLIP directly above it', /\/\/ @DEFAULT_FLIP 175\s*\n\s*if \(!applied\.has\(175\)\)/.test(src));
  check(`mig 175 UPSERTs ${KEY} to 'true'`,
    new RegExp(`INSERT INTO settings \\(key, value\\) VALUES \\('${KEY}', 'true'\\) ON CONFLICT\\(key\\) DO UPDATE SET value = 'true'`).test(src));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => /175/.test(String(h.detail)) || String(h.detail).includes(KEY));
  check('the release gate raises NO hit on migration 175', hits.length === 0);
}

console.log('\n6. the watch handler still reads the setting and still HOLDS every fresh segment (the belt is not keyed on the flip)');
{
  const wsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'watch', 'handler.js'), 'utf8');
  check(`watch handler gates the pre-pass on ${KEY} === 'true'`, new RegExp(`getSetting\\(db, '${KEY}', 'false'\\) === 'true'`).test(wsrc));
  check('a freshly-split segment is processed with autoFileRun=false (held for review on the unattended path)',
    /const _autoFileRun = !\(heldNames && msg\.type === 'file_done' && heldNames\.has\(msg\.original_filename\)\)/.test(wsrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
