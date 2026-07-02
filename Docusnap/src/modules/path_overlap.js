'use strict';

/**
 * modules/path_overlap.js
 * -----------------------
 * Folder-overlap checks. A watch or manual-import folder that equals — or sits
 * inside, or is a parent of — the OUTPUT tree (or the drain "Processed" folder)
 * causes filed copies to be re-detected and re-imported: with a FLAT output
 * pattern they land as top-level files in the watched folder and grow unbounded
 * `-DUPLICATE` copies (2026-07-02 QA audit #8). These helpers let the IPC edges
 * refuse/warn on such a configuration.
 */

const path = require('path');

function _norm(p) {
  const r = path.resolve(String(p || ''));
  return process.platform === 'win32' ? r.toLowerCase() : r;   // Windows paths are case-insensitive
}

// True when `child` is the SAME folder as, or nested inside, `parent`.
function isWithin(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(_norm(parent), _norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// True when two folders overlap: equal, or one contains the other.
function foldersOverlap(a, b) {
  if (!a || !b) return false;
  return isWithin(a, b) || isWithin(b, a);
}

module.exports = { isWithin, foldersOverlap };
