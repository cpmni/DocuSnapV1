'use strict';

/**
 * services/seatPool.js — concurrent (floating) but STICKY client-seat pool for the
 * detached search clients, PERSISTED in SQLite (table `client_seats`, migration 30).
 *
 * Product model: a seat is claimed by a stable CLIENT (client_key) on its first /v1
 * login and STAYS claimed until an ADMIN releases it — there is deliberately NO
 * idle/auto expiry (the manual-release friction is the licensing model). A
 * reconnecting client reuses its existing seat, so distinct machines = distinct seats
 * and a client never silently loses its seat. The licensed seat COUNT caps how many
 * clients hold a seat at once; the (cap+1)-th client is refused until an admin frees
 * one. Persistence means seat assignments survive a core-app restart.
 *
 * Trust: IP is recorded from the CONNECTION (authoritative, not spoofable); hostname
 * is CLIENT-REPORTED (display only) and never used for enforcement. All seat state +
 * the cap live in main — a renderer/client can neither fabricate a seat nor bypass
 * the cap; only claim() (gated by the cap) writes a row.
 *
 * Interface is unchanged from the earlier in-memory version, so callers (the /v1 API
 * and the admin IPC) are untouched. `getDb` is injected (lazy) so the table exists by
 * the time it is used; `now`/`genId` are injectable for deterministic tests.
 */

const crypto = require('crypto');

function createSeatPool(opts = {}) {
  const now   = opts.now   || (() => Date.now());
  const genId = opts.genId || (() => crypto.randomBytes(9).toString('base64url'));
  const _db   = () => (typeof opts.getDb === 'function' ? opts.getDb() : opts.db);

  const _pub = (r) => (r ? {
    id: r.id, clientKey: r.client_key, username: r.username, role: r.role,
    hostname: r.hostname, ip: r.ip, firstSeen: r.first_seen, lastSeen: r.last_seen,
    workflowEnabled: !!r.workflow_enabled,
  } : null);

  /**
   * Claim a NEW seat for a client, or reuse its existing one. `cap` is the licensed
   * seat count (0 = none). Never auto-expires.
   * @returns {{ok:true, seat, reused:boolean}} | {{ok:false, code:'SEAT_LIMIT', inUse, cap}}
   */
  function claim({ clientKey, username = null, role = null, hostname = null, ip = null }, cap) {
    const db = _db();
    const limit = Math.max(0, cap | 0);
    const t = now();

    const existing = clientKey != null
      ? db.prepare('SELECT * FROM client_seats WHERE client_key = ?').get(clientKey) : null;
    if (existing) {                                   // reconnect → reuse the same seat
      db.prepare(`UPDATE client_seats SET last_seen = ?,
                    ip = COALESCE(?, ip), hostname = COALESCE(?, hostname),
                    username = COALESCE(?, username), role = COALESCE(?, role)
                  WHERE id = ?`)
        .run(t, ip || null, hostname || null, username || null, role || null, existing.id);
      return { ok: true, seat: _pub(db.prepare('SELECT * FROM client_seats WHERE id = ?').get(existing.id)), reused: true };
    }

    const inUse = db.prepare('SELECT COUNT(*) AS c FROM client_seats').get().c;
    if (inUse >= limit) return { ok: false, code: 'SEAT_LIMIT', inUse, cap: limit };

    const id = genId();
    db.prepare(`INSERT INTO client_seats (id, client_key, username, role, hostname, ip, first_seen, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, clientKey, username, role, hostname, ip, t, t);
    return { ok: true, seat: _pub(db.prepare('SELECT * FROM client_seats WHERE id = ?').get(id)), reused: false };
  }

  /**
   * Claim/confirm the WORKFLOW add-on for a client that ALREADY holds a (search) seat —
   * workflow is an upgrade ON a held search seat, capped independently by `cap`. Idempotent
   * for a client that already has it. @returns {{ok:true,seat,reused}} | {{ok:false,code,...}}
   */
  function claimWorkflow(clientKey, cap) {
    const db = _db();
    if (clientKey == null) return { ok: false, code: 'NO_SEAT' };
    const seat = db.prepare('SELECT * FROM client_seats WHERE client_key = ?').get(clientKey);
    if (!seat) return { ok: false, code: 'NO_SEAT' };                  // must hold a search seat first
    if (seat.workflow_enabled) return { ok: true, seat: _pub(seat), reused: true };
    const limit = Math.max(0, cap | 0);
    const inUse = db.prepare('SELECT COUNT(*) AS c FROM client_seats WHERE workflow_enabled = 1').get().c;
    if (inUse >= limit) return { ok: false, code: 'WORKFLOW_LIMIT', inUse, cap: limit };
    db.prepare('UPDATE client_seats SET workflow_enabled = 1 WHERE id = ?').run(seat.id);
    return { ok: true, seat: _pub(db.prepare('SELECT * FROM client_seats WHERE id = ?').get(seat.id)), reused: false };
  }

  /** Count of seats currently holding the workflow add-on. */
  function workflowInUse() { return _db().prepare('SELECT COUNT(*) AS c FROM client_seats WHERE workflow_enabled = 1').get().c; }

  /** Heartbeat — bump last-seen (and IP) for a client's seat. No-op if it has none. */
  function touch(clientKey, { ip } = {}) {
    if (clientKey == null) return false;
    const r = _db().prepare('UPDATE client_seats SET last_seen = ?, ip = COALESCE(?, ip) WHERE client_key = ?')
      .run(now(), ip || null, clientKey);
    return r.changes > 0;
  }

  /** ADMIN release by seat id — frees the seat for the next client. */
  function release(seatId) {
    return _db().prepare('DELETE FROM client_seats WHERE id = ?').run(seatId).changes > 0;
  }

  function list()  { return _db().prepare('SELECT * FROM client_seats ORDER BY first_seen').all().map(_pub); }
  function count() { return _db().prepare('SELECT COUNT(*) AS c FROM client_seats').get().c; }

  return { claim, claimWorkflow, workflowInUse, touch, release, list, count };
}

module.exports = { createSeatPool };
