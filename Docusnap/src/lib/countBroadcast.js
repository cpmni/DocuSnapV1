'use strict';
/**
 * src/lib/countBroadcast.js — D2 / D-C11: broadcast the review / deferred / stuck counts SCOPED to the
 * desktop operator, so a desktop badge never shows a GLOBAL count that would leak the existence of
 * department-restricted docs. ONE place, so a future count broadcaster can't silently reintroduce a
 * global count (the plan's D-C11 "collapse the global broadcasters into one per-viewer notify").
 *
 * The viewer is ALWAYS the current DESKTOP operator (auth getCurrentUser()) — resolved here so the ~14
 * call sites need no per-site plumbing (getCurrentUser is not in scope at every one). Even the /v1
 * confirm callback uses the desktop operator: it pushes to the CORE desktop badge (notifyMainWindow /
 * notifyAllWindows), NOT to the /v1 client (the client polls its own scoped /v1/review/counts). When no
 * departments are configured / the operator is admin / all_departments, the count is byte-identical to
 * the old global one on every current install.
 *
 * A pin passes an explicit `viewer` (any value, incl. null) to override; callers omit it to get the
 * live operator. Best-effort: a count read must never throw out of a broadcast.
 */
const documents = require('../../database/modules/documents');

function _operator() {
  try { return require('../modules/auth/handler').getCurrentUser(); } catch { return undefined; }
}
function _viewer(viewer) { return viewer !== undefined ? viewer : _operator(); }

function broadcastCounts(notify, db, viewer) {
  if (typeof notify !== 'function' || !db) return;
  const v = _viewer(viewer);
  try {
    notify('review-count-changed',   documents.getReviewCount(db, v));
    notify('deferred-count-changed', documents.getDeferredCount(db, v));
  } catch { /* best-effort — a badge refresh must never break a mutation */ }
}

function broadcastReviewCount(notify, db, viewer) {
  if (typeof notify !== 'function' || !db) return;
  try { notify('review-count-changed', documents.getReviewCount(db, _viewer(viewer))); } catch { /* best-effort */ }
}

function broadcastStuckCount(notify, db, viewer) {
  if (typeof notify !== 'function' || !db) return;
  try { notify('stuck-count-changed', documents.getStuckCount(db, _viewer(viewer))); } catch { /* best-effort */ }
}

module.exports = { broadcastCounts, broadcastReviewCount, broadcastStuckCount };
