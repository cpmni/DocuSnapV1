'use strict';
/*
 * dbCodeConfirm.js — proof-of-possession check for the DB-encryption ceremony.
 *
 * The opt-in "turn on encryption" ceremony (settings/renderer.js showDbCodeCeremony) used to gate on a
 * reflexive typed phrase ("I HAVE SAVED IT") that never verified the user actually holds the recovery
 * code — the ONE key to the encrypted DB (Oracle ship-readiness vet 2026-09-15: the single material
 * data-loss risk for a non-developer test customer). This replaces that gate with a proof of possession:
 * the user types the LAST 5-char block of their code back (the chars after the final dash), OR the whole
 * code. They cannot satisfy it by clicking through without having read/saved the code.
 *
 * `fold` mirrors dbKey.normaliseCode (O->0, I/L->1, U->V, strip spaces/dashes, uppercase) so a
 * hand-written O/0 or I/1 mix still matches. The generated code alphabet (Crockford base32) never
 * contains I/L/O/U, so folding is LOSS-FREE for a real code — it only ever repairs a human misread.
 *
 * Renderer-only: loaded by <script> in settings/index.html, exposed as window.DbCodeConfirm. NOT
 * require()d by the main process (so esbuild/harden-js never bundles or deletes it; it ships unbundled).
 * A CommonJS export is provided ONLY for the pin (test_dbcodeconfirm.js).
 */
(function (root) {
  function fold(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[\s-]+/g, '')
      .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  }
  // The normalised last 5-char block of a code (the group after the final dash).
  function lastGroup(code) {
    const norm = fold(code);
    return norm.length >= 5 ? norm.slice(-5) : '';
  }
  // True when the user's typed `input` proves possession of `code`: it equals the last 5-char block,
  // or the whole normalised code. A malformed/short code never auto-passes (want < 5 => false).
  function matches(input, code) {
    const want = lastGroup(code);
    if (want.length < 5) return false;
    const got = fold(input);
    if (got.length < 5) return false;
    return got === want || got === fold(code);
  }
  const api = { fold, lastGroup, matches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DbCodeConfirm = api;
})(typeof window !== 'undefined' ? window : null);
