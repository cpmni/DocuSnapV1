'use strict';
/*
 * test_default_flip_215.js — the 215 BATCH graduation (2026-09-24 evening, owner "flip 207, 210, 212, 213 and 214"):
 * glyph_fallback_enabled (207) · glyph_confusable_resolve (210) · glyph_slice_integrity (212) · name_value_label_flag
 * (213) · taught_name_disagree_refuse (214) → ON by default + DELISTED from dark_switches.js. glyph_confusable_release
 * (211) stays DARK. Contract (the mig-206 shape): a fresh install has every flipped key 'true'; an existing install
 * seeded 'false' is UPSERT-flipped on upgrade; a deliberate 'false' AFTER the flip survives (one-shot, not a sweep);
 * the release gate accepts the labelled block; the env mirrors follow the setting.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/test_default_flip_215.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('./index');
const { TEST_SWITCH_KEYS } = require('./dark_switches');
const { scan } = require(path.join(REPO, 'scripts', 'check-release-migrations'));
const H = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const FLIP = ['glyph_fallback_enabled', 'glyph_confusable_resolve', 'glyph_slice_integrity', 'name_value_label_flag', 'taught_name_disagree_refuse'];
const STAY = ['glyph_confusable_release', 'corrob_date_fold_wide', 'recon_singlechar_misread_flag'];

console.log('== the 215 batch: 207 / 210 / 212 / 213 / 214 graduate, 211 / 208 / 209 stay DARK ==');
console.log('1. a fresh install');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  for (const k of FLIP) check(`${k} is 'true' for a new install`, get(db, k) === 'true');
  for (const k of STAY) check(`${k} stays 'false' (DARK)`, get(db, k) === 'false');
  check('mig 215 stamped (and the five seeds 207/210/212/213/214)', [215, 207, 210, 212, 213, 214].every(v => !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(v)));
  for (const k of FLIP) check(`${k} is DELISTED from TEST_SWITCH_KEYS`, !TEST_SWITCH_KEYS.includes(k));
  for (const k of STAY) check(`${k} is still LISTED (DARK)`, TEST_SWITCH_KEYS.includes(k));
  check('TEST_SWITCH_KEYS is 15 (13 after this batch + quiet_redetect_on_type_change mig 216 + type_owner_uninstalled_block mig 217, 2026-09-25)', TEST_SWITCH_KEYS.length === 15);
  // the env mirrors follow the setting → every Python spawn on a fresh install sees the flipped engine gates
  const e = H._reconcileEnv(db);
  check('fresh install spawn env: GLYPH_FALLBACK_ENABLED / GLYPH_CONFUSABLE_RESOLVE / GLYPH_SLICE_INTEGRITY / NAME_VALUE_LABEL_FLAG all "1"',
        e.GLYPH_FALLBACK_ENABLED === '1' && e.GLYPH_CONFUSABLE_RESOLVE === '1' && e.GLYPH_SLICE_INTEGRITY === '1' && e.NAME_VALUE_LABEL_FLAG === '1');
  check('…and GLYPH_CONFUSABLE_RELEASE stays absent (211 DARK)', !('GLYPH_CONFUSABLE_RELEASE' in e));
  check('trust.js reads taught_name_disagree_refuse ON', trust._taughtNameDisagreeEnabled(db) === true);
  db.close();
}
console.log("2. an existing install seeded 'false' is flipped ON on upgrade");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  for (const k of FLIP) db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(k);
  db.prepare('DELETE FROM migrations WHERE version = 215').run();
  quiet(() => runMigrations(db));
  for (const k of FLIP) check(`${k}: the seed 'false' is UPSERT-flipped to 'true' by mig 215`, get(db, k) === 'true');
  db.close();
}
console.log("3. kill durable — a deliberate 'false' AFTER the flip survives the next start (one-shot, not a sweep)");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  for (const k of FLIP) db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(k);
  quiet(() => runMigrations(db));
  for (const k of FLIP) check(`${k} stays 'false' across a relaunch`, get(db, k) === 'false');
  db.close();
}
console.log('4. the release gate accepts the labelled batch');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check('the block carries the @DEFAULT_FLIP 215 label', /@DEFAULT_FLIP 215/.test(src));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits;
  const bad = hits.filter(h => FLIP.some(k => new RegExp(k).test(String(h.detail))));
  check('scan() reports no violation naming a flipped key (delisted + labelled)', bad.length === 0);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
