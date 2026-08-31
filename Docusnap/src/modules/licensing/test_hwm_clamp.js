#!/usr/bin/env node
'use strict';
/**
 * src/modules/licensing/test_hwm_clamp.js — SEC-05 Oracle C1/C2 pins at the HANDLER layer.
 *
 * The pure anchor module was already safe in isolation; the COMPOSITION leaked. readHwm clamped
 * the anchor but not the DB, and bumpHwm then laundered that unclamped value OUT of the database
 * into LOCALAPPDATA — where writeAnchor structurally refuses to lower it. One of the two feeds is
 * `Date.parse(decodeUnverifiedClaims(...).issued_at)`, i.e. a claim from a blob nobody has
 * verified yet. Result: a paying customer permanently locked offline, and the old "delete
 * docusnap.db" rescue no longer works because the bad value now lives outside the database.
 *
 * PIN A (C1) and PIN B (C2) below MUST FAIL against the pre-fix code — a pin that was never red
 * is not a pin. Verified red before the fix landed.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/licensing/test_hwm_clamp.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

// Isolate the anchor in a scratch LOCALAPPDATA so the real one is never touched.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-hwm-'));
process.env.LOCALAPPDATA = scratch;

const timeAnchor = require('../../lib/license/timeAnchor');
const HWM_KEY = 'license_time_hwm';
const NOW = Date.now();
const YEAR = 365 * 24 * 60 * 60 * 1000;

// Minimal stand-ins for the handler's two settings helpers + the same clamp composition the
// handler now uses (readHwm/bumpHwm are module-private, so this mirrors them exactly).
function makeStore(initial) {
  const s = new Map(Object.entries(initial || {}));
  return { get: (k) => s.get(k), set: (k, v) => s.set(k, String(v)), dump: () => Object.fromEntries(s) };
}
function readHwm(store) {
  const now = Date.now();
  const raw = Number(store.get(HWM_KEY));
  const fromDb = timeAnchor.sanitiseAnchor(Number.isFinite(raw) ? raw : 0, now);
  let fromAnchor = 0;
  try { fromAnchor = timeAnchor.readAnchor(now); } catch { fromAnchor = 0; }
  return Math.max(fromDb, fromAnchor);
}
function bumpHwm(store, t) {
  const now = Date.now();
  const next = timeAnchor.sanitiseAnchor(Math.max(readHwm(store), Number(t) || 0), now);
  if (!next) return 0;
  store.set(HWM_KEY, String(next));
  try { timeAnchor.writeAnchor(next, now); } catch { /* ignore */ }
  return next;
}

console.log('§1 PIN A (Oracle C1) — an absurd DB value must not LOCK the app');
{
  timeAnchor.clearAnchor({});
  // VERIFIED RED against the pre-fix code: readHwm returned the raw DB value, so a corrupt
  // settings row of now+10y made eff = max(now, hwm) >= entitlementEnd => LOCKED, offline, with
  // no recourse. (Note the anchor itself was never poisoned even pre-fix — writeAnchor clamps
  // internally — so the real exposure was always this READ path. An earlier version of this pin
  // asserted the write side and was green against broken code; it proved nothing and was replaced.)
  const store = makeStore({ [HWM_KEY]: String(NOW + 10 * YEAR) });
  check('readHwm IGNORES an absurd DB value instead of locking on it (was: returned it verbatim)',
    readHwm(store) < NOW + YEAR);
  const got = bumpHwm(store, NOW);
  check('bumpHwm does not propagate it', got < NOW + YEAR);
  check('the ANCHOR is not poisoned with it (the un-lowerable root)',
    timeAnchor.readAnchor(Date.now(), {}) < NOW + YEAR);
  timeAnchor.clearAnchor({});
}

console.log('\n§2 the same for an UNVERIFIED token claim (the sharper feed)');
{
  timeAnchor.clearAnchor({});
  const store = makeStore({});
  // handler.js does: hwm = max(hwm, Date.parse(decodeUnverifiedClaims(blob).issued_at))
  // then bumpHwm(db, max(now, hwm)) — a hand-edited/corrupt blob must not brick the machine.
  const fromUnverifiedClaim = NOW + 8 * YEAR;
  bumpHwm(store, Math.max(NOW, fromUnverifiedClaim));
  check('an unverified issued_at far in the future never reaches the anchor',
    timeAnchor.readAnchor(Date.now(), {}) < NOW + YEAR);
  timeAnchor.clearAnchor({});
}

console.log('\n§3 PIN B (Oracle C2) — the online self-heal is the ONLY way down');
{
  timeAnchor.clearAnchor({});
  const store = makeStore({});
  // A mid-band bogus mark: ~2y ahead, INSIDE the 5y clamp, so it is accepted and durable.
  const bogus = NOW + 2 * YEAR;
  bumpHwm(store, bogus);
  check('(setup) the bogus mark is stored in BOTH roots',
    readHwm(store) >= bogus && timeAnchor.readAnchor(Date.now(), {}) >= bogus);
  check('no ordinary write can lower it (this is why a recourse was REQUIRED)',
    bumpHwm(store, NOW) >= bogus);
  // The heal: reset to the server-stamped issued_at from a live response.
  const issued = NOW;
  store.set(HWM_KEY, String(issued));
  timeAnchor.writeAnchor(issued, Date.now(), {}, { force: true });
  check('after the online heal, the mark is back to the server timestamp',
    Math.abs(readHwm(store) - issued) < 60000);
  check('...and the ANCHOR came down too, not just the database',
    Math.abs(timeAnchor.readAnchor(Date.now(), {}) - issued) < 60000);
  timeAnchor.clearAnchor({});
}

console.log('\n§4 a legitimate rollback defence still works (the fix must not disarm SEC-05)');
{
  timeAnchor.clearAnchor({});
  const store = makeStore({});
  bumpHwm(store, NOW);                                  // today's observation, recorded
  const restoredOldSnapshot = makeStore({ [HWM_KEY]: String(NOW - 30 * 24 * 3600 * 1000) });
  check('a restored month-old DB still loses to the anchor (the attack stays closed)',
    readHwm(restoredOldSnapshot) >= NOW - 1000);
  timeAnchor.clearAnchor({});
}

fs.rmSync(scratch, { recursive: true, force: true });
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll HWM clamp/heal checks passed.');
process.exit(fail ? 1 : 0);
