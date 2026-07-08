'use strict';

/**
 * src/lib/update/version.js
 * -------------------------
 * Pure, dependency-free SemVer comparison for the advisory update banner. Deliberately
 * GARBAGE-SAFE: it is fed an admin-typed, UNSIGNED `latest_version` from the licensing
 * backend, so it must NEVER throw and must treat anything non-parseable as "no update"
 * (the banner then simply never shows) rather than mis-firing.
 *
 * Compare is 3-part numeric only, on the clean X.Y.Z the app actually reports
 * (`app.getVersion()` = package.json version; the build injects only `buildRev` via
 * extraMetadata, never `version`, so this is X.Y.Z in BOTH the NSIS and MSIX/Store builds —
 * confirmed by eric). Pre-release / build-metadata suffixes (`-beta`, `+r123`) are stripped
 * before compare; the git-sha buildRev is NEVER an ordering key.
 *
 * Guarded by src/lib/update/test_version.js.
 */

/** Parse a version string to a [major, minor, patch] int tuple, or null if not clean SemVer-ish. */
function _parse(v) {
  if (v == null) return null;
  // Strip a leading 'v' and any -prerelease / +build suffix; keep only the numeric core.
  const core = String(v).trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = core.split('.');
  if (parts.length === 0 || parts.length > 4) return null;      // 4 tolerated (MSIX a.b.c.d), >4 rejected
  const nums = [];
  for (let i = 0; i < 3; i++) {                                 // compare on the first three only
    const p = parts[i];
    if (p === undefined) { nums.push(0); continue; }            // pad missing (2.0 → 2.0.0)
    if (!/^\d+$/.test(p)) return null;                          // any non-numeric segment → not a version
    nums.push(parseInt(p, 10));
  }
  return nums;
}

/**
 * Compare two versions. Returns 1 if a > b, -1 if a < b, 0 if equal OR either is unparseable.
 * Unparseable → 0 is deliberate: callers use `> 0` to mean "update available", so garbage can
 * never assert an update.
 */
function compareVersions(a, b) {
  const pa = _parse(a);
  const pb = _parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/** True only when `latest` is a clean version STRICTLY newer than `current`. Never throws. */
function isNewer(latest, current) {
  return _parse(latest) != null && compareVersions(latest, current) > 0;
}

/**
 * True iff `current` is a clean version STRICTLY BELOW a clean `minSupported` floor — the
 * forced-update predicate. FAIL-SAFE: a blank/absent/garbage floor (or version) → false, so a
 * missing or malformed `min_supported_version` can never force a lock. Never throws.
 */
function belowFloor(current, minSupported) {
  if (minSupported == null || String(minSupported).trim() === '') return false;
  return _parse(current) != null && _parse(minSupported) != null && compareVersions(current, minSupported) < 0;
}

module.exports = { compareVersions, isNewer, belowFloor, _parse };
