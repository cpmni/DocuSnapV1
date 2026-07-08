'use strict';
/*
 * scripts/build-rev.js
 * --------------------
 * A distinct, sortable, traceable build revision for installer filenames, so a
 * rebuild never silently overwrites the previous installer in dist/. Format:
 *   <UTC yyyymmdd-hhmm>-<git short sha>   e.g.  20260622-1133-9f158c5
 * - sortable     → newest build sorts last alphabetically
 * - traceable    → the short SHA ties an installer to the exact commit
 * - overridable  → set BUILD_REV to stamp a custom tag (e.g. a release: BUILD_REV=2.1.0)
 * Used by BOTH the core build (package.json "build") and the client build
 * (client/package.json "dist") so the two stamp consistently.
 */
function buildRev() {
  if (process.env.BUILD_REV) return process.env.BUILD_REV;   // explicit override wins
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  let sha = '';
  try { sha = '-' + require('child_process').execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { /* not a git checkout — timestamp alone still keeps builds distinct */ }
  return ts + sha;
}

module.exports = { buildRev };
