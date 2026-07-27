'use strict';
/*
 * scripts/spike_key_wrap.js — STAGE 6a spike (SAFE, standalone). Proves the DUAL-WRAP key hierarchy's
 * novel arm: a per-install random master key wrapped by an ADMIN RECOVERY PASSPHRASE (Argon2id-family
 * KEK → AES-256-GCM), so the DB is recoverable on a new Windows profile/machine where the DPAPI wrap
 * (safeStorage, the no-prompt open arm — already proven in production by src/lib/secretStore.js) is
 * gone. This touches NOTHING in the app: no dependency install, no DB, no native rebuild. It proves the
 * crypto round-trips and fails closed on a wrong passphrase. Uses Node `crypto.scrypt` (zero deps,
 * mirrors the proven backupService container); production may use argon2 (already a dep) for the KEK.
 *
 *   node scripts/spike_key_wrap.js
 */
const crypto = require('crypto');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// ── The recovery-passphrase wrap (format: MAGIC|ver|salt(16)|iv(12)|tag(16)|wrappedKey) ──
const MAGIC = Buffer.from('SFKW', 'ascii');
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };   // = backupService's proven params

function wrapWithPassphrase(masterKey, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const kek  = crypto.scryptSync(Buffer.from(passphrase, 'utf8'), salt, 32, SCRYPT);
  const c    = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const wrapped = Buffer.concat([c.update(masterKey), c.final()]);
  const tag  = c.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([1]), salt, iv, tag, wrapped]);
}

function unwrapWithPassphrase(blob, passphrase) {
  if (blob.length < 4 + 1 + 16 + 12 + 16) throw new Error('blob too short');
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error('bad magic');
  const salt = blob.subarray(5, 21), iv = blob.subarray(21, 33), tag = blob.subarray(33, 49);
  const wrapped = blob.subarray(49);
  const kek = crypto.scryptSync(Buffer.from(passphrase, 'utf8'), salt, 32, SCRYPT);
  const d = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(wrapped), d.final()]);   // throws if tag/passphrase wrong
}

console.log('\nStage 6a — recovery-passphrase master-key wrap (standalone crypto proof)');
const masterKey = crypto.randomBytes(32);
const pass = 'correct horse battery staple';

const blob = wrapWithPassphrase(masterKey, pass);
check('wrapped blob carries MAGIC+version+salt+iv+tag+ciphertext', blob.length === 4 + 1 + 16 + 12 + 16 + 32);
check('the wrapped bytes are NOT the plaintext master key', !blob.subarray(49).equals(masterKey));

const recovered = unwrapWithPassphrase(blob, pass);
check('correct passphrase recovers the EXACT master key', recovered.equals(masterKey));

let wrongFailed = false;
try { unwrapWithPassphrase(blob, 'wrong passphrase'); } catch { wrongFailed = true; }
check('a WRONG passphrase fails closed (GCM tag rejects, no key leak)', wrongFailed);

let tamperFailed = false;
const tampered = Buffer.from(blob); tampered[tampered.length - 1] ^= 0xff;
try { unwrapWithPassphrase(tampered, pass); } catch { tamperFailed = true; }
check('a TAMPERED blob fails closed', tamperFailed);

// The DPAPI arm (no-prompt open) is safeStorage.encryptString(masterKey) — the SAME mechanism
// src/lib/secretStore.js already ships for the CA key. Both wraps protect the SAME master key, so
// normal open uses DPAPI (no prompt) and the passphrase is the escape hatch. Proven arm; not re-tested
// here (needs the Electron app context).
console.log('  --  DPAPI (safeStorage) is the no-prompt arm — proven in production by src/lib/secretStore.js');

console.log('');
if (fails) { console.log(`FAILED: ${fails} check(s)`); process.exit(1); }
console.log('All Stage-6a key-wrap spike checks passed.');
process.exit(0);
