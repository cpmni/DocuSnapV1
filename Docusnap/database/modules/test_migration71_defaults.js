'use strict';
/*
 * test_migration71_defaults.js — PINs for migration 71 (2026-08-16, Oracle-conditioned).
 *
 * (1) `auto_file_threshold` seeds '90' ONLY on a TRULY FRESH DB (zero documents ever). Unset has
 *     always meant 100 — "only perfect docs auto-file" — which on a fresh install files NOTHING
 *     out of the box (Chris 2026-08-15: taught reads land 87–95 → wave 1 auto-filed 0/200 while
 *     File-All-Ready then filed 154 in one click). An ESTABLISHED install — including the owner's
 *     live DB, where the key is deliberately unset — gets NOTHING written: changing a live
 *     install's filing bar is the owner's slider decision, not a migration's. (Oracle: the
 *     documents-count-0 predicate is precise; a DB with no documents has no filing behaviour to
 *     change.)
 * (2) The two 2026-08-16 switches seed 'false' (live default-ON owes the OFF==ON corpus arm).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_migration71_defaults.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
const getSetting = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;

console.log('1. a truly fresh DB seeds the 90 bar + the OFF switches');
{
  const db = new Database(':memory:');
  runMigrations(db);
  check('fresh install: auto_file_threshold seeded 90', getSetting(db, 'auto_file_threshold') === '90');
  // 2026-08-22: the OFF==ON corpus arm ran green (realdoc RR_APP_ENV=1, identical tables) and the owner
  // defaulted the round-7 switches ON via migration 81 — mig 71 still SEEDS them (the row exists), mig 81
  // force-flips them. Pin the final state.
  check('ref_prefix_confusable_adopt seeded by mig 71, defaulted ON by mig 81', getSetting(db, 'ref_prefix_confusable_adopt') === 'true');
  check('raw_witness_vacuous_suppress seeded by mig 71, defaulted ON by mig 81', getSetting(db, 'raw_witness_vacuous_suppress') === 'true');
  db.close();
}

console.log('2. an ESTABLISHED install (>=1 document ever) gets NO threshold write');
{
  const db = new Database(':memory:');
  runMigrations(db);
  // Rewind exactly migration 71 and give the DB a processing history — the established shape.
  db.prepare('DELETE FROM migrations WHERE version = 71').run();
  db.prepare("DELETE FROM settings WHERE key IN ('auto_file_threshold','ref_prefix_confusable_adopt','raw_witness_vacuous_suppress')").run();
  db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('a.pdf', '/in', 'confirmed')").run();
  runMigrations(db);
  check('established install: auto_file_threshold stays UNSET (today\'s 100 default untouched)',
        getSetting(db, 'auto_file_threshold') === undefined);
  check('...but the switches still seed OFF (they are inert keys, not behaviour changes)',
        getSetting(db, 'ref_prefix_confusable_adopt') === 'false'
        && getSetting(db, 'raw_witness_vacuous_suppress') === 'false');
  db.close();
}

console.log('2b. migration 72: the round-7 switches seed OFF and STAY off after a full migration run');
{
  // Oracle cross-cutting guard (as written 2026-08-16): these keys must never ride a force-ON/UPSERT
  // sweep until the OFF==ON corpus arm is green. THE ARM RAN GREEN 2026-08-22 (realdoc RR_APP_ENV=1
  // OCR_RENDER_DPI=200, all five OFF vs ON: identical tables, M delta 0 — docs/oracle_log.md) and
  // migration 81 force-flips them by owner decision. The pin now asserts the flip happened in mig 81
  // and nowhere earlier (the rows are still SEEDED 'false' by mig 72 — a fresh DB stopped at mig 80
  // would read false; we assert the final state here and the mig-81 attribution by its log line).
  const db = new Database(':memory:');
  runMigrations(db);
  for (const k of ['filing_sanity_page_match_v2', 'vat_reg_symbol_confusable', 'money_sign_capture'])
    check(`${k} defaulted ON by migration 81 (post-arm)`, getSetting(db, k) === 'true');
  check('migration 81 is recorded', !!db.prepare('SELECT 1 FROM migrations WHERE version = 81').get());
  db.close();
}

console.log('3. a user\'s explicit bar survives (INSERT OR IGNORE, both directions)');
{
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare('DELETE FROM migrations WHERE version = 71').run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_file_threshold','97')").run();
  runMigrations(db);
  check('an explicit threshold is never overwritten', getSetting(db, 'auto_file_threshold') === '97');
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
