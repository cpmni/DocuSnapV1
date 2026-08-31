'use strict';
/**
 * src/lib/secretStore.js
 * ----------------------
 * Encrypt-at-rest for small main-process secrets via Electron `safeStorage`
 * (Windows: DPAPI, user-bound). A low-level crypto-at-rest primitive.
 *
 * On-disk format: `ENC1:` + base64(ciphertext). A stored value WITHOUT that prefix is
 * treated as LEGACY PLAINTEXT and passed through unchanged — so an install written before
 * encryption keeps working, and callers migrate opportunistically (re-write encrypted on
 * next touch). A PEM/JSON/text secret never begins with `ENC1:`, so the prefix is an
 * unambiguous discriminator.
 *
 * FAIL-OPEN by design: where OS encryption is unavailable (`isEncryptionAvailable()` false,
 * or an odd pre-ready/headless context) we store PLAINTEXT and warn — never refuse.
 * Encryption here is defence-in-depth, not a functional gate; refusing would break a real
 * feature (cert issuance / MFA) on a machine where DPAPI happens to be unavailable.
 *
 * FAIL-LOUD on the read side: an already-encrypted value that CANNOT be decrypted (userData
 * copied to another Windows user/machine, or corruption) THROWS — the caller must treat that
 * as an error, never silently regenerate the secret (which, for the pinned LAN CA, would
 * invalidate every already-paired client).
 *
 * First shipped for audit H1 (the LAN `ca.key`); the same util is intended for the TOTP
 * secret column later (that wiring is deferred — it is a live-auth path needing a migration).
 */

const MAGIC = 'ENC1:';

// safeStorage source, with a test injection hook. Under ELECTRON_RUN_AS_NODE `require('electron')`
// yields the binary PATH (a string) with no `.safeStorage`, so `_ss()` returns null there and the
// util fails open — which is why the real round-trip is proven via an injected fake in tests.
let _override;   // undefined = use the real safeStorage
function _ss() {
  if (_override !== undefined) return _override;
  try { const e = require('electron'); return (e && e.safeStorage) || null; } catch { return null; }
}

function available() {
  const s = _ss();
  try { return !!(s && s.isEncryptionAvailable()); } catch { return false; }
}

function isEncrypted(stored) { return String(stored == null ? '' : stored).startsWith(MAGIC); }

function encryptAtRest(plaintext, { logger } = {}) {
  const s = String(plaintext == null ? '' : plaintext);
  if (!available()) {
    try { logger && logger.warn && logger.warn('secretStore: OS encryption unavailable — storing plaintext'); } catch { /* noop */ }
    return s;
  }
  try { return MAGIC + _ss().encryptString(s).toString('base64'); }
  catch (e) {
    try { logger && logger.warn && logger.warn('secretStore: encrypt failed, storing plaintext — ' + (e && e.message)); } catch { /* noop */ }
    return s;
  }
}

// FAIL-CLOSED variant (2026-08-31, the DB-at-rest key). The DB master key INVERTS auditKey's
// availability-over-secrecy calculus: a plaintext key file leaves the whole DB effectively
// unencrypted, so we must NEVER fall back to plaintext. Throws when OS encryption is unavailable
// or the encrypt itself fails — the caller (dbKey) must abort the write, never persist a bare key.
function encryptAtRestStrict(plaintext) {
  const s = String(plaintext == null ? '' : plaintext);
  if (!available()) {
    throw new Error('secretStore: OS encryption unavailable — refusing to write a plaintext DB key (fail-closed)');
  }
  try { return MAGIC + _ss().encryptString(s).toString('base64'); }
  catch (e) {
    throw new Error('secretStore: encrypt failed — refusing a plaintext DB key write (fail-closed): ' + (e && e.message));
  }
}

function decryptAtRest(stored) {
  const s = String(stored == null ? '' : stored);
  if (!s.startsWith(MAGIC)) return s;   // legacy plaintext — pass through unchanged
  const ss = _ss();
  if (!ss) throw new Error('secretStore: an encrypted value is present but safeStorage is unavailable');
  return ss.decryptString(Buffer.from(s.slice(MAGIC.length), 'base64'));   // throws on wrong-user / corrupt
}

// Test-only: inject a fake safeStorage ({ isEncryptionAvailable, encryptString, decryptString })
// or `null` to force the unavailable path. Call with `undefined` to restore the real one.
function __setSafeStorage(x) { _override = x; }

module.exports = {
  MAGIC, available, isEncrypted, encryptAtRest, encryptAtRestStrict, decryptAtRest,
  encrypt: encryptAtRest, decrypt: decryptAtRest,   // aliases matching the injected `secret` shape
  __setSafeStorage,
};
