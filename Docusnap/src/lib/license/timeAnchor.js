'use strict';
/**
 * lib/license/timeAnchor.js — SEC-05: keep the monotonic time high-water mark OUTSIDE the
 * restorable app database.
 *
 * THE HOLE: the rollback defence (`effectiveNow = max(now, highWaterMark)`, token.js) reads its
 * high-water mark from `settings` inside %APPDATA%\ScanFinder\docusnap.db — the same user-writable
 * file a user can copy. Snapshot the DB while a trial is valid, let it expire, go offline, wind the
 * clock back, restore the snapshot: the HWM returns to its old low value and the trial runs again,
 * indefinitely.
 *
 * THE ANCHOR: mirror the mark to a file under LOCALAPPDATA — a DIFFERENT root from the roaming
 * database, so restoring a DB backup (or the whole roaming folder) does not roll it back. The gate
 * then takes max(db, anchor). This closes the snapshot-restore vector specifically; it does not
 * pretend to stop a determined local attacker who edits both (client-side offline licensing can't —
 * see SEC-09/SEC-10, accepted). The bar it raises is "copy a file back" → "find and edit two
 * locations in different roots".
 *
 * ⚠ THE DANGEROUS DIRECTION IS THE OTHER ONE. `eff >= entitlementEnd` LOCKS, so a corrupt anchor
 * holding an absurd future timestamp would lock a PAYING user out permanently, offline, with no
 * recourse. Every read is therefore clamped (see sanitiseAnchor) and every failure fails OPEN
 * (returns 0 = "no opinion", never a large number). A missing, unreadable, garbage or
 * absurdly-future anchor must always degrade to today's behaviour, never to a lockout.
 */
const path = require('path');

// A rollback further than this is not a scenario we defend — beyond it a value is far more likely
// to be corruption (or a filesystem clock artefact) than a real observation, and treating it as
// real would lock the user out. 5 years comfortably covers any realistic clock-rollback attack on a
// 14-day trial / annual seat while keeping a garbage value non-fatal.
const MAX_FUTURE_SKEW_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const ANCHOR_DIRNAME = 'ScanFinder';
const ANCHOR_FILENAME = '.time-anchor';

/**
 * PURE. Turn a raw anchor reading into a usable high-water mark.
 * Returns 0 ("no opinion") for anything missing, malformed, negative, or so far in the future that
 * trusting it would lock a legitimate user out. `now` is the caller's current wall clock.
 */
function sanitiseAnchor(raw, now) {
  const n = Number(raw);
  const t = Number(now) || 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > t + MAX_FUTURE_SKEW_MS) return 0;   // corrupt/absurd → ignore, NEVER lock on it
  return Math.floor(n);
}

/** The anchor path: LOCALAPPDATA (or an injected base) — deliberately NOT the roaming userData dir. */
function anchorPath(deps = {}) {
  const base = deps.baseDir
    || process.env.LOCALAPPDATA
    || process.env.XDG_STATE_HOME
    || process.env.HOME
    || '';
  if (!base) return null;
  return path.join(base, ANCHOR_DIRNAME, ANCHOR_FILENAME);
}

/** Best-effort read. Never throws; 0 when absent/unreadable/implausible. */
function readAnchor(now, deps = {}) {
  const fs = deps.fs || require('fs');
  try {
    const p = anchorPath(deps);
    if (!p || !fs.existsSync(p)) return 0;
    return sanitiseAnchor(String(fs.readFileSync(p, 'utf8')).trim(), now);
  } catch { return 0; }
}

/**
 * Best-effort write — mirrors the mark outside the DB. Never throws (a read-only or
 * roaming-profile-restricted machine must still run the app), and never REGRESSES the stored value:
 * we only ever write a larger number, so a stale caller can't lower the mark.
 */
function writeAnchor(value, now, deps = {}, opts = {}) {
  const fs = deps.fs || require('fs');
  try {
    const v = sanitiseAnchor(value, now);
    if (!v) return false;
    const p = anchorPath(deps);
    if (!p) return false;
    // Monotonic by default: a stale caller can never lower the mark. `force` is the ONE
    // sanctioned way down (Oracle C2) — a successful ONLINE refresh resetting to the backend's
    // own server-stamped issued_at. Without it there is no recourse at all for a machine whose
    // mark went wrongly high: this file survives deleting the database, so the old rescue fails.
    if (!opts.force && readAnchor(now, deps) >= v) return false;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(v), 'utf8');
    return true;
  } catch { return false; }
}

/** Remove the anchor entirely (support/uninstall recovery). Best-effort; never throws. */
function clearAnchor(deps = {}) {
  const fs = deps.fs || require('fs');
  try {
    const p = anchorPath(deps);
    if (p && fs.existsSync(p)) { fs.rmSync(p); return true; }
    return false;
  } catch { return false; }
}

module.exports = { sanitiseAnchor, anchorPath, readAnchor, writeAnchor, clearAnchor, MAX_FUTURE_SKEW_MS };
