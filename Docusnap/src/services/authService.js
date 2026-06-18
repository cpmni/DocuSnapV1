'use strict';

/**
 * services/authService.js
 * -----------------------
 * Credential verification for the detached-client auth boundary. Validates a
 * local account (the SAME users table + Argon2id hashes as the desktop app) and,
 * when the account has TOTP enabled, a second factor — then hands a verified
 * identity to sessionService for token issuance. It does NOT itself read the
 * Electron session or relax any in-process check; it's a pure verifier.
 *
 * Reuses: modules/auth/password.verifyPassword (Argon2id), lib/totp.verify,
 * database/modules/auth (user lookup + TOTP fields). Adds a per-username
 * progressive-delay rate limiter mirroring the desktop login (credential-stuffing
 * against one account is the realistic threat for a small LAN deployment).
 *
 * createAuthenticator(deps) returns { login } with injectable collaborators so it
 * is deterministically testable (clock, db module, password/totp verifiers).
 */

const RATE_LIMIT_DELAYS_MS = [0, 0, 1000, 2000, 5000, 15000, 30000];
const GENERIC_LOGIN_ERROR = 'Invalid username or password.';

function createAuthenticator(deps = {}) {
  const now          = deps.now || (() => Date.now());
  const dbAuth       = deps.dbAuth || require('../../database/modules/auth');
  const pw           = deps.pw || require('../modules/auth/password');
  const totp         = deps.totp || require('../lib/totp');
  const verifyTotp   = deps.verifyTotp || ((token, secret) => totp.verify(token, secret));

  // Lazily-computed constant-shape hash so "no such user" costs ~the same as
  // "wrong password" (don't betray account existence via response time).
  let _dummyHashPromise = null;
  const dummyHash = () => (_dummyHashPromise || (_dummyHashPromise = pw.hashPassword('not-a-real-account-password')));

  const failed = new Map(); // usernameKey -> { count, blockedUntil }
  const key = (u) => String(u || '').trim().toLowerCase();

  function checkRate(username) {
    const e = failed.get(key(username));
    if (!e) return { blocked: false, retryAfterMs: 0 };
    const remaining = e.blockedUntil - now();
    return remaining > 0 ? { blocked: true, retryAfterMs: remaining } : { blocked: false, retryAfterMs: 0 };
  }
  function recordFailure(username) {
    const k = key(username);
    const e = failed.get(k) || { count: 0, blockedUntil: 0 };
    e.count += 1;
    e.blockedUntil = now() + RATE_LIMIT_DELAYS_MS[Math.min(e.count, RATE_LIMIT_DELAYS_MS.length - 1)];
    failed.set(k, e);
  }
  function clearRate(username) { failed.delete(key(username)); }

  /**
   * @returns one of:
   *   { ok:true, user:{ id, username, displayName, role } }
   *   { ok:false, code:'RATE_LIMITED', retryAfterMs, error }
   *   { ok:false, code:'INVALID'|'DISABLED', error }
   *   { ok:false, code:'MFA_REQUIRED', mfaRequired:true, error }
   *   { ok:false, code:'MFA_INVALID', error }
   */
  async function login(db, { username, password, totp: totpToken } = {}) {
    const limit = checkRate(username);
    if (limit.blocked) {
      return { ok: false, code: 'RATE_LIMITED', retryAfterMs: limit.retryAfterMs,
               error: 'Too many attempts. Please wait before trying again.' };
    }

    const user = dbAuth.getUserByUsername(db, username);
    const hashToCheck = user ? user.password_hash : await dummyHash();
    const passwordOk = await pw.verifyPassword(hashToCheck, String(password || ''));

    if (!user || !passwordOk) {
      recordFailure(username);
      return { ok: false, code: 'INVALID', error: GENERIC_LOGIN_ERROR };
    }
    if (!user.is_active) {
      return { ok: false, code: 'DISABLED', error: 'This account has been disabled. Contact your administrator.' };
    }

    // Second factor — only when this account has enrolled+enabled TOTP.
    if (user.totp_enabled) {
      if (!totpToken) {
        return { ok: false, code: 'MFA_REQUIRED', mfaRequired: true, error: 'Authentication code required.' };
      }
      if (!user.totp_secret || !verifyTotp(totpToken, user.totp_secret)) {
        recordFailure(username); // brute-forcing codes is rate-limited too
        return { ok: false, code: 'MFA_INVALID', error: 'Invalid authentication code.' };
      }
    }

    clearRate(username);
    return {
      ok: true,
      user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
    };
  }

  return { login, _checkRate: checkRate };
}

module.exports = { createAuthenticator, RATE_LIMIT_DELAYS_MS };
