'use strict';
/*
 * test_default_promotion.js — migration 67, the second promotion round.
 *
 * WHY IT EXISTS. Chris's round-4 install reported "188 need your review, 12 ready" while the
 * owner's own install files ~92% of a batch. That is not a regression between builds — it is a
 * SETTINGS GAP: everything measured since migration 60 shipped dark, so the measured configuration
 * lived in one person's settings table and no customer ever got it.
 *
 * THE TWO PROPERTIES THAT MAKE A PROMOTION SAFE, both pinned here:
 *   1. it seeds ROWS, not code defaults, so the Settings screen tells the truth about what is on
 *      (migration 60 established this: flipping a code default leaves every switch RENDERING OFF
 *      while BEHAVING as on — the exact "off by default beside a switch that is on" contradiction
 *      the customer review called out);
 *   2. INSERT OR IGNORE, so an install where someone deliberately turned one of these OFF keeps it
 *      off. A promotion that overrides a customer's own choice is a different, worse bug.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_default_promotion.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('./index');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;

const KEYS = ['autofile_gate_unify', 'far_lowconf_valued_only', 'type_election_title_first',
              'reprocess_shadow_stale_drop', 'xcheck_corrob_note_demote', 'corroboration_autofile'];

console.log('\n1. a fresh install gets the measured configuration');
{
  const db = new Database(':memory:');
  runMigrations(db);
  for (const k of KEYS) check(`${k} is ON for a new customer`, get(db, k) === 'true');
  check('graduation_window is 5, not the legacy 10', get(db, 'graduation_window') === '5');
  db.close();
}

console.log('\n2. an existing choice is never overwritten');
{
  const db = new Database(':memory:');
  // Simulate an install that has already run everything up to 66 and deliberately turned two of
  // these OFF, then upgrade it.
  runMigrations(db);
  db.prepare("UPDATE settings SET value = 'false' WHERE key = 'autofile_gate_unify'").run();
  db.prepare("UPDATE settings SET value = '10'   WHERE key = 'graduation_window'").run();
  db.prepare('DELETE FROM migrations WHERE version = 67').run();       // pretend 67 never ran
  runMigrations(db);
  check('a deliberately-disabled switch stays off', get(db, 'autofile_gate_unify') === 'false');
  check('a hand-set numeric value is not reset', get(db, 'graduation_window') === '10');
  check('...while a key with no row at all is still seeded', get(db, 'corroboration_autofile') === 'true');
  db.close();
}

console.log('\n3. the promotion list is a RECORD, not a list of names');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  // Slice PROVEN_ON_DEFAULTS_2 ONLY. It must END at ALL_ON_DEFAULTS_93 (Oracle 2026-08-30): mig 93's list
  // legitimately CONTAINS some keys mig 67 excluded (name_corrob_note_demote, identity_scope_post_repair —
  // both promoted to the fresh-install default by mig 70 since 08-15), so a block that spanned it would make
  // the "genuinely NOT seeded" assertions below pass only by a comma-quote-vs-bracket-quote coincidence.
  const block = src.slice(src.indexOf('const PROVEN_ON_DEFAULTS_2'), src.indexOf('const ALL_ON_DEFAULTS_93'));
  check('every promoted key carries an annotation of what it bought',
        KEYS.every(k => new RegExp(`'${k}'[^\\n]*\\n?[^\\n]*//`).test(block) || block.includes(`// ${k}`)
                        || new RegExp(`\\['${k}',[^\\]]*\\],\\s*//`).test(block)));
  check('the corroborated route is promoted with its INERT measurement stated, not hidden',
        /INERT on this install \(919 -> 919\)/.test(block)
        && /Promoted on the Oracle sign-off \+ the owner running it live, not on\s*\n\s*\/\/ a number/.test(block));
  check('there is a NOT LISTED section with a reason per exclusion', /NOT LISTED, each for a reason/.test(block));
  for (const k of ['name_corrob_note_demote', 'identity_scope_post_repair', 'deskew_on_import',
                   'teach_identity_near_match_keep']) {
    check(`${k} is excluded, with its reason`, new RegExp(`${k}\\s+\\S`).test(block));
  }
  check('the excluded keys are genuinely NOT seeded',
        !/\['name_corrob_note_demote'/.test(block) && !/\['deskew_on_import'/.test(block)
        && !/\['identity_scope_post_repair'/.test(block));
}

console.log('\n4. every promoted key is actually read by a consumer (no dead seeds)');
{
  const readers = ['database/modules/trust.js', 'database/modules/documents.js',
                   'src/modules/processing/handler.js']
    .map(f => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n');
  for (const k of [...KEYS, 'graduation_window']) {
    check(`${k} has a live consumer`, readers.includes(`'${k}'`));
  }
}

console.log('\n5. migration 93 — all-on-except-straighten fresh-install defaults (2026-08-30)');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const listBlock = src.slice(src.indexOf('const ALL_ON_DEFAULTS_93 = ['), src.indexOf('function runJsMigrations'));
  const on93 = [...listBlock.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]);
  const db = new Database(':memory:');
  runMigrations(db);
  check(`ALL_ON_DEFAULTS_93 is a real list (${on93.length} keys)`, on93.length >= 140);
  const notOn = on93.filter(k => get(db, k) !== 'true');
  if (notOn.length) console.log('    keys NOT on: ' + notOn.join(', '));
  check('every ALL_ON_DEFAULTS_93 key is true on a fresh install', notOn.length === 0);
  const EXCL = ['deskew_on_import', 'telemetry_enabled', 'first_run_completed', 'tray_hint_shown',
                'dev_switches_unlocked', 'diagnostic_logging', 'detached_features_signed',
                'client_api_enabled', 'detached_search_seats'];
  check('no excluded key is seeded true', EXCL.every(k => get(db, k) !== 'true'));
  check('first_run_completed is unset (onboarding runs on a clean install)', get(db, 'first_run_completed') === undefined);
  // Oracle 2026-08-30: mig 89 DEFERRED these two as a fresh-install default until their non-owner-corpus
  // reprocess gate is eyeballed. mig 93 must NOT default them on. Pinning (d) so this decision can't regress.
  check('name_dominant_snap is NOT defaulted on (mig 89 deferral held)', get(db, 'name_dominant_snap') !== 'true');
  check('branding_strip_reg_boilerplate is NOT defaulted on (mig 89 deferral held)', get(db, 'branding_strip_reg_boilerplate') !== 'true');
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
