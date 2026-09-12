'use strict';
/**
 * database/build_arming.js — the ONLY road that turns a DARK test switch ON at scale.
 * (2026-09-08; pre-deployment audit P0-1; docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §2 slice 1.4; Oracle C2/C3.)
 *
 * Replaces the numbered "TEST-BUILD force-ON" migrations (deleted with mig 137). Runs at EVERY start, after
 * the migrations, unstamped:
 *
 *   TEST build   (extraMetadata.testBuild, or dev with TEST_BUILD=1):
 *       marker `test_build_armed_rev` !== this build's rev → UPSERT every TEST_SWITCH_KEYS 'true', marker = rev.
 *       Same rev again → nothing (an operator's OFF made after arming stands until the NEXT test build).
 *   RELEASE build (packaged, no testBuild) / plain dev:
 *       marker present AND it was written by a DIFFERENT build → UPSERT every key 'false', delete the marker.
 *       (The owner's reference DB armed by a test/dev build is disarmed on its first release launch — C3.)
 *       marker written by THIS build (an SFDEV hand on this very build, `manual@<rev>`) → nothing: a
 *       deliberate same-build choice is never fought. No marker → nothing (every customer DB).
 *
 * Every interim arming road writes the marker too (C3), else mig 137 (already stamped) never fires again and
 * the "reference DB ON forever" seam re-opens: scripts/arm-test-switches.js and the Settings SFDEV toggles
 * (settings/handler.js set-setting) stamp `manual@<rev>`.
 *
 * Dev (`!app.isPackaged`) uses the stable rev 'dev' so a new commit never disarms the owner's dev DB; a
 * packaged release rev never equals 'dev' or a `-TEST` rev, so the release disarm always fires exactly once.
 *
 * Excluded by construction: money_sign_capture (a real default) and ocr_parallel_import_enabled (mig 139's key)
 * are not in TEST_SWITCH_KEYS — a disarm can never un-promote them.
 */
const { TEST_SWITCH_KEYS } = require('./dark_switches');

const MARKER = 'test_build_armed_rev';
// The set of keys a prior arm recorded (JSON list). Lets a SAME-rev arm turn on ONLY keys never armed
// before (a fix added since the last arm) without clobbering an operator's deliberate OFF on an
// already-armed key — so a newly-added DARK fix is active on the next `TEST_BUILD=1 npm start` with no
// full re-arm dance. Generic settings key (NOT a TEST_SWITCH_KEY literal → the release gate still sees 0 hits).
const ARMED_KEYS = 'test_build_armed_keys';

function _get(db, key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}
function _setAll(db, value) {
  const up = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  let n = 0;
  for (const k of TEST_SWITCH_KEYS) n += up.run(k, value).changes;
  return n;
}
/** The keys a prior arm recorded. Missing (a DB armed before this bookkeeping existed) ⇒ infer from the
 *  keys currently 'true', so the first same-rev arm after this change touches ONLY currently-off keys (a
 *  new fix), never re-arming one an operator turned off. */
function _armedKeySet(db) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(ARMED_KEYS);
  if (r && r.value) { try { const a = JSON.parse(r.value); if (Array.isArray(a)) return a; } catch { /* fall through */ } }
  return TEST_SWITCH_KEYS.filter(k => _get(db, k) === 'true');
}
function _recordArmedKeys(db) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(ARMED_KEYS, JSON.stringify([...TEST_SWITCH_KEYS]));
}

/** The rev a marker was written under: 'r1' → 'r1', 'manual@r1' → 'r1'. */
function markerRev(marker) {
  if (marker == null) return null;
  const s = String(marker);
  return s.startsWith('manual@') ? s.slice('manual@'.length) : s;
}

/** Stamp the marker for an interim/manual arming road (C3). */
function writeArmMarker(db, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(MARKER, String(value));
}

/** Force every test switch OFF and drop the marker (the explicit `arm-test-switches.js --off` road). */
function disarmTestSwitches(db) {
  const n = _setAll(db, 'false');
  db.prepare('DELETE FROM settings WHERE key = ?').run(MARKER);
  db.prepare('DELETE FROM settings WHERE key = ?').run(ARMED_KEYS);
  return { action: 'disarmed', n };
}

/**
 * armTestSwitches(db, { testBuild, buildRev }) → { action: 'armed'|'disarmed'|'noop', n, marker }
 * Pure over the DB; identity is injected (resolveIdentity() below for the app, explicit in pins).
 */
function armTestSwitches(db, identity) {
  const { testBuild = false, buildRev = 'dev' } = identity || {};
  const rev = String(buildRev || 'dev');
  const marker = _get(db, MARKER);
  if (testBuild) {
    if (markerRev(marker) === rev) {
      // Same build (dev is always rev 'dev'): arm ONLY keys never armed before (a fix added since the last
      // arm). An operator's deliberate OFF on an already-armed key is in `prior` → never re-armed. This is
      // what makes a newly-added DARK fix active on the next `TEST_BUILD=1 npm start` without a full re-arm.
      const prior = _armedKeySet(db);
      const newKeys = TEST_SWITCH_KEYS.filter(k => !prior.includes(k));
      if (newKeys.length === 0) return { action: 'noop', n: 0, marker };
      const up = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
      let n = 0; for (const k of newKeys) n += up.run(k, 'true').changes;
      writeArmMarker(db, rev);
      _recordArmedKeys(db);
      return { action: 'armed', n, marker: rev, newKeys };
    }
    const n = _setAll(db, 'true');   // a DIFFERENT rev (a new test build): full re-arm — prior OFFs are stale
    writeArmMarker(db, rev);
    _recordArmedKeys(db);
    return { action: 'armed', n, marker: rev };
  }
  if (marker == null) return { action: 'noop', n: 0, marker: null };
  if (markerRev(marker) === rev) return { action: 'noop', n: 0, marker };   // this build's own SFDEV hand stands
  return disarmTestSwitches(db);
}

/**
 * The app's identity: packaged reads the baked package.json (extraMetadata.testBuild / buildRev from
 * scripts/build-electron.js); unpackaged dev is a test build only under TEST_BUILD=1 and always rev 'dev'.
 * Safe under Electron-as-Node (require('electron') is a path string there → not packaged).
 */
function resolveIdentity() {
  let packaged = false;
  try { const e = require('electron'); packaged = !!(e && e.app && e.app.isPackaged); } catch { /* plain node */ }
  let pkg = {};
  try { pkg = require('../package.json') || {}; } catch { /* no package.json */ }
  if (packaged) return { testBuild: pkg.testBuild === true || pkg.testBuild === 'true', buildRev: String(pkg.buildRev || pkg.version || 'packaged') };
  return { testBuild: process.env.TEST_BUILD === '1', buildRev: 'dev' };
}

module.exports = { MARKER, ARMED_KEYS, armTestSwitches, disarmTestSwitches, writeArmMarker, markerRev, resolveIdentity };
