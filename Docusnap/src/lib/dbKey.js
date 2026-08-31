'use strict';
/**
 * src/lib/dbKey.js
 * ----------------
 * The DB-at-rest RECOVERY CODE for whole-DB encryption (better-sqlite3-multiple-ciphers, chacha20).
 *
 * MODEL (2026-08-31, code-as-passphrase — Oracle SIGN-OFF-W/COND revising the same-day dual-wrap):
 * the printed RECOVERY CODE *is* the key material. The DB is encrypted in multiple-ciphers PASSPHRASE
 * mode (`PRAGMA key='<code>'`), so the KDF salt lives in the DB file header and the file is
 * self-sufficient: **a copy of `docusnap.db` + the code opens on ANY PC — no sidecar, no DPAPI, no
 * same-account requirement.** That is the owner's hard requirement (restore a DB backup after a
 * crash / new machine).
 *
 * `.db-key` is ONLY a no-prompt convenience: it caches the code, DPAPI-wrapped (user+machine bound,
 * fail-CLOSED), so daily launches open silently. It is NEVER required for recovery — lose it (new PC,
 * password reset) and the app asks for the code once, then re-caches it. It carries no salt and no key.
 *
 * HARD RULES (Oracle):
 *   • The value handed to `PRAGMA key`/`rekey` is ALWAYS `normaliseCode(...)` — the display form (with
 *     dashes) is print-only. A display-vs-normalised mismatch across cache/rekey/open silently BRICKS
 *     the DB, so normalisation happens at ONE boundary (here) and every consumer calls `applyKey`.
 *   • The code is charset-validated `^[0-9A-Z]+$` before it is ever interpolated into a PRAGMA.
 *   • This path accepts ONLY the generated 125-bit code. A future "user-chosen DB password" is a
 *     GPU-brute-force risk against the cipher's PBKDF2 and must reintroduce a memory-hard KDF or is
 *     forbidden (recorded so a later dev can't quietly relax it).
 *   • NEVER silently regenerate a present-but-undecryptable `.db-key` — that would strand the code.
 *   • provision() REFUSES to overwrite an existing `.db-key`.
 *
 * Pure Node crypto + files — does NOT open the DB (the pragma sequence is applied to a caller's handle
 * via `applyKey`), so it is fully testable without the native module.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const secret = require('./secretStore');

const KEY_FILE = '.db-key';

// multiple-ciphers scheme + KDF cost. Pinned + explicit (Oracle C1/C2): the fork's compile-time default
// could move across a version bump and silently brick every DB, and open() and the migration MUST agree.
const CIPHER = 'chacha20';
const KDF_ITER = 256000;

// Crockford base32 (no I/L/O/U — unambiguous read aloud / typed). 16 random bytes → 25 chars ≈ 125 bits.
const CB32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_RE = /^[0-9A-Z]+$/;   // the NORMALISED form — the only thing allowed into a PRAGMA

let _dir;   // resolved userData dir (test-injectable)

function _resolveDir() {
  if (_dir) return _dir;
  try { _dir = require('electron').app.getPath('userData'); }
  catch { _dir = process.env.SCANFINDER_USERDATA || '.'; }
  return _dir;
}
function _keyPath() { return path.join(_resolveDir(), KEY_FILE); }

function _undecryptable(msg) { const e = new Error(msg); e.code = 'DBKEY_UNDECRYPTABLE'; return e; }

/** True when the DPAPI convenience cache is present (this install has been encrypted on this machine). */
function hasKey() { return fs.existsSync(_keyPath()); }

// ── the recovery code: display form ↔ the normalised PRAGMA passphrase ──────────
function _makeCode() {
  const raw = crypto.randomBytes(16);
  let bits = '', out = '';
  for (const b of raw) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length && out.length < 25; i += 5) out += CB32[parseInt(bits.slice(i, i + 5), 2)];
  return out.replace(/(.{5})(?=.)/g, '$1-');            // 5×5 grouped for the printed card
}

/** Fold a typed/printed code to its canonical PRAGMA form. IDEMPOTENT (normalise∘normalise == normalise). */
function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/[\s-]+/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

/** A normalised code must be pure [0-9A-Z] and long enough to be a real 125-bit code — never empty/garbage. */
function isValidNormalised(norm) { return typeof norm === 'string' && CODE_RE.test(norm) && norm.length >= 20; }

/**
 * Apply the encryption passphrase to an OPEN better-sqlite3 handle: the cipher scheme, the pinned KDF
 * cost, then the key — in that exact order, BEFORE journal_mode/any read. The single choke point so the
 * scheme/iter/normalisation can never drift between open, migration and the tool. `code` may be the
 * display or typed form; it is normalised + charset-validated here.
 */
function applyKey(db, code) {
  const norm = normaliseCode(code);
  if (!isValidNormalised(norm)) throw new Error('dbKey.applyKey: invalid recovery code');
  db.pragma(`cipher = '${CIPHER}'`);
  db.pragma(`kdf_iter = ${KDF_ITER}`);
  db.pragma(`key = '${norm}'`);          // norm is ^[0-9A-Z]+$ (validated) → safe to interpolate
  return norm;
}

/**
 * Encrypt a currently-PLAINTEXT open handle in place (the migration): the same cipher + KDF, then
 * `rekey`. The caller MUST have set `journal_mode = DELETE` first — multiple-ciphers refuses a rekey in
 * WAL mode. Same normalisation/validation as applyKey so migration and open can never diverge.
 */
function applyRekey(db, code) {
  const norm = normaliseCode(code);
  if (!isValidNormalised(norm)) throw new Error('dbKey.applyRekey: invalid recovery code');
  db.pragma(`cipher = '${CIPHER}'`);
  db.pragma(`kdf_iter = ${KDF_ITER}`);
  db.pragma(`rekey = '${norm}'`);
  return norm;
}

// ── the DPAPI convenience cache ────────────────────────────────────────────────
/** Write `.db-key` = DPAPI(normalised code). FAIL-CLOSED (never a plaintext code file). Overwrites — used
 *  on provision AND when re-establishing no-prompt open on a new machine after a code recovery. */
function cacheCode(code) {
  const norm = normaliseCode(code);
  if (!isValidNormalised(norm)) throw new Error('dbKey.cacheCode: invalid recovery code');
  fs.writeFileSync(_keyPath(), secret.encryptAtRestStrict(norm), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Read the cached code for a no-prompt daily open. Returns the NORMALISED code, or null when absent
 * (a fresh/plaintext install OR a restored backup on a new PC — the caller disambiguates on the DB
 * header, see the startup decision table). THROWS 'DBKEY_UNDECRYPTABLE' when present but the DPAPI blob
 * will not decrypt (copied profile / password reset / corruption) or is not a DPAPI-wrapped valid code
 * — the caller routes to the Unlock window, NEVER regenerates, NEVER opens plaintext.
 */
function loadCode({ logger } = {}) {
  if (!hasKey()) return null;
  let stored;
  try { stored = fs.readFileSync(_keyPath(), 'utf8').trim(); }
  catch (e) { throw _undecryptable('dbKey: key cache present but unreadable: ' + (e && e.message)); }
  if (!secret.isEncrypted(stored)) throw _undecryptable('dbKey: key cache is not DPAPI-wrapped — refusing');
  let norm;
  try { norm = secret.decryptAtRest(stored); }
  catch (e) {
    try { logger && logger.warn && logger.warn('dbKey: key cache undecryptable (DPAPI) — recovery required: ' + (e && e.message)); } catch { /* noop */ }
    throw _undecryptable('dbKey: key cache undecryptable — recovery required');
  }
  if (!isValidNormalised(norm)) throw _undecryptable('dbKey: cached code failed validation');
  return norm;
}

/**
 * First-time provision: mint the recovery code and cache it (fail-closed DPAPI). Returns { recoveryCode }
 * (the DISPLAY form) to show ONCE. Does NOT touch the DB — dbMigrateEncrypt encrypts with the same code.
 * REFUSES if a cache already exists (never clobber a live install's code).
 */
function provision() {
  if (hasKey()) throw new Error('dbKey.provision: a key cache already exists — refusing to overwrite');
  const displayCode = _makeCode();
  cacheCode(displayCode);                 // stores normaliseCode(displayCode), fail-closed
  return { recoveryCode: displayCode };
}

/**
 * Mint a fresh 125-bit DISPLAY recovery code WITHOUT persisting anything (no `.db-key`, no arm). The
 * opt-in Settings ceremony shows this code, gets a typed confirm, THEN arms the migration
 * (`armMigration`) — so a cancelled ceremony leaves NOTHING on disk (the crucial difference from
 * `provision()`, which caches immediately). The SAME minted code must be the one armed and the one the
 * DB is encrypted under (Oracle C6): keep it in ONE place (main stashes it; armMigration writes it;
 * the boot handler reads it back via loadMigrateCode) so shown == armed == migrate code by construction.
 */
function mintCode() { return _makeCode(); }

// ── The DISJOINT one-time migration arm (Oracle 2026-08-31, code-as-passphrase) ─────────────────
// `.db-migrate-code` is a SEPARATE DPAPI-wrapped file from `.db-key`. The ceremony writes THIS (never
// `.db-key`), and the boot-migrate handler writes the real `.db-key` only AFTER the encrypt succeeds.
// Consequence: `.db-key` is NEVER present beside a PLAINTEXT DB, so the downgrade tripwire
// (plaintext + hasKey) keeps its exact original meaning — no state overloading, the tripwire pin is
// byte-identical. decide() self-heals a stale arm on any encrypted boot (C1) so it can never survive
// to disarm a future downgrade.
const MIGRATE_FILE = '.db-migrate-code';
function _migPath() { return path.join(_resolveDir(), MIGRATE_FILE); }

/** True when a one-time boot migration is armed on this machine. */
function hasMigrateCode() { return fs.existsSync(_migPath()); }

/** Arm the one-time boot migration: `.db-migrate-code` = DPAPI(normalised code). FAIL-CLOSED (writes
 *  nothing if DPAPI is unavailable). REFUSES to clobber an existing arm. Does NOT touch `.db-key`. */
function armMigration(code) {
  const norm = normaliseCode(code);
  if (!isValidNormalised(norm)) throw new Error('dbKey.armMigration: invalid recovery code');
  if (hasMigrateCode()) throw new Error('dbKey.armMigration: a migration is already armed — refusing to overwrite');
  fs.writeFileSync(_migPath(), secret.encryptAtRestStrict(norm), { encoding: 'utf8', mode: 0o600 });
}

/** Read the armed migration code (NORMALISED). THROWS 'DBKEY_UNDECRYPTABLE' if absent/undecryptable —
 *  the boot handler treats that as "couldn't turn on encryption, keep the plaintext DB" (Oracle C3),
 *  NEVER the encrypted-DB Unlock route. */
function loadMigrateCode({ logger } = {}) {
  if (!hasMigrateCode()) throw _undecryptable('dbKey: no migration armed');
  let stored;
  try { stored = fs.readFileSync(_migPath(), 'utf8').trim(); }
  catch (e) { throw _undecryptable('dbKey: migrate-code present but unreadable: ' + (e && e.message)); }
  if (!secret.isEncrypted(stored)) throw _undecryptable('dbKey: migrate-code is not DPAPI-wrapped — refusing');
  let norm;
  try { norm = secret.decryptAtRest(stored); }
  catch (e) {
    try { logger && logger.warn && logger.warn('dbKey: migrate-code undecryptable (DPAPI) — keeping plaintext: ' + (e && e.message)); } catch { /* noop */ }
    throw _undecryptable('dbKey: migrate-code undecryptable');
  }
  if (!isValidNormalised(norm)) throw _undecryptable('dbKey: armed code failed validation');
  return norm;
}

/** Disarm — remove `.db-migrate-code` (best-effort). Called after a successful migrate AND by
 *  decide()'s self-heal on any encrypted-DB boot (Oracle C1). */
function clearMigrateCode() { try { if (fs.existsSync(_migPath())) fs.unlinkSync(_migPath()); } catch { /* noop */ } }

// Test-only.
function __setDirForTest(dir) { _dir = dir; }

module.exports = {
  KEY_FILE, CIPHER, KDF_ITER, MIGRATE_FILE,
  hasKey, provision, loadCode, cacheCode, applyKey, applyRekey, normaliseCode, isValidNormalised,
  mintCode, hasMigrateCode, armMigration, loadMigrateCode, clearMigrateCode,
  __setDirForTest,
};
