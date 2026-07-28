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
const crypto = require('crypto');
const { sanitiseAnchor, readAnchor, writeAnchor, clearAnchor, anchorPath, MAX_FUTURE_SKEW_MS } =
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
// Oracle C3: this check used to read `... === 0 || true` — a TAUTOLOGY that could never fail —
// and `baseDir: ''` is falsy, so anchorPath fell through to the REAL LOCALAPPDATA and the test
// silently read the production anchor. Scrub the env so "no base dir" genuinely means none.
const _env = { LOCALAPPDATA: process.env.LOCALAPPDATA, XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME };
delete process.env.LOCALAPPDATA; delete process.env.XDG_STATE_HOME; delete process.env.HOME;
check('no base dir ANYWHERE → anchorPath null, read 0, write false, never a throw',
  anchorPath({}) === null && readAnchor(NOW, {}) === 0 && writeAnchor(NOW, NOW, {}) === false);
Object.assign(process.env, Object.fromEntries(Object.entries(_env).filter(([, v]) => v !== undefined)));

console.log('\n§6 the ONE sanctioned way DOWN (Oracle C2 — the only recourse for a wrongly-high mark)');
const b2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-anchor2-'));
const d2 = { baseDir: b2 };
writeAnchor(NOW + 2 * 365 * 86400000, NOW, d2);       // a bogus mark ~2y ahead (inside the clamp)
check('(setup) a mid-band bogus mark IS stored (this is the brick scenario)',
  readAnchor(NOW, d2) > NOW);
check('a normal write cannot lower it (monotonic holds)',
  writeAnchor(NOW, NOW, d2) === false && readAnchor(NOW, d2) > NOW);
check('force: RESETS it down (the online self-heal to the server-stamped issued_at)',
  writeAnchor(NOW, NOW, d2, { force: true }) === true && readAnchor(NOW, d2) === NOW);
check('clearAnchor removes it entirely (support/uninstall recovery)',
  clearAnchor(d2) === true && readAnchor(NOW, d2) === 0);
check('clearAnchor on an absent file is a no-op, not a throw', clearAnchor(d2) === false);
fs.rmSync(b2, { recursive: true, force: true });

console.log('\n§7 Stage 6c — keyed integrity stamp (machine binding + tamper rejection, fail-open)');
const b3 = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-anchor3-'));
const KEY = 'fp-hash-AAAA';
const kd = { baseDir: b3, hmacKey: KEY };
const p3 = anchorPath(kd);
check('keyed write succeeds', writeAnchor(NOW, NOW, kd) === true);
check('  → file is AV1-stamped, not a bare integer', fs.readFileSync(p3, 'utf8').startsWith('AV1:'));
check('  → keyed read verifies + returns the value', readAnchor(NOW, kd) === NOW);
check('a DIFFERENT key (anchor copied from another machine) → 0 (fail open, never a lock)',
  readAnchor(NOW, { baseDir: b3, hmacKey: 'fp-hash-BBBB' }) === 0);
check('editing the stamped value without re-MACing → 0 (tamper rejected)',
  (() => { const c = fs.readFileSync(p3, 'utf8'); fs.writeFileSync(p3, c.replace(/AV1:\d+/, 'AV1:' + (NOW - 99999999)), 'utf8'); return readAnchor(NOW, kd) === 0; })());
fs.writeFileSync(p3, String(NOW + 5000), 'utf8');   // a legacy bare-integer anchor from before 6c
check('a legacy bare anchor is still honoured WITH a key (backward compat)', readAnchor(NOW, kd) === NOW + 5000);
check('  → and the next keyed write upgrades it to AV1',
  writeAnchor(NOW + 6000, NOW, kd) === true && fs.readFileSync(p3, 'utf8').startsWith('AV1:'));
check('an AV1 file read with NO key still yields its value (graceful downgrade, no data loss)',
  readAnchor(NOW, { baseDir: b3 }) === NOW + 6000);
check('monotonicity still holds under keying',
  writeAnchor(NOW, NOW, kd) === false && readAnchor(NOW, kd) === NOW + 6000);
check('OFF (no key) writes the legacy bare format (byte-identical kill switch)',
  (() => { const b4 = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-anchor4-')); const ok = writeAnchor(NOW, NOW, { baseDir: b4 }) === true; const bare = fs.readFileSync(anchorPath({ baseDir: b4 }), 'utf8'); fs.rmSync(b4, { recursive: true, force: true }); return ok && bare === String(NOW); })());
// Oracle 6c condition 2: a VALID-MAC absurd-future anchor must STILL clamp to 0. writeAnchor's sanitise
// refuses to create this, so hand-craft it — it pins that the lockout clamp runs AFTER a keyed decode,
// so a future refactor moving the clamp can't silently reintroduce a keyed permanent-lockout.
check('a VALID-MAC absurd-future keyed anchor STILL reads 0 (no keyed lockout — clamp runs post-decode)',
  (() => {
    const absurd = NOW + MAX_FUTURE_SKEW_MS * 3;
    const mac = crypto.createHmac('sha256', Buffer.from(KEY, 'utf8')).update(String(absurd), 'utf8').digest('hex');
    fs.writeFileSync(p3, `AV1:${absurd}:${mac}`, 'utf8');
    return readAnchor(NOW, kd) === 0;
  })());
fs.rmSync(b3, { recursive: true, force: true });

fs.rmSync(base, { recursive: true, force: true });
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll time-anchor checks passed.');
process.exit(fail ? 1 : 0);
