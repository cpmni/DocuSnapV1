'use strict';

/**
 * database/modules/auth.js
 * Local authentication storage — users, one-time admin recovery codes,
 * and the audit trail. Pure data-access layer: hashing, sessions, and
 * permission rules live in src/modules/auth/.
 */

const VALID_ROLES = ['admin', 'edit', 'readonly'];

// ── Users ─────────────────────────────────────────────────────────────────────

function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function countActiveAdmins(db, excludeUserId = null) {
  if (excludeUserId == null) {
    return db.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1`
    ).get().n;
  }
  return db.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?`
  ).get(excludeUserId).n;
}

function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
}

function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getAllUsers(db) {
  return db.prepare(`
    SELECT id, username, display_name, role, is_active, must_change_password,
           last_login_at, created_at, updated_at
    FROM users ORDER BY created_at ASC
  `).all();
}

function createUser(db, { username, display_name, password_hash, role, must_change_password = 0 }) {
  if (!VALID_ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const info = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, must_change_password)
    VALUES (@username, @display_name, @password_hash, @role, @must_change_password)
  `).run({ username: String(username).trim(), display_name, password_hash, role, must_change_password: must_change_password ? 1 : 0 });
  return getUserById(db, info.lastInsertRowid);
}

function setUserRole(db, id, role) {
  if (!VALID_ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  db.prepare(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`).run(role, id);
}

function setUserActive(db, id, isActive) {
  db.prepare(`UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isActive ? 1 : 0, id);
}

// Used both for admin-initiated resets (mustChange = true, temp password) and
// for a user changing their own password (mustChange = false, clears the flag).
function setUserPassword(db, id, password_hash, mustChange) {
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(password_hash, mustChange ? 1 : 0, id);
}

function touchLastLogin(db, id) {
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(id);
}

// ── Recovery codes (admin lockout recovery) ──────────────────────────────────
// One active code per user at a time — issuing a new one invalidates any
// earlier unused codes for that user (rotation), so only the most recently
// shown code can ever be redeemed.

function issueRecoveryCode(db, userId, codeHash) {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE recovery_codes SET is_used = 1, used_at = datetime('now')
                WHERE user_id = ? AND is_used = 0`).run(userId);
    return db.prepare(`INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)`)
      .run(userId, codeHash).lastInsertRowid;
  });
  return tx();
}

// Looked up by hash (the code is high-entropy random data, so an exact hash
// match is sufficient — no need to know the username up front).
function findActiveRecoveryCodeByHash(db, codeHash) {
  return db.prepare(`
    SELECT rc.*, u.username, u.display_name, u.role, u.is_active
    FROM recovery_codes rc JOIN users u ON u.id = rc.user_id
    WHERE rc.code_hash = ? AND rc.is_used = 0
  `).get(codeHash);
}

function markRecoveryCodeUsed(db, id) {
  db.prepare(`UPDATE recovery_codes SET is_used = 1, used_at = datetime('now') WHERE id = ?`).run(id);
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function addAuditEntry(db, { user_id = null, action, target_type = null, target_id = null, details = null }) {
  db.prepare(`
    INSERT INTO audit_log (user_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(user_id, action, target_type, target_id != null ? String(target_id) : null,
         details != null ? String(details) : null);
}

function getAuditLog(db, limit = 200) {
  return db.prepare(`
    SELECT al.*, u.username AS actor_username, u.display_name AS actor_display_name
    FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.id DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  VALID_ROLES,
  countUsers, countActiveAdmins,
  getUserByUsername, getUserById, getAllUsers, createUser,
  setUserRole, setUserActive, setUserPassword, touchLastLogin,
  issueRecoveryCode, findActiveRecoveryCodeByHash, markRecoveryCodeUsed,
  addAuditEntry, getAuditLog,
};
