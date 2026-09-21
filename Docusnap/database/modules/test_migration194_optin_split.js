'use strict';
/*
 * test_migration194_optin_split.js — G4, the migration-DIRECTION pin for the opt-in split flip (2026-09-21;
 * docs/designs/OPTIN_SPLIT_2026-09-20.md).
 *
 * mig 194 makes auto-detect batch separation OPT-IN. It is a DE-ESCALATION (on→off default), so it uses
 * INSERT OR IGNORE — NOT a UPSERT, and NOT labelled @DEFAULT_FLIP:
 *   • an untouched install (no row) goes OFF;
 *   • a user who EXPLICITLY chose 'true' (the Settings toggle) keeps ON across the upgrade + every relaunch;
 *   • a user who chose 'false' stays OFF.
 * A future dev who "fixes" this to a UPSERT (which would silently force separation off for a user who wanted it
 * on) or adds an @DEFAULT_FLIP label goes red here.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_migration194_optin_split.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require(path.join(REPO, 'database', 'index'));
const { scan } = require(path.join(REPO, 'scripts', 'check-release-migrations'));

let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n}${x ? `  [${x}]` : ''}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const KEY = 'auto_separate_enabled';

console.log('1. a fresh install: no explicit row → OFF, mig 194 stamped');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check(`${KEY} is 'false' for a new install`, get(db, KEY) === 'false', get(db, KEY));
  check('mig 194 stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 194').get());
  db.close();
}

console.log("\n2. an explicit 'true' (a user who wants auto-split) SURVIVES the mig-194 upgrade");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'true' WHERE key = ?").run(KEY);
  db.prepare('DELETE FROM migrations WHERE version = 194').run();
  quiet(() => runMigrations(db));
  check("the explicit 'true' is preserved (INSERT OR IGNORE no-ops)", get(db, KEY) === 'true', get(db, KEY));
  db.close();
}

console.log("\n3. an explicit 'false' stays OFF across a relaunch");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
  quiet(() => runMigrations(db));
  check(`${KEY} stays 'false'`, get(db, KEY) === 'false');
  db.close();
}

console.log('\n4. mig 194 is an INSERT OR IGNORE de-escalation — NOT a UPSERT, NOT @DEFAULT_FLIP');
{
  const src = fs.readFileSync(path.join(REPO, 'database', 'index.js'), 'utf8');
  check('mig 194 uses INSERT OR IGNORE (not a UPSERT)',
    new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
  check('mig 194 has NO @DEFAULT_FLIP label above it',
    !/\/\/ @DEFAULT_FLIP 194\s*\n/.test(src));
  check('mig 194 does NOT UPSERT auto_separate_enabled',
    !new RegExp(`VALUES \\('${KEY}', '[^']*'\\) ON CONFLICT`).test(src));
  // The release gate must accept it (no unlabelled default-changing UPSERT to complain about).
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => /194/.test(String(h.detail)) || String(h.detail).includes(KEY));
  check('the release gate raises NO hit on migration 194', hits.length === 0, JSON.stringify(hits));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
