#!/usr/bin/env node
'use strict';
/**
 * Hermetic tests for lib/secretStore (audit H1 encrypt-at-rest primitive).
 * safeStorage/DPAPI is unavailable under ELECTRON_RUN_AS_NODE, so the real crypto path is
 * exercised through an INJECTED fake safeStorage; the fail-open and legacy-passthrough paths
 * are tested directly. Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_secretstore.js
 */
const S = require('./secretStore');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + label); } };

// A reversible fake safeStorage (identity encoding so we can assert the ENC1: + base64 wrap).
const fakeSS = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(String(s), 'utf8'),
  decryptString: (b) => Buffer.from(b).toString('utf8'),
};

// ── available() reflects the injected safeStorage ──
S.__setSafeStorage(fakeSS);
check('available() true when safeStorage says so', S.available() === true);

// ── round-trip through the real code path (with the fake) ──
const pem = '-----BEGIN RSA PRIVATE KEY-----\nabc123==\n-----END RSA PRIVATE KEY-----\n';
const enc = S.encryptAtRest(pem);
check('encrypted value carries the ENC1: magic', enc.startsWith('ENC1:'));
check('encrypted value is not the plaintext', enc !== pem && !enc.includes('BEGIN RSA'));
check('isEncrypted() true on an encrypted value', S.isEncrypted(enc) === true);
check('decryptAtRest reverses encryptAtRest', S.decryptAtRest(enc) === pem);

// ── legacy plaintext passthrough (no ENC1: prefix) ──
check('isEncrypted() false on a raw PEM', S.isEncrypted(pem) === false);
check('decryptAtRest passes a legacy plaintext value through unchanged', S.decryptAtRest(pem) === pem);

// ── FAIL-OPEN: encryption unavailable ⇒ store plaintext, never throw ──
S.__setSafeStorage(null);
check('available() false when safeStorage is null', S.available() === false);
let warned = false;
const outPlain = S.encryptAtRest(pem, { logger: { warn: () => { warned = true; } } });
check('encryptAtRest returns plaintext when unavailable', outPlain === pem);
check('encryptAtRest warns when it falls back to plaintext', warned === true);
check('decryptAtRest still passes plaintext through when unavailable', S.decryptAtRest(pem) === pem);

// ── FAIL-LOUD: an encrypted value with no safeStorage MUST throw (never silently return junk) ──
let threw = false;
try { S.decryptAtRest('ENC1:AAAA'); } catch { threw = true; }
check('decryptAtRest throws on an encrypted value when safeStorage is unavailable', threw === true);

// ── FAIL-CLOSED strict (the DB-key path): unavailable ⇒ THROW, never write plaintext ──
S.__setSafeStorage(null);
let strictThrew = false;
try { S.encryptAtRestStrict('db-master-key'); } catch { strictThrew = true; }
check('encryptAtRestStrict THROWS when unavailable (never a plaintext DB key)', strictThrew === true);
S.__setSafeStorage(fakeSS);
const strictEnc = S.encryptAtRestStrict('db-master-key');
check('encryptAtRestStrict encrypts (ENC1:) when available + round-trips',
      strictEnc.startsWith('ENC1:') && S.decryptAtRest(strictEnc) === 'db-master-key');

// restore the real safeStorage source
S.__setSafeStorage(undefined);

console.log(`\nsecretStore: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
