'use strict';
/**
 * src/modules/auth/stampPermission.js
 * -----------------------------------
 * The tamper-resistant STAMP permission gate (Workflow+Stamping redesign 2026-08-28;
 * docs/designs/WORKFLOW_STAMPING_REDESIGN_2026-08-28.md §4.1 + §9 gate 1).
 *
 * The permission is a stream of SIGNED grant/revoke events on the tamper-evident audit
 * hash chain (database/modules/auth.js) — there is no flippable `can_stamp` column. This
 * module is the POLICY that decides `canStamp`, and it is FAIL-CLOSED (Oracle: a permission
 * gate must fail closed, unlike the audit key which is defence-in-depth and fails open):
 *
 *   canStamp(db, userId) is TRUE only when ALL hold:
 *     1. real OS encryption is available (secretStore.available() — NOT merely "a key exists";
 *        under ELECTRON_RUN_AS_NODE the key is present-but-plaintext/forgeable, so we refuse);
 *     2. the audit chain verifies at CHECK TIME (a hand-INSERTed grant has no valid row_hmac →
 *        verifyAuditChain fails → refuse + record `tamper_detected`; the append-only triggers
 *        block UPDATE/DELETE but NOT INSERT, and nothing verifies the chain automatically today);
 *     3. the latest signed grant for the user says 'granted'.
 *
 * RESIDUAL the owner accepted: this couples ALL stamping to global audit-chain health — a benign
 * key-loss or a DB restored to a new machine (`no_key`) disables stamping until repaired.
 *
 * Enforcement is MAIN-PROCESS ONLY. The renderer/detached client never decides this — the desktop
 * IPC and the /v1 handler both call requireStampPermission before any stamp/approve/reject.
 */

const secretStore = require('../../lib/secretStore');
const authDb = require('../../../database/modules/auth');

// The single decision. Pure over (db, userId) + the injected secretStore, so it is unit-testable
// (inject a fake safeStorage via secretStore.__setSafeStorage and an audit key via auth.setAuditKey).
function canStamp(db, userId) {
  if (db == null || userId == null) return false;
  // (1) real DPAPI — a plaintext/forgeable key on a DPAPI-less host fails closed.
  if (!secretStore.available()) return false;
  // (2) the tamper-evident chain must verify NOW (an INSERTed grant breaks it).
  let v;
  try { v = authDb.verifyAuditChain(db); } catch { v = { ok: false, reason: 'read_error' }; }
  if (!v || !v.ok) {
    try {
      authDb.addAuditEntry(db, {
        action: 'tamper_detected', action_category: 'security', outcome: 'blocked',
        details: `stamp gate refused: audit chain ${(v && v.reason) || 'unverifiable'}`,
      });
    } catch { /* recording is best-effort — the refusal stands regardless */ }
    return false;
  }
  // (3) the latest signed grant says 'granted'.
  return authDb.latestStampGrantState(db, userId) === 'granted';
}

// IPC/API shape: { ok:true } or a refusal carrying a stable code + message.
function requireStampPermission(db, userId) {
  if (canStamp(db, userId)) return { ok: true };
  return { ok: false, code: 'STAMP_FORBIDDEN', error: 'You do not have permission to stamp documents.' };
}

// Admin-only grant / revoke. Writes a SIGNED audit event (the record IS the permission). The audit
// row is HMAC-chained by addAuditEntry when the key is set — enforced by the SAME check-time verifier
// on the next canStamp, so a forged grant can never take effect.
function grantStamp(db, actor, targetUserId) { return _setGrant(db, actor, targetUserId, true); }
function revokeStamp(db, actor, targetUserId) { return _setGrant(db, actor, targetUserId, false); }

function _setGrant(db, actor, targetUserId, grant) {
  if (!actor || actor.role !== 'admin') {
    return { ok: false, code: 'FORBIDDEN', error: 'Only an administrator can change stamping permission.' };
  }
  const target = authDb.getUserById(db, targetUserId);
  if (!target) return { ok: false, code: 'NOT_FOUND', error: 'User not found.' };
  authDb.addStampGrantEvent(db, {
    actorUserId: actor.userId, actorUsername: actor.username, actorRole: actor.role,
    targetUserId: target.id, targetUsername: target.username, grant,
  });
  return { ok: true, state: grant ? 'granted' : 'revoked' };
}

module.exports = { canStamp, requireStampPermission, grantStamp, revokeStamp };
