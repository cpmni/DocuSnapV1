'use strict';
/*
 * src/lib/pathContainment.js — the ONE real-path canonicalisation + root-containment predicate, lifted
 * out of processing/handler.js so every door that must reason about "is this path safe / inside a root"
 * shares ONE implementation (Oracle Q-C10, 2026-09-13): the reparse-point/junction containment used by
 * open-file (SEC-17) AND the Quick File intake validator. processing/handler.js re-exports these so its
 * existing pins (test_path_containment.js) keep asserting the SHIPPED predicate — no dead copy.
 *
 * Pure-ish: requires only fs/path. isPackaged (for the dev-only bypass below) is read LAZILY from
 * electron.app with a fail-SAFE default of `true` (bypass OFF) when electron isn't a live app — i.e. in
 * an ELECTRON_RUN_AS_NODE pin or plain node the containment can never be switched off.
 */
const fs = require('fs');
const path = require('path');

function _isPackaged() {
  // A containment boundary must NOT be env-switchable on a customer machine, so the dev bypass is gated
  // on !isPackaged. Absent a live electron app (a pin / plain node), default to packaged = bypass OFF.
  try { return !!require('electron').app.isPackaged; } catch { return true; }
}

function realCanonical(p) {
  // DEV-ONLY: same rule as licence-key pinning — a containment boundary must not be switchable off by an
  // env var on a customer's machine. Unpackaged, the switch still works, which lets the pin prove the
  // guard can actually fail.
  if (!_isPackaged() && process.env.SF_REALPATH_CONTAINMENT === '0') return p;
  try {
    return fs.realpathSync.native(p);
  } catch (e) {
    // Anything other than "it isn't there" (EPERM/EBUSY/ELOOP/…) is a path we cannot vouch for.
    if (!e || e.code !== 'ENOENT') return null;
  }
  const tail = [path.basename(p)];
  let dir = path.dirname(p);
  while (dir && dir !== path.dirname(dir)) {
    try {
      return path.join(fs.realpathSync.native(dir), ...tail.slice().reverse());
    } catch (e2) {
      if (!e2 || e2.code !== 'ENOENT') return null;   // ancestor exists but is unverifiable → refuse
      tail.push(path.basename(dir));
      dir = path.dirname(dir);
    }
  }
  // No existing ancestor at all (a missing drive, an unmounted share): there is nothing to follow, so
  // the textual form is as canonical as it gets. It cannot match a canonicalised root by accident — a
  // root that does not exist is itself refused above.
  return p;
}

// Containment test against an ALREADY-canonical target (the caller canonicalised once — Q-C10 forbids a
// double-canonicalise + its TOCTOU window). Roots are canonicalised here.
function targetWithinAnyRoot(target, roots) {
  if (target === null || target === undefined) return false;   // unverifiable → refuse
  // Case-insensitive on Windows is PART of this fix: realpathSync.native returns the filesystem's own
  // casing, which routinely differs from what the user typed. Comparing case-sensitively would turn that
  // into a false REFUSAL of the user's own files. It admits nothing new — same directory on Windows.
  const cmp = (a, b) => (process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b);
  const under = (a, b) => (process.platform === 'win32'
    ? a.toLowerCase().startsWith(b.toLowerCase() + path.sep)
    : a.startsWith(b + path.sep));
  return (roots || []).some(r => {
    const root = realCanonical(r);
    if (root === null) return false;
    return cmp(target, root) || under(target, root);
  });
}

// Back-compat wrapper (SEC-17 open-file path): canonicalise the target, then test containment.
function withinAnyRoot(resolved, roots) {
  return targetWithinAnyRoot(realCanonical(resolved), roots);
}

module.exports = { realCanonical, withinAnyRoot, targetWithinAnyRoot };
