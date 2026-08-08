'use strict';
/**
 * src/lib/auditKey.js
 * -------------------
 * Per-install HMAC key for the tamper-evident audit chain (Stage 5b). 32 random bytes,
 * generated once and stored in a SINGLE userData file (`.audit-key`), wrapped at rest by
 * `secretStore` (DPAPI, user-bound). The key is injected into the key-agnostic DB layer via
 * `auth.setAuditKey(...)` at startup, so `database/modules/auth.js` never touches the filesystem.
 *
 * DELIBERATELY OUT of the DB and OUT of every backup:
 *  - it is a plain userData file, and `backupService` only exports DB tables + settings, never
 *    arbitrary files — so the key can never ride out in a settings backup (which would let an
 *    attacker recompute the chain on another machine);
 *  - it is NOT device-portable: a copied userData tree opened as another Windows user/machine
 *    cannot decrypt it (DPAPI), which is the point — a stolen DB copy's chain is unverifiable
 *    there, and that reads as tamper, not as a silent pass.
 *
 * DPAPI-unavailable caveat: secretStore fails OPEN (writes plaintext + warns) on a host where
 * `safeStorage.isEncryptionAvailable()` is false — always true on a normal packaged Windows session,
 * false mainly in headless/RUN_AS_NODE contexts. On such a host the key is NOT machine-bound (the
 * "not device-portable" property is void), but the chain still FUNCTIONS and still detects any tamper
 * by a party who does not hold the key. We deliberately do NOT hard-fail there: refusing to persist
 * would regenerate the key each session and make every prior row verify-fail — strictly worse.
 *
 * Failure policy:
 *  - file missing            → generate + persist + return the key (fresh install / first 5b run);
 *  - file present, decrypts  → return the key;
 *  - file present, undecrypt → return NULL (chain stays inert; new rows write a NULL hmac that
 *    verify treats as a fresh GENESIS link) and warn. We do NOT silently mint a replacement key,
 *    because that would make ALL prior rows verify-fail forever and destroy the very evidence the
 *    chain exists to preserve. An admin resolves it (investigate, or delete the file to re-seed).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const secret = require('./secretStore');

const KEY_BYTES = 32;
const FILE_NAME = '.audit-key';

let _cached;            // Buffer | null once resolved; undefined = not yet attempted
let _dir;               // resolved userData dir (test-injectable)

function _resolveDir() {
  if (_dir) return _dir;
  try { _dir = require('electron').app.getPath('userData'); }
  catch { _dir = process.env.SCANFINDER_USERDATA || '.'; }
  return _dir;
}

function _filePath() { return path.join(_resolveDir(), FILE_NAME); }

// Returns the raw 32-byte key Buffer, or null if a present key cannot be read (see failure policy).
function getAuditKey(logger = console) {
  if (_cached !== undefined) return _cached;
  const file = _filePath();
  try {
    if (fs.existsSync(file)) {
      const stored = fs.readFileSync(file, 'utf8').trim();
      let plain;
      try { plain = secret.decryptAtRest(stored); }
      catch (e) {
        try { logger && logger.warn && logger.warn('auditKey: existing key present but undecryptable — audit chain inert until resolved: ' + (e && e.message)); } catch { /* noop */ }
        _cached = null; return _cached;
      }
      const buf = Buffer.from(plain, 'base64');
      if (buf.length >= 16) { _cached = buf; return _cached; }
      // Corrupt/short content — regenerate (there is no chain history worth preserving behind a bad key).
    }
    const key = crypto.randomBytes(KEY_BYTES);
    const wrapped = secret.encryptAtRest(key.toString('base64'), { logger });
    // 0o600-intent: userData is already user-scoped on Windows; write atomically-ish.
    fs.writeFileSync(file, wrapped, { encoding: 'utf8', mode: 0o600 });
    _cached = key; return _cached;
  } catch (e) {
    try { logger && logger.warn && logger.warn('auditKey: could not establish an audit key — chain inert: ' + (e && e.message)); } catch { /* noop */ }
    _cached = null; return _cached;
  }
}

// Test-only: point at a scratch dir and clear the cache.
function __setDirForTest(dir) { _dir = dir; _cached = undefined; }

module.exports = { getAuditKey, __setDirForTest, KEY_BYTES, FILE_NAME };
