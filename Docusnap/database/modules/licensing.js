'use strict';

/**
 * database/modules/licensing.js — local licensing state (client SQLite).
 *
 * Local-mirror + read-only token cache over the migration-16 tables. These are
 * CONVENIENCE/observability state only — the backend remains the source of
 * truth. Deleting these rows can never mint or reset a trial; the next online
 * call simply repopulates them. The monotonic time high-water mark used for
 * rollback defense lives in `settings` (outside this deletable cache).
 *
 * license_tokens.token_blob holds the latest signed compact JWS; parsed
 * convenience columns (state, not_after, grace_until, kid) sit alongside it.
 */

function recordDevice(db, fpHash) {
  db.prepare('INSERT OR IGNORE INTO device_registrations (fp_hash) VALUES (?)').run(fpHash);
}

function cacheToken(db, { kind, subject, jws, state, notAfter = null, graceUntil = null, kid = null }) {
  db.prepare(`
    INSERT INTO license_tokens
      (kind, subject, token_blob, state, not_after, grace_until, kid, last_validated_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(kind, subject) DO UPDATE SET
      token_blob        = excluded.token_blob,
      state             = excluded.state,
      not_after         = excluded.not_after,
      grace_until       = excluded.grace_until,
      kid               = excluded.kid,
      last_validated_at = datetime('now'),
      updated_at        = datetime('now')
  `).run(kind, subject, jws, state, notAfter, graceUntil, kid);
}

// Trial token is keyed by subject 'trial:<fp_hash>'.
function getCachedToken(db, fpHash) {
  return db.prepare('SELECT * FROM license_tokens WHERE subject = ?').get('trial:' + fpHash);
}

function decodeClaims(jws) {
  try {
    const p = String(jws).split('.');
    if (p.length !== 3) return null;
    return JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8'));
  } catch { return null; }
}

// The token the gate should use for THIS device: a paid SEAT token bound to the
// fingerprint takes precedence over the trial token (paid > trial). Seat tokens
// carry the fp in an fp_hash claim (subject is 'seat:<seat_id>').
function getActiveToken(db, fpHash) {
  const seats = db.prepare("SELECT * FROM license_tokens WHERE kind = 'seat' ORDER BY last_validated_at DESC").all();
  for (const row of seats) {
    const c = decodeClaims(row.token_blob);
    if (c && c.fp_hash === fpHash) return row;
  }
  return getCachedToken(db, fpHash);
}

// Drop any cached seat token bound to this fingerprint (e.g. after a revoke), so
// the gate stops honoring it on this device.
function clearSeatToken(db, fpHash) {
  const rows = db.prepare("SELECT id, token_blob FROM license_tokens WHERE kind = 'seat'").all();
  for (const row of rows) {
    const c = decodeClaims(row.token_blob);
    if (c && c.fp_hash === fpHash) db.prepare('DELETE FROM license_tokens WHERE id = ?').run(row.id);
  }
}

// Drop the cached TRIAL token for this fingerprint (subject 'trial:<fp>'). Used when the
// backend reports no grant of any kind, so a trial deleted/expired server-side can't keep
// being honored from the local cache (the client DB persists across reinstalls).
function clearCachedToken(db, fpHash) {
  db.prepare('DELETE FROM license_tokens WHERE subject = ?').run('trial:' + fpHash);
}

module.exports = { recordDevice, cacheToken, getCachedToken, getActiveToken, clearSeatToken, clearCachedToken };
