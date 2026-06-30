'use strict';

/**
 * services/presenceService.js
 * ---------------------------
 * In-memory "who's viewing this document" presence for multi-user review — the data behind the
 * *"Currently being reviewed by <name>"* banner.
 *
 * ADVISORY ONLY. The atomic confirm (reviewService.confirm → documents.confirmIfReviewable) is the
 * authority, so stale or missing presence can NEVER cause a wrong outcome — the worst case is a
 * redundant banner or a clean 409 ALREADY_FILED. That's why this is a plain in-process Map, not a
 * DB table: it's ephemeral (a core restart correctly clears it — nobody is "viewing" after a
 * restart), needs no migration / write-churn, and self-expires via a TTL so a crashed or
 * disconnected viewer (whose client never sent a release) is reaped automatically.
 *
 * Shared SINGLETON (`shared()`) so the desktop review handler and the /v1 client API publish to
 * and read from the SAME map in the core main process — a desktop reviewer is visible to clients
 * and vice-versa. `createPresenceService()` makes an isolated instance for tests.
 *
 * A viewerKey uniquely identifies a viewing SESSION (a detached client's clientKey, or a desktop
 * sentinel), so the same user open on two machines counts as two viewers and excludes-self works.
 */

const DEFAULT_TTL_MS = 60000;   // a viewer not heard from for 60s is considered gone (2 missed ~25s beats)

function createPresenceService({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  // docId -> Map<viewerKey, { username, displayName, lastSeen }>
  const docs = new Map();

  function heartbeat(docId, viewer) {
    if (docId == null || !viewer || !viewer.key) return;
    let m = docs.get(docId);
    if (!m) { m = new Map(); docs.set(docId, m); }
    m.set(viewer.key, {
      username:    viewer.username || null,
      displayName: viewer.displayName || viewer.username || null,
      lastSeen:    now(),
    });
  }

  function release(docId, viewerKey) {
    const m = docs.get(docId);
    if (!m) return;
    m.delete(viewerKey);
    if (m.size === 0) docs.delete(docId);
  }

  // Drop a viewer from EVERY document (logout / disconnect / window close without a doc context).
  function releaseAll(viewerKey) {
    for (const [docId, m] of docs) {
      if (m.delete(viewerKey) && m.size === 0) docs.delete(docId);
    }
  }

  function _sweep(m) {
    const cutoff = now() - ttlMs;
    for (const [k, v] of m) if (v.lastSeen < cutoff) m.delete(k);
  }

  // Current viewers of a doc (stale entries swept first), excluding the caller's own key so a
  // client never sees itself. Returns [{ username, displayName }].
  function viewers(docId, excludeKey = null) {
    const m = docs.get(docId);
    if (!m) return [];
    _sweep(m);
    if (m.size === 0) { docs.delete(docId); return []; }
    const out = [];
    for (const [k, v] of m) if (k !== excludeKey) out.push({ username: v.username, displayName: v.displayName });
    return out;
  }

  // Test/diagnostic aid: total tracked viewers across all docs (after a sweep).
  function _size() {
    let n = 0;
    for (const m of docs.values()) { _sweep(m); n += m.size; }
    return n;
  }

  return { heartbeat, release, releaseAll, viewers, _size };
}

let _shared = null;
function shared() { return _shared || (_shared = createPresenceService()); }

module.exports = { createPresenceService, shared, DEFAULT_TTL_MS };
