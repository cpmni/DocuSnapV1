'use strict';
/**
 * src/lib/dbKey.js
 * ----------------
 * The per-install 32-byte MASTER KEY for whole-DB-at-rest encryption (better-sqlite3-multiple-ciphers,
 * raw ChaCha20 hexkey — no KDF at the DB boundary). DUAL-WRAPPED in userData, OUTSIDE the encrypted DB
 * and outside every backup (backupService exports DB tables + settings only, never arbitrary files):
 *
 *   • WRAP A — DPAPI, no-prompt open: `.db-key` = secretStore.encryptAtRestStrict(base64(masterKey)).
 *     FAIL-CLOSED (unlike auditKey): the DB key INVERTS auditKey's availability-over-secrecy calculus —
 *     a plaintext key file would leave the whole DB effectively unencrypted, so we NEVER write plaintext.
 *
 *   • WRAP B — one-time printed RECOVERY KEY: `.db-recovery` = masterKey under argon2id(recovery-code)
 *     → AES-256-GCM. Shown ONCE on the final onboarding card (there is no daily password — the login
 *     lives inside the DB, and /v1 + tray run headless). Losing DPAPI alone is NOT data loss (the code
 *     recovers on a new profile/machine); losing BOTH the DPAPI blob and the code is permanent loss.
 *
 * HARD RULES (Oracle SIGN-OFF-W/COND 2026-08-31):
 *   • NEVER silently regenerate a present-but-undecryptable key — that would orphan the encrypted DB
 *     forever. A present key that will not decrypt THROWS (code 'DBKEY_UNDECRYPTABLE'); the caller routes
 *     to the Unlock/Recover window, never past it.
 *   • the master key is ALWAYS asserted 32 bytes on both write and read (a short/empty key makes every
 *     downstream gate pass on a plaintext output).
 *   • provision() REFUSES to overwrite an existing `.db-key` (a live key is never clobbered).
 *
 * This module is pure Node crypto + argon2 + files — it does NOT open the DB, so it is fully testable
 * without the multiple-ciphers native module (the DB seam lives in database/index.js setEncryptionKey).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');
const secret = require('./secretStore');

const KEY_BYTES = 32;
const KEY_FILE = '.db-key';
const RECOVERY_FILE = '.db-recovery';

// Recovery-blob container: MAGIC(4) | ver(1) | salt(16) | iv(12) | tag(16) | wrapped(32) = 81 bytes.
const REC_MAGIC = Buffer.from('SFDK', 'ascii');
const REC_VER = 1;
const REC_SALT = 16, REC_IV = 12, REC_TAG = 16;
const REC_HEAD = REC_MAGIC.length + 1;                 // magic + version
const REC_LEN = REC_HEAD + REC_SALT + REC_IV + REC_TAG + KEY_BYTES;
// argon2id KEK params for ver 1. Fixed per version so an old blob always unwraps; bump REC_VER to change.
const ARGON = { type: argon2.argon2id, hashLength: 32, timeCost: 3, memoryCost: 64 * 1024, parallelism: 1 };

// Crockford base32 (no I/L/O/U — unambiguous when read aloud / typed). The recovery CODE is the secret
// that wraps the key, so it needs real entropy: 25 chars ≈ 125 bits, grouped 5×5 for legibility.
const CB32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let _dir;   // resolved userData dir (test-injectable)

function _resolveDir() {
  if (_dir) return _dir;
  try { _dir = require('electron').app.getPath('userData'); }
  catch { _dir = process.env.SCANFINDER_USERDATA || '.'; }
  return _dir;
}
function _keyPath() { return path.join(_resolveDir(), KEY_FILE); }
function _recPath() { return path.join(_resolveDir(), RECOVERY_FILE); }

function _undecryptable(msg) {
  const e = new Error(msg);
  e.code = 'DBKEY_UNDECRYPTABLE';
  return e;
}

/** True when a DPAPI-wrapped key file is present (i.e. this install has been encrypted). */
function hasKey() { return fs.existsSync(_keyPath()); }
/** True when a recovery blob is present. */
function hasRecovery() { return fs.existsSync(_recPath()); }

// ── recovery code (display) ↔ argon2 password (normalised) ──────────────────────
function _makeCode() {
  const raw = crypto.randomBytes(16);                 // 128 bits
  let bits = '', out = '';
  for (const b of raw) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length && out.length < 25; i += 5) out += CB32[parseInt(bits.slice(i, i + 5), 2)];
  // 128 bits / 5 = 25.6 → 25 chars used; group 5×5 with dashes for the printed card.
  return out.replace(/(.{5})(?=.)/g, '$1-');
}
/** Normalise a typed code to its argon2 password form (uppercase, strip separators, fix look-alikes). */
function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/[\s-]+/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

async function _wrapRecovery(masterKey, code) {
  const salt = crypto.randomBytes(REC_SALT);
  const iv = crypto.randomBytes(REC_IV);
  const kek = await argon2.hash(normaliseCode(code), { ...ARGON, raw: true, salt });
  const c = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const wrapped = Buffer.concat([c.update(masterKey), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([REC_MAGIC, Buffer.from([REC_VER]), salt, iv, tag, wrapped]);
}

async function _unwrapRecovery(blob, code) {
  if (!Buffer.isBuffer(blob) || blob.length !== REC_LEN) throw _undecryptable('recovery blob malformed');
  if (!blob.subarray(0, REC_MAGIC.length).equals(REC_MAGIC)) throw _undecryptable('recovery blob bad magic');
  if (blob[REC_MAGIC.length] !== REC_VER) throw _undecryptable('recovery blob version unsupported');
  let o = REC_HEAD;
  const salt = blob.subarray(o, o += REC_SALT);
  const iv = blob.subarray(o, o += REC_IV);
  const tag = blob.subarray(o, o += REC_TAG);
  const wrapped = blob.subarray(o);
  const kek = await argon2.hash(normaliseCode(code), { ...ARGON, raw: true, salt });
  let key;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', kek, iv);
    d.setAuthTag(tag);
    key = Buffer.concat([d.update(wrapped), d.final()]);       // GCM tag rejects a wrong code / tamper
  } catch (e) {
    throw _undecryptable('recovery code incorrect or blob tampered');
  }
  if (key.length !== KEY_BYTES) throw _undecryptable('recovered key wrong length');
  return key;
}

function _assertKey(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== KEY_BYTES) {
    throw _undecryptable(`DB key must be exactly ${KEY_BYTES} bytes`);
  }
  return buf;
}

// ── public API ──────────────────────────────────────────────────────────────
/**
 * First-time provision: mint the master key, DPAPI-wrap it (fail-closed), and write the recovery blob.
 * Returns { recoveryCode } to display ONCE. REFUSES if a key already exists (never clobber a live key).
 * FAIL-CLOSED: if DPAPI is unavailable the strict write throws and NOTHING is written — no plaintext key.
 */
async function provision({ logger } = {}) {
  if (hasKey()) throw new Error('dbKey.provision: a key already exists — refusing to overwrite');
  const masterKey = _assertKey(crypto.randomBytes(KEY_BYTES));
  const wrappedDpapi = secret.encryptAtRestStrict(masterKey.toString('base64'));   // throws if unavailable
  const code = _makeCode();
  const recBlob = await _wrapRecovery(masterKey, code);
  // Write the recovery blob first, then the DPAPI key: if we crash between, a present recovery + absent
  // key is recoverable (the code unwraps it); the reverse could strand the DB with no printed escape.
  fs.writeFileSync(_recPath(), recBlob, { mode: 0o600 });
  fs.writeFileSync(_keyPath(), wrappedDpapi, { encoding: 'utf8', mode: 0o600 });
  try { logger && logger.info && logger.info('dbKey: provisioned a new DB master key'); } catch { /* noop */ }
  return { recoveryCode: code, masterKey };
}

/**
 * Load the master key for a normal (DPAPI) open. Returns:
 *   • null                    when absent (fresh / not-yet-encrypted install);
 *   • the 32-byte Buffer      when present and decryptable;
 * THROWS code 'DBKEY_UNDECRYPTABLE' when present but the DPAPI blob will not decrypt (copied profile /
 * corruption) or is the wrong length — the caller routes to Unlock/Recover, NEVER regenerates.
 */
function loadKey({ logger } = {}) {
  if (!hasKey()) return null;
  let stored;
  try { stored = fs.readFileSync(_keyPath(), 'utf8').trim(); }
  catch (e) { throw _undecryptable('dbKey: key file present but unreadable: ' + (e && e.message)); }
  let plain;
  try { plain = secret.decryptAtRest(stored); }
  catch (e) {
    try { logger && logger.warn && logger.warn('dbKey: key present but undecryptable (DPAPI) — recovery required: ' + (e && e.message)); } catch { /* noop */ }
    throw _undecryptable('dbKey: key present but undecryptable — recovery required');
  }
  // A key that was somehow written WITHOUT the ENC1: prefix (a plaintext leak) is treated as a hard
  // error, not silently trusted — the strict write is the only sanctioned path.
  if (!secret.isEncrypted(stored)) throw _undecryptable('dbKey: key file is not DPAPI-wrapped — refusing');
  return _assertKey(Buffer.from(plain, 'base64'));
}

/**
 * Recover the master key from the printed code (a new profile/machine where DPAPI is gone). When
 * rewrapDpapi is true (default) and DPAPI is available, re-writes `.db-key` on THIS machine so the next
 * launch opens no-prompt again. Throws 'DBKEY_UNDECRYPTABLE' on a wrong code / tampered blob.
 */
async function recover(code, { rewrapDpapi = true, logger } = {}) {
  if (!hasRecovery()) throw _undecryptable('dbKey: no recovery blob present');
  const blob = fs.readFileSync(_recPath());
  const masterKey = _assertKey(await _unwrapRecovery(blob, code));
  if (rewrapDpapi && secret.available()) {
    try { fs.writeFileSync(_keyPath(), secret.encryptAtRestStrict(masterKey.toString('base64')), { encoding: 'utf8', mode: 0o600 }); }
    catch (e) { try { logger && logger.warn && logger.warn('dbKey: recovered but could not re-wrap for DPAPI: ' + (e && e.message)); } catch { /* noop */ } }
  }
  return masterKey;
}

/**
 * Regenerate the recovery blob under a NEW code (the ceremony's "print a new recovery key" — no copy of
 * the old code is stored, so re-showing the old one is impossible by construction). Returns { recoveryCode }.
 */
async function regenerateRecovery(masterKey, { logger } = {}) {
  _assertKey(masterKey);
  const code = _makeCode();
  fs.writeFileSync(_recPath(), await _wrapRecovery(masterKey, code), { mode: 0o600 });
  try { logger && logger.info && logger.info('dbKey: recovery key regenerated'); } catch { /* noop */ }
  return { recoveryCode: code };
}

// Test-only: point at a scratch dir.
function __setDirForTest(dir) { _dir = dir; }

module.exports = {
  KEY_BYTES, KEY_FILE, RECOVERY_FILE, REC_LEN, ARGON,
  hasKey, hasRecovery, provision, loadKey, recover, regenerateRecovery,
  normaliseCode, __setDirForTest,
  // exposed for the DB seam / pins:
  _wrapRecovery, _unwrapRecovery,
};
