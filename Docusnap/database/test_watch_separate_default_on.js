'use strict';
/*
 * test_watch_separate_default_on.js — watch separation follows the IMPORT switches (G5, 2026-09-21, opt-in-split).
 *
 * HISTORY: mig 175 (2026-09-16) turned a STANDALONE `watch_separate_enabled` ON by default. 2026-09-21 RETIRED that
 * switch as part of the opt-in-split feature (docs/designs/OPTIN_SPLIT_2026-09-20.md). The watch folder now enters
 * the multi-document separation pre-pass under the SAME conditions a manual import does:
 *   auto-detect split ON (`auto_separate_enabled`, OPT-IN since mig 194) OR separator sheets ON (`filing_slips_enabled`).
 * `separateFiles` itself then picks the correct arm(s). Freshly-split segments are still HELD for review on the
 * unattended path (autoFileRun=false).
 *
 * This pin is the retirement's home: a future dev cannot silently reintroduce the standalone `watch_separate_enabled`
 * gate, re-couple the watch handler to it, or lose the "held for review" belt without going red.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_watch_separate_default_on.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('./index');

let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

console.log('1. a fresh install has auto-detect separation OFF (opt-in, mig 194) and mig 194 stamped');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check("auto_separate_enabled is 'false' for a new install", get(db, 'auto_separate_enabled') === 'false');
  check('mig 194 stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 194').get());
  db.close();
}

console.log('\n2. the watch handler NO LONGER reads the retired standalone switch');
{
  const wsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'watch', 'handler.js'), 'utf8');
  // The literal may still appear in a "RETIRED" comment — what must be gone is any READ of it.
  check('watch handler does not getSetting(watch_separate_enabled)', !/getSetting\([^)]*watch_separate_enabled/.test(wsrc));
}

console.log('\n3. the watch handler enters separation on auto_separate_enabled OR filing_slips_enabled');
{
  const wsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'watch', 'handler.js'), 'utf8');
  check("reads auto_separate_enabled === 'true'", /getSetting\(db, 'auto_separate_enabled', 'false'\) === 'true'/.test(wsrc));
  check("reads filing_slips_enabled === 'true'", /getSetting\(db, 'filing_slips_enabled', 'false'\) === 'true'/.test(wsrc));
}

console.log('\n4. the unattended-path belt still holds every fresh segment (autoFileRun=false; not keyed on any flip)');
{
  const wsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'watch', 'handler.js'), 'utf8');
  check('a freshly-split segment is processed with autoFileRun=false (held for review)',
    /const _autoFileRun = !\(heldNames && msg\.type === 'file_done' && heldNames\.has\(msg\.original_filename\)\)/.test(wsrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
