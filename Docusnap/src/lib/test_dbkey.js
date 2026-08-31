#!/usr/bin/env node
'use strict';
/**
 * Hermetic tests for lib/dbKey — the code-as-passphrase recovery-code module (Oracle SIGN-OFF-W/COND
 * 2026-08-31). DPAPI is exercised through an INJECTED fake safeStorage; a pragma-recording stub tests
 * the applyKey/applyRekey sequence without the native module. Run: node src/lib/test_dbkey.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./secretStore');
const K = require('./dbKey');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) { pass++; console.log('  OK  ' + label); } else { fail++; console.error('  FAIL: ' + label); } };

const fakeSS = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('DPAPI:' + String(s), 'utf8'),      // reversible, machine-agnostic fake
  decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^DPAPI:/, ''),
};
function freshDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dbkey-')); K.__setDirForTest(d); return d; }

// ── provision + the CONVERGENCE property (Oracle C6) ──────────────────────────
S.__setSafeStorage(fakeSS);
let dir = freshDir();
check('a fresh install has no key cache', K.hasKey() === false && K.loadCode() === null);
const { recoveryCode } = K.provision();
check('provision returns a grouped display code (5×5 Crockford)', /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/.test(recoveryCode));
check('provision wrote .db-key DPAPI-wrapped (ENC1:)', K.hasKey()
      && S.isEncrypted(fs.readFileSync(path.join(dir, K.KEY_FILE), 'utf8').trim()));
check('CONVERGENCE: loadCode() == normaliseCode(displayCode) (no display/normalised drift)',
      K.loadCode() === K.normaliseCode(recoveryCode));
check('the cached code is a valid normalised code (^[0-9A-Z]{20,}$)', K.isValidNormalised(K.loadCode()));

// ── provision refuses to clobber a live cache ─────────────────────────────────
let clobber = false; try { K.provision(); } catch { clobber = true; }
check('provision REFUSES to overwrite an existing key cache', clobber === true);

// ── normaliseCode: idempotent + folds look-alikes + strips separators ─────────
check('normaliseCode folds O→0 / I,L→1 / U→V, uppercases, strips spaces+dashes',
      K.normaliseCode('o i l u-ab cd') === '011VABCD');
check('normaliseCode is IDEMPOTENT', K.normaliseCode(K.normaliseCode(recoveryCode)) === K.normaliseCode(recoveryCode));
check('isValidNormalised rejects empty / lowercase / too-short', !K.isValidNormalised('') && !K.isValidNormalised('abc') && !K.isValidNormalised('ABC'));

// ── applyKey / applyRekey: pragma order + validation (pragma-recording stub) ──
function stub() { const calls = []; return { calls, pragma: (s) => calls.push(String(s).replace(/\s+/g, ' ').trim()) }; }
{
  const d = stub(); K.applyKey(d, recoveryCode);
  check('applyKey issues cipher → kdf_iter → key, in order, normalised',
        d.calls.length === 3 && d.calls[0] === `cipher = '${K.CIPHER}'` && d.calls[1] === `kdf_iter = ${K.KDF_ITER}`
        && d.calls[2] === `key = '${K.normaliseCode(recoveryCode)}'`);
}
{
  const d = stub(); K.applyRekey(d, recoveryCode);
  check('applyRekey issues cipher → kdf_iter → rekey, normalised',
        d.calls[0] === `cipher = '${K.CIPHER}'` && d.calls[2] === `rekey = '${K.normaliseCode(recoveryCode)}'`);
}
{
  let bad = false; try { K.applyKey(stub(), 'nope!'); } catch { bad = true; }
  check('applyKey REFUSES an invalid code (never interpolates junk into a PRAGMA)', bad === true);
}

// ── FAIL-CLOSED provision: DPAPI unavailable ⇒ THROW, write NO cache ──────────
dir = freshDir();
S.__setSafeStorage(null);
let failClosed = false; try { K.provision(); } catch { failClosed = true; }
check('provision FAIL-CLOSED when DPAPI unavailable (throws, writes no cache)', failClosed === true && K.hasKey() === false);
S.__setSafeStorage(fakeSS);

// ── NEVER silently regenerate: a present-but-undecryptable cache THROWS ────────
dir = freshDir();
K.provision();
fs.writeFileSync(path.join(dir, K.KEY_FILE), 'ENC1:not-decryptable-@@@', 'utf8');
let undec = false; try { K.loadCode(); } catch (e) { undec = (e.code === 'DBKEY_UNDECRYPTABLE'); }
check('an undecryptable cache THROWS DBKEY_UNDECRYPTABLE (never silent-regenerate)', undec === true);

// ── a NON-DPAPI-wrapped (plaintext) cache is refused, not trusted ─────────────
dir = freshDir();
fs.writeFileSync(path.join(dir, K.KEY_FILE), 'PLAINTEXTCODE1234567890', 'utf8');   // no ENC1:
let plainRefused = false; try { K.loadCode(); } catch (e) { plainRefused = (e.code === 'DBKEY_UNDECRYPTABLE'); }
check('a plaintext (non-ENC1:) cache is REFUSED', plainRefused === true);

// ── cacheCode round-trip (used on new-PC recover after a successful open) ─────
dir = freshDir();
K.cacheCode('abcde-fghjk-mnpqr-stvwx-yz234');
check('cacheCode then loadCode returns the normalised code', K.loadCode() === K.normaliseCode('abcde-fghjk-mnpqr-stvwx-yz234'));

S.__setSafeStorage(undefined);
console.log(`\ndbKey: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
