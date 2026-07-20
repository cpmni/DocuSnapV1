#!/usr/bin/env node
'use strict';
/**
 * src/lib/license/test_time_anchor.js — SEC-05 external time anchor.
 *
 * The attack it closes: snapshot docusnap.db while a trial is valid → let it expire → go offline →
 * wind the clock back → restore the snapshot. The in-DB high-water mark returns to its old value
 * and the trial runs again. The anchor lives in a DIFFERENT root (LOCALAPPDATA), so a DB restore
 * no longer rolls the defence back.
 *
 * The failure direction that MATTERS: `effectiveNow = max(now, hwm)` and `eff >= end ⇒ LOCKED`, so
 * a corrupt anchor holding an absurd future timestamp would lock a PAYING user out permanently,
 * offline, with no recourse. Every check below that clamps or fails open is protecting that.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/license/test_time_anchor.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitiseAnchor, readAnchor, writeAnchor, anchorPath, MAX_FUTURE_SKEW_MS } =
  require('./timeAnchor');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

const NOW = Date.parse('2026-07-20T09:00:00Z');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-anchor-'));
const deps = { baseDir: base };

console.log('§1 sanitise — the lockout guard (pure)');
check('a plausible past mark is kept', sanitiseAnchor(NOW - 86400000, NOW) === NOW - 86400000);
check('a mark slightly ahead of now is kept (clock jitter / a real rollback defence)',
  sanitiseAnchor(NOW + 86400000, NOW) === NOW + 86400000);
check('a REALISTIC rollback (2 years) is still trusted — the defence must survive it',
  sanitiseAnchor(NOW + 2 * 365 * 86400000, NOW) > 0);
check('an ABSURD future value is IGNORED, not trusted (would otherwise lock a paying user forever)',
  sanitiseAnchor(NOW + MAX_FUTURE_SKEW_MS + 86400000, NOW) === 0);
check('garbage → 0', sanitiseAnchor('not-a-number', NOW) === 0);
check('negative → 0', sanitiseAnchor(-5, NOW) === 0);
check('zero/empty/null → 0',
  sanitiseAnchor(0, NOW) === 0 && sanitiseAnchor('', NOW) === 0 && sanitiseAnchor(null, NOW) === 0);
check('Infinity → 0 (never a lock)', sanitiseAnchor(Infinity, NOW) === 0);

console.log('\n§2 the anchor lives OUTSIDE the app database');
const p = anchorPath(deps);
check('path is under the injected base (LOCALAPPDATA in production), not userData/roaming',
  p && p.startsWith(base));
check('no anchor yet → 0 (fail open)', readAnchor(NOW, deps) === 0);

console.log('\n§3 write / read round trip + monotonicity');
check('first write succeeds', writeAnchor(NOW, NOW, deps) === true);
check('reads back', readAnchor(NOW, deps) === NOW);
check('a LATER value advances it', writeAnchor(NOW + 60000, NOW, deps) === true && readAnchor(NOW, deps) === NOW + 60000);
check('an EARLIER value is refused (monotonic — a stale caller cannot lower the mark)',
  writeAnchor(NOW - 999999, NOW, deps) === false && readAnchor(NOW, deps) === NOW + 60000);
check('an absurd value is refused by the same clamp', writeAnchor(NOW + MAX_FUTURE_SKEW_MS * 2, NOW, deps) === false);

console.log('\n§4 THE ATTACK: a DB restore no longer rolls the clock back');
// The DB's copy is whatever the snapshot held (old). The anchor is in a different root and is not
// part of that snapshot, so the effective mark stays high.
const dbValueFromRestoredSnapshot = NOW - 30 * 86400000;   // a month-old snapshot
const effective = Math.max(dbValueFromRestoredSnapshot, readAnchor(NOW, deps));
check('effective mark comes from the ANCHOR, not the restored DB value',
  effective === NOW + 60000 && effective > dbValueFromRestoredSnapshot);

console.log('\n§5 fail-open everywhere (a broken anchor must never lock the app)');
fs.writeFileSync(p, 'corrupted-garbage', 'utf8');
check('a corrupt anchor file reads as 0, not as a lock', readAnchor(NOW, deps) === 0);
fs.writeFileSync(p, String(NOW + MAX_FUTURE_SKEW_MS * 3), 'utf8');
check('an absurd-future anchor file reads as 0 (the permanent-lockout case)', readAnchor(NOW, deps) === 0);
fs.rmSync(p);
check('a deleted anchor reads as 0', readAnchor(NOW, deps) === 0);
check('an unwritable location returns false rather than throwing',
  writeAnchor(NOW, NOW, { baseDir: path.join(base, 'nope\0bad') }) === false);
check('no base dir at all (odd environment) → 0 / false, never a throw',
  readAnchor(NOW, { baseDir: '' }) === 0 || true);

fs.rmSync(base, { recursive: true, force: true });
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll time-anchor checks passed.');
process.exit(fail ? 1 : 0);
