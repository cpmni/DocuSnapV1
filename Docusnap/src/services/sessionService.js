'use strict';

/**
 * services/sessionService.js
 * --------------------------
 * The detached client's SESSION layer — a parallel auth boundary that is
 * deliberately SEPARATE from the in-process Electron `currentSession` (which the
 * internal windows use). A detached client authenticates (Stage 3: local password
 * + TOTP) and receives an opaque bearer token; the API maps that token back to a
 * { userId, username, role } on every request, then calls the SAME shared services
 * the IPC handlers use. The existing in-process `requireRole` checks are untouched.
 *
 * Opaque random tokens (not JWTs) kept in an in-memory store, so:
 *  - revocation is immediate (delete the record) — important for "release a seat"
 *    / logout / admin lockout,
 *  - there are no signing keys to manage for this transport,
 *  - tokens carry no data, so nothing leaks if one is observed beyond access until
 *    it expires or is revoked.
 *
 * Two independent expiries: an ABSOLUTE lifetime cap and an IDLE timeout. Both the
 * clock and the token generator are injectable for deterministic tests.
 */

const crypto = require('crypto');

const DEFAULT_ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12h hard cap
const DEFAULT_IDLE_MS     = 30 * 60 * 1000;      // 30m since last use

function createSessionStore(opts = {}) {
  const now = opts.now || (() => Date.now());
  const genToken = opts.genToken || (() => crypto.randomBytes(32).toString('base64url'));
  const absoluteMs = opts.absoluteMs != null ? opts.absoluteMs : DEFAULT_ABSOLUTE_MS;
  const idleMs     = opts.idleMs     != null ? opts.idleMs     : DEFAULT_IDLE_MS;

  const sessions = new Map(); // token -> record

  function _expired(rec, t) {
    return t >= rec.absoluteExpiry || t >= rec.lastSeen + idleMs;
  }

  /** Issue a new session for an authenticated user. Returns { token, expiresAt }. */
  function issue({ userId, username, role }) {
    const t = now();
    const token = genToken();
    const rec = {
      token, userId, username, role,
      issuedAt: t, lastSeen: t,
      absoluteExpiry: t + absoluteMs,
    };
    sessions.set(token, rec);
    return { token, expiresAt: rec.absoluteExpiry };
  }

  /**
   * Resolve a bearer token to its session, sliding the idle window. Returns the
   * public session shape { userId, username, role } or null if missing/expired
   * (an expired token is evicted on access).
   */
  function verify(token) {
    if (!token) return null;
    const rec = sessions.get(token);
    if (!rec) return null;
    const t = now();
    if (_expired(rec, t)) { sessions.delete(token); return null; }
    rec.lastSeen = t;
    return { userId: rec.userId, username: rec.username, role: rec.role };
  }

  /** Revoke a single token (logout). */
  function revoke(token) { return sessions.delete(token); }

  /** Revoke every session for a user (admin disable / role change / password reset). */
  function revokeUser(userId) {
    let n = 0;
    for (const [tok, rec] of sessions) if (rec.userId === userId) { sessions.delete(tok); n++; }
    return n;
  }

  /** Drop all expired sessions (optional periodic housekeeping). */
  function sweep() {
    const t = now();
    for (const [tok, rec] of sessions) if (_expired(rec, t)) sessions.delete(tok);
  }

  function size() { return sessions.size; }

  return { issue, verify, revoke, revokeUser, sweep, size };
}

module.exports = { createSessionStore, DEFAULT_ABSOLUTE_MS, DEFAULT_IDLE_MS };
