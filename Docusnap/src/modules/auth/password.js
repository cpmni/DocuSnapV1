'use strict';

/**
 * modules/auth/password.js
 * Password hashing and one-time-secret generation for local authentication.
 * Pure / side-effect-free (no db, no IPC) so it can be unit tested directly —
 * see test_auth.js.
 *
 * Hashing choice:
 *   - User passwords are hashed with Argon2id (argon2.hash default cost —
 *     64 MiB memory, 3 iterations, 4 lanes — meets OWASP's minimum
 *     recommendation for argon2id). Argon2id's memory-hardness is what
 *     matters here: passwords are low-entropy, human-chosen secrets, and the
 *     hash has to resist offline brute force if the database is ever copied.
 *   - Recovery codes and admin-issued temporary passwords are hashed with
 *     plain SHA-256. They are NOT human-chosen — they're generated here from
 *     a CSPRNG with ~70+ bits of entropy, so a slow, memory-hard KDF buys
 *     nothing against brute force (the search space is already infeasible)
 *     while costing real CPU time on every login/redemption check.
 */

const crypto = require('crypto');
const argon2 = require('argon2');

// ── User passwords (Argon2id) ─────────────────────────────────────────────────

async function hashPassword(plainPassword) {
  return argon2.hash(String(plainPassword), { type: argon2.argon2id });
}

async function verifyPassword(hash, plainPassword) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, String(plainPassword));
  } catch {
    // Malformed/foreign hash strings throw rather than returning false —
    // treat exactly like "did not match" so callers have one code path.
    return false;
  }
}

// ── High-entropy secrets — recovery codes & temp passwords (SHA-256) ─────────

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// Crockford-ish alphabet with visually-confusable characters removed
// (0/O, 1/I/L) — both kinds of secret below must be legible from a printout
// or screen and accurately hand-typed back in.
const SECRET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomFromAlphabet(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += SECRET_ALPHABET[bytes[i] % SECRET_ALPHABET.length];
  return out;
}

// "7K4P-9XHT-QM2D-V8RC" — 16 symbols from a 31-char alphabet ≈ 79 bits of
// entropy, grouped purely for readability (the dashes carry no information
// and are stripped before hashing/comparison).
function generateRecoveryCode() {
  const groups = [];
  for (let g = 0; g < 4; g++) groups.push(randomFromAlphabet(4));
  return groups.join('-');
}

// Admin-issued temporary password (new user / forced reset). Deliberately
// undashed so it reads as "a password to retype", not "a code to redeem" —
// keeping the two secret types visually distinct for the people relaying them.
function generateTempPassword() {
  return randomFromAlphabet(12);
}

// Both kinds of code are compared by hash, not by stored plaintext — and both
// must match regardless of how the user capitalises or spaces/dashes them
// back in, so normalise (and therefore hash) the same canonical form on the
// way in as on the way out.
function normaliseSecretInput(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashSecret(rawValue) {
  return sha256Hex(normaliseSecretInput(rawValue));
}

module.exports = {
  hashPassword, verifyPassword,
  generateRecoveryCode, generateTempPassword,
  normaliseSecretInput, hashSecret,
};
