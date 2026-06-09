'use strict';

/**
 * modules/auth/handler.js
 * Local authentication & authorisation — first-run admin setup, login/logout,
 * password change & admin-driven reset, one-time admin-recovery codes, user
 * management, and the audit trail.
 *
 * Session model: DocuSnap is a single-instance desktop app, so "the session"
 * is just one in-memory record (currentSession) shared by every window in
 * this process — there is nothing to persist across launches by design (the
 * user logs in each time the app starts).
 *
 * This module is also the single source of truth for permission checks.
 * Other handler modules import { requireRole, hasRole, getCurrentUser } and
 * call requireRole(...) at the top of any IPC handler that touches something
 * role-restricted — see review/handler.js, processing/handler.js,
 * settings/handler.js. The renderer-side hiding of controls in those windows
 * is a UX nicety only; THIS is the actual enforcement boundary.
 */

const auth = require('../../../database/modules/auth');
const pw   = require('./password');

const GENERIC_LOGIN_ERROR    = 'Invalid username or password.';
const GENERIC_RECOVERY_ERROR = 'That recovery code is invalid or has already been used.';

// ── Session (in-memory, single shared instance) ──────────────────────────────

let currentSession = null; // { id, username, displayName, role } | null

function getCurrentUser() {
  return currentSession;
}

function hasRole(...roles) {
  return !!currentSession && roles.includes(currentSession.role);
}

// Throws — used at the top of any IPC handler that just needs *someone*
// signed in (no specific role), e.g. read queries shared by every role such
// as document search/preview. Distinct from requireRole so call sites read
// as "any authenticated user" rather than an easy-to-misread `requireRole()`
// (which — called with zero roles — would reject every role, including admin).
function requireLogin() {
  if (!currentSession) {
    throw Object.assign(new Error('You must be logged in to do that.'), { code: 'AUTH_REQUIRED' });
  }
  return currentSession;
}

// Throws — used at the top of any IPC handler that needs to be role-gated.
// Thrown Error messages cross the IPC boundary as the rejection reason, so
// keep them accurate-but-unrevealing: the caller is already authenticated,
// so "you lack permission" leaks nothing an attacker could use.
function requireRole(...roles) {
  requireLogin();
  if (!roles.includes(currentSession.role)) {
    throw Object.assign(new Error('You do not have permission to perform this action.'), { code: 'FORBIDDEN' });
  }
  return currentSession;
}

function _toSessionUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
}

function _publicUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

// ── Failed-login rate limiting (progressive delay) ───────────────────────────
// Keyed by normalised username so the *account* slows down regardless of
// which (wrong) password was tried — this is what stops credential-stuffing
// against one account, which is the realistic threat for a local desktop app
// (there is no large user base to spread an attack across).

const RATE_LIMIT_DELAYS_MS = [0, 0, 1000, 2000, 5000, 15000, 30000];
const _failedAttempts = new Map(); // usernameKey -> { count, blockedUntil }

function _rateLimitKey(username) {
  return String(username || '').trim().toLowerCase();
}
function _checkRateLimit(username) {
  const entry = _failedAttempts.get(_rateLimitKey(username));
  if (!entry) return { blocked: false, retryAfterMs: 0 };
  const remaining = entry.blockedUntil - Date.now();
  return remaining > 0 ? { blocked: true, retryAfterMs: remaining } : { blocked: false, retryAfterMs: 0 };
}
function _recordFailedAttempt(username) {
  const key = _rateLimitKey(username);
  const entry = _failedAttempts.get(key) || { count: 0, blockedUntil: 0 };
  entry.count += 1;
  entry.blockedUntil = Date.now() + RATE_LIMIT_DELAYS_MS[Math.min(entry.count, RATE_LIMIT_DELAYS_MS.length - 1)];
  _failedAttempts.set(key, entry);
}
function _clearRateLimit(username) {
  _failedAttempts.delete(_rateLimitKey(username));
}

// Constant-shape comparison target for unknown usernames, so "no such user"
// and "wrong password" take statistically the same amount of time and the
// generic error message isn't betrayed by a response-time side channel.
let _dummyHashPromise = null;
function _dummyHash() {
  if (!_dummyHashPromise) _dummyHashPromise = pw.hashPassword('not-a-real-account-password');
  return _dummyHashPromise;
}

// ── Validation helpers ────────────────────────────────────────────────────────

function _validateUsername(username) {
  const u = String(username || '').trim();
  if (!u) return 'Username is required.';
  if (u.length < 2 || u.length > 40) return 'Username must be between 2 and 40 characters.';
  if (!/^[A-Za-z0-9._-]+$/.test(u)) return 'Username can only contain letters, numbers, dots, hyphens, and underscores.';
  return null;
}

// Length over composition rules — current OWASP guidance: a reasonable
// minimum length resists brute force better than forced complexity, which
// mostly just pushes users toward predictable substitutions.
function _validateNewPassword(plainPassword, confirmPassword) {
  const p = String(plainPassword == null ? '' : plainPassword);
  if (p.length < 8)   return 'Password must be at least 8 characters.';
  if (p.length > 128) return 'Password must be 128 characters or fewer.';
  if (p !== String(confirmPassword == null ? '' : confirmPassword)) return 'Passwords do not match.';
  return null;
}

// ── Register IPC ──────────────────────────────────────────────────────────────

function register(ctx) {
  const { ipcMain, getDb, notifyAllWindows, logger } = ctx;

  const audit = (entry) => { try { auth.addAuditEntry(getDb(), entry); } catch (e) { logger?.warn(`[auth] audit write failed: ${e.message}`); } };
  const broadcastSession = () => notifyAllWindows('auth-session-changed', currentSession);

  // ── Status (drives which screen the login window shows) ────────────────────
  ipcMain.handle('auth-get-status', () => ({
    needsFirstRunSetup: auth.countUsers(getDb()) === 0,
    currentUser: currentSession,
  }));

  ipcMain.handle('auth-get-current-user', () => currentSession);

  // ── First-run admin setup ───────────────────────────────────────────────────
  ipcMain.handle('auth-first-run-setup', async (_e, data = {}) => {
    const db = getDb();
    if (auth.countUsers(db) > 0) {
      return { success: false, error: 'Setup has already been completed.' };
    }

    const { username, displayName, password: plainPassword, confirmPassword } = data;
    const uErr = _validateUsername(username);
    if (uErr) return { success: false, error: uErr };
    if (!String(displayName || '').trim()) return { success: false, error: 'Display name is required.' };
    const pErr = _validateNewPassword(plainPassword, confirmPassword);
    if (pErr) return { success: false, error: pErr };

    const password_hash = await pw.hashPassword(plainPassword);
    const user = auth.createUser(db, {
      username: username.trim(), display_name: displayName.trim(),
      password_hash, role: 'admin', must_change_password: 0,
    });
    audit({ user_id: user.id, action: 'user_created', target_type: 'user', target_id: user.id, details: 'first_run_admin_setup' });

    const recoveryCode = pw.generateRecoveryCode();
    auth.issueRecoveryCode(db, user.id, pw.hashSecret(recoveryCode));
    audit({ user_id: user.id, action: 'recovery_code_issued', target_type: 'user', target_id: user.id, details: 'first_run' });

    auth.touchLastLogin(db, user.id);
    audit({ user_id: user.id, action: 'login_success', target_type: 'user', target_id: user.id, details: 'first_run_auto_login' });
    currentSession = _toSessionUser(user);
    broadcastSession();

    return { success: true, user: currentSession, recoveryCode };
  });

  // ── Login / logout ──────────────────────────────────────────────────────────
  ipcMain.handle('auth-login', async (_e, data = {}) => {
    const db = getDb();
    const usernameInput = String(data.username || '').trim();
    const plainPassword = String(data.password || '');

    const limit = _checkRateLimit(usernameInput);
    if (limit.blocked) {
      return { success: false, error: 'Too many attempts. Please wait before trying again.', retryAfterMs: limit.retryAfterMs };
    }

    const user = auth.getUserByUsername(db, usernameInput);
    const hashToCheck = user ? user.password_hash : await _dummyHash();
    const passwordMatches = await pw.verifyPassword(hashToCheck, plainPassword);

    if (!user || !passwordMatches) {
      _recordFailedAttempt(usernameInput);
      audit({
        user_id: user ? user.id : null, action: 'login_failure', target_type: 'user',
        target_id: user ? user.id : usernameInput || null,
        details: user ? 'bad_password' : 'unknown_username',
      });
      return { success: false, error: GENERIC_LOGIN_ERROR };
    }

    if (!user.is_active) {
      audit({ user_id: user.id, action: 'login_failure', target_type: 'user', target_id: user.id, details: 'disabled' });
      return { success: false, error: 'This account has been disabled. Contact your administrator.' };
    }

    _clearRateLimit(usernameInput);
    auth.touchLastLogin(db, user.id);
    audit({ user_id: user.id, action: 'login_success', target_type: 'user', target_id: user.id });

    currentSession = _toSessionUser(user);
    broadcastSession();

    return { success: true, user: currentSession, mustChangePassword: !!user.must_change_password };
  });

  ipcMain.handle('auth-logout', () => {
    if (currentSession) {
      audit({ user_id: currentSession.id, action: 'logout', target_type: 'user', target_id: currentSession.id });
    }
    currentSession = null;
    broadcastSession();
    return { success: true };
  });

  // ── Self-service password change (requires current password) ───────────────
  ipcMain.handle('auth-change-password', async (_e, data = {}) => {
    if (!currentSession) return { success: false, error: 'You must be logged in.' };
    const db = getDb();
    const user = auth.getUserById(db, currentSession.id);
    if (!user) return { success: false, error: 'Account no longer exists.' };

    const { currentPassword, newPassword, confirmPassword } = data;
    const ok = await pw.verifyPassword(user.password_hash, String(currentPassword || ''));
    if (!ok) return { success: false, error: 'Current password is incorrect.' };

    const pErr = _validateNewPassword(newPassword, confirmPassword);
    if (pErr) return { success: false, error: pErr };
    if (String(newPassword) === String(currentPassword)) {
      return { success: false, error: 'New password must be different from your current password.' };
    }

    auth.setUserPassword(db, user.id, await pw.hashPassword(newPassword), false);
    audit({ user_id: user.id, action: 'password_change', target_type: 'user', target_id: user.id, details: 'self_service' });
    return { success: true };
  });

  // ── Forced password change after an admin reset (must_change_password) ─────
  // No "current password" field here — the temporary password the user just
  // authenticated with *is* the proof of identity for this one-time step.
  ipcMain.handle('auth-set-new-password-after-reset', async (_e, data = {}) => {
    if (!currentSession) return { success: false, error: 'You must be logged in.' };
    const db = getDb();
    const user = auth.getUserById(db, currentSession.id);
    if (!user) return { success: false, error: 'Account no longer exists.' };
    if (!user.must_change_password) return { success: false, error: 'No password change is required.' };

    const { newPassword, confirmPassword } = data;
    const pErr = _validateNewPassword(newPassword, confirmPassword);
    if (pErr) return { success: false, error: pErr };

    auth.setUserPassword(db, user.id, await pw.hashPassword(newPassword), false);
    audit({ user_id: user.id, action: 'password_change', target_type: 'user', target_id: user.id, details: 'forced_reset_completed' });
    return { success: true };
  });

  // ── Admin-recovery via one-time code ────────────────────────────────────────
  ipcMain.handle('auth-recover-admin', async (_e, data = {}) => {
    const db = getDb();
    const codeInput = String(data.recoveryCode || '').trim();
    if (!codeInput) return { success: false, error: 'Enter your recovery code.' };

    const record = auth.findActiveRecoveryCodeByHash(db, pw.hashSecret(codeInput));

    // A code that doesn't match, belongs to a non-admin, or whose account is
    // disabled all fail with the SAME generic message — distinguishing them
    // would tell an attacker things like "this account is an admin" or
    // "this account exists but is disabled".
    if (!record || record.role !== 'admin' || !record.is_active) {
      audit({
        user_id: record ? record.user_id : null, action: 'recovery_code_use',
        target_type: 'user', target_id: record ? record.user_id : null, details: 'failed',
      });
      return { success: false, error: GENERIC_RECOVERY_ERROR };
    }

    const pErr = _validateNewPassword(data.newPassword, data.confirmPassword);
    if (pErr) return { success: false, error: pErr };

    const password_hash = await pw.hashPassword(data.newPassword);
    const newCode       = pw.generateRecoveryCode();

    db.transaction(() => {
      auth.setUserPassword(db, record.user_id, password_hash, false);
      auth.markRecoveryCodeUsed(db, record.id);
      auth.issueRecoveryCode(db, record.user_id, pw.hashSecret(newCode));
    })();

    audit({ user_id: record.user_id, action: 'recovery_code_use', target_type: 'user', target_id: record.user_id, details: 'success' });
    audit({ user_id: record.user_id, action: 'password_reset', target_type: 'user', target_id: record.user_id, details: 'admin_recovery_code' });
    audit({ user_id: record.user_id, action: 'recovery_code_issued', target_type: 'user', target_id: record.user_id, details: 'rotated_after_use' });

    const user = auth.getUserById(db, record.user_id);
    auth.touchLastLogin(db, user.id);
    audit({ user_id: user.id, action: 'login_success', target_type: 'user', target_id: user.id, details: 'admin_recovery_auto_login' });
    currentSession = _toSessionUser(user);
    broadcastSession();

    return { success: true, user: currentSession, recoveryCode: newCode };
  });

  // ── User management (Admin only — enforced here, not just hidden in UI) ────
  ipcMain.handle('auth-list-users', () => {
    requireRole('admin');
    const db = getDb();
    return { users: auth.getAllUsers(db), activeAdminCount: auth.countActiveAdmins(db) };
  });

  ipcMain.handle('auth-create-user', async (_e, data = {}) => {
    requireRole('admin');
    const db = getDb();
    const { username, displayName, role } = data;

    const uErr = _validateUsername(username);
    if (uErr) return { success: false, error: uErr };
    if (!String(displayName || '').trim()) return { success: false, error: 'Display name is required.' };
    if (!auth.VALID_ROLES.includes(role)) return { success: false, error: 'Choose a valid role.' };
    if (auth.getUserByUsername(db, username)) return { success: false, error: 'That username is already in use.' };

    const tempPassword  = pw.generateTempPassword();
    const password_hash = await pw.hashPassword(tempPassword);
    const user = auth.createUser(db, {
      username: username.trim(), display_name: displayName.trim(),
      password_hash, role, must_change_password: 1,
    });
    audit({ user_id: currentSession.id, action: 'user_created', target_type: 'user', target_id: user.id, details: `role=${role}` });

    return { success: true, user: _publicUser(user), tempPassword };
  });

  ipcMain.handle('auth-set-user-role', (_e, data = {}) => {
    requireRole('admin');
    const db = getDb();
    const target = auth.getUserById(db, data.userId);
    if (!target) return { success: false, error: 'User not found.' };
    if (!auth.VALID_ROLES.includes(data.role)) return { success: false, error: 'Choose a valid role.' };

    if (target.role === 'admin' && data.role !== 'admin' && target.is_active
        && auth.countActiveAdmins(db, target.id) === 0) {
      return { success: false, error: 'At least one active Admin account must remain — promote another user to Admin first.' };
    }

    auth.setUserRole(db, target.id, data.role);
    audit({ user_id: currentSession.id, action: 'role_change', target_type: 'user', target_id: target.id, details: `${target.role} -> ${data.role}` });
    return { success: true };
  });

  ipcMain.handle('auth-set-user-active', (_e, data = {}) => {
    requireRole('admin');
    const db = getDb();
    const target = auth.getUserById(db, data.userId);
    if (!target) return { success: false, error: 'User not found.' };
    const wantActive = !!data.isActive;

    if (!wantActive) {
      if (currentSession.id === target.id) {
        return { success: false, error: 'You cannot disable your own account.' };
      }
      if (target.role === 'admin' && target.is_active && auth.countActiveAdmins(db, target.id) === 0) {
        return { success: false, error: 'At least one active Admin account must remain — promote another user to Admin first.' };
      }
    }

    auth.setUserActive(db, target.id, wantActive);
    audit({ user_id: currentSession.id, action: wantActive ? 'user_enabled' : 'user_disabled', target_type: 'user', target_id: target.id });
    return { success: true };
  });

  ipcMain.handle('auth-admin-reset-password', async (_e, data = {}) => {
    requireRole('admin');
    const db = getDb();
    const target = auth.getUserById(db, data.userId);
    if (!target) return { success: false, error: 'User not found.' };

    const tempPassword  = pw.generateTempPassword();
    const password_hash = await pw.hashPassword(tempPassword);
    auth.setUserPassword(db, target.id, password_hash, true);
    audit({ user_id: currentSession.id, action: 'password_reset', target_type: 'user', target_id: target.id, details: 'admin_reset' });

    return { success: true, tempPassword };
  });

  // ── Audit log (Admin only) ──────────────────────────────────────────────────
  ipcMain.handle('auth-get-audit-log', (_e, limit) => {
    requireRole('admin');
    const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
    return auth.getAuditLog(getDb(), n);
  });
}

// Safe audit helper for use by other main-process modules.
// Injects the current session's user_id automatically.
function logAudit(db, entry) {
  try {
    auth.addAuditEntry(db, { user_id: currentSession?.id ?? null, ...entry });
  } catch (e) {
    // Non-fatal — audit write failure must never block the triggering action.
  }
}

module.exports = { register, getCurrentUser, hasRole, requireRole, requireLogin, logAudit };
