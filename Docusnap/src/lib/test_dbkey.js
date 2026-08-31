#!/usr/bin/env node
'use strict';
/**
 * Hermetic tests for lib/dbKey — the whole-DB-at-rest master-key module (2026-08-31, Oracle SIGN-OFF-
 * W/COND). DPAPI/safeStorage is unavailable under plain node, so the DPAPI wrap is exercised through an
 * INJECTED fake safeStorage; argon2 (the recovery wrap) runs for real. A scratch userData dir is used.
 *
 * Run: node src/lib/test_dbkey.js
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

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dbkey-'));
  K.__setDirForTest(d);
  return d;
}

(async () => {
  // ── provision + normal DPAPI load ──────────────────────────────────────────
  S.__setSafeStorage(fakeSS);
  let dir = freshDir();
  check('a fresh install has no key', K.hasKey() === false && K.loadKey() === null);
  const { recoveryCode, masterKey } = await K.provision({});
  check('provision returns a 32-byte master key', Buffer.isBuffer(masterKey) && masterKey.length === 32);
  check('provision writes .db-key (DPAPI, ENC1:) and .db-recovery', K.hasKey() && K.hasRecovery()
        && S.isEncrypted(fs.readFileSync(path.join(dir, K.KEY_FILE), 'utf8').trim()));
  check('the recovery code is a grouped Crockford-base32 string (5×5)', /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/.test(recoveryCode));
  check('loadKey returns the SAME master key via DPAPI', K.loadKey().equals(masterKey));

  // ── provision refuses to clobber a live key ────────────────────────────────
  let clobberThrew = false;
  try { await K.provision({}); } catch { clobberThrew = true; }
  check('provision REFUSES to overwrite an existing key', clobberThrew === true);

  // ── recovery: correct code recovers the exact key; wrong code / tamper fail closed ──
  const recovered = await K.recover(recoveryCode, { rewrapDpapi: false });
  check('the printed code recovers the EXACT master key', recovered.equals(masterKey));
  let wrongThrew = false;
  try { await K.recover('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', { rewrapDpapi: false }); } catch (e) { wrongThrew = (e.code === 'DBKEY_UNDECRYPTABLE'); }
  check('a WRONG recovery code fails closed (DBKEY_UNDECRYPTABLE)', wrongThrew === true);
  let tamperThrew = false;
  const rp = path.join(dir, K.RECOVERY_FILE);
  const blob = fs.readFileSync(rp); blob[blob.length - 1] ^= 0xff; fs.writeFileSync(rp, blob);
  try { await K.recover(recoveryCode, { rewrapDpapi: false }); } catch { tamperThrew = true; }
  check('a TAMPERED recovery blob fails closed', tamperThrew === true);

  // ── recovery on a NEW machine (no .db-key) re-wraps for DPAPI ───────────────
  dir = freshDir();
  await K.provision({});
  const origKey = K.loadKey();
  const code2 = (await K.regenerateRecovery(origKey, {})).recoveryCode;   // ceremony: new code, no old-code copy
  fs.unlinkSync(path.join(dir, K.KEY_FILE));                              // simulate DPAPI-less new profile
  check('after removing .db-key, loadKey reports absent (not undecryptable)', K.loadKey() === null && K.hasRecovery());
  const rk = await K.recover(code2, { rewrapDpapi: true });
  check('recover with the regenerated code returns the key + re-wraps .db-key for DPAPI',
        rk.equals(origKey) && K.hasKey() && K.loadKey().equals(origKey));

  // ── FAIL-CLOSED provision: DPAPI unavailable ⇒ THROW, write NO key (no plaintext leak) ─────
  dir = freshDir();
  S.__setSafeStorage(null);
  let failClosedThrew = false;
  try { await K.provision({}); } catch { failClosedThrew = true; }
  check('provision FAIL-CLOSED when DPAPI unavailable (throws, writes no key)',
        failClosedThrew === true && K.hasKey() === false);
  S.__setSafeStorage(fakeSS);

  // ── NEVER silently regenerate: a present-but-undecryptable key THROWS, not a fresh key ─────
  dir = freshDir();
  await K.provision({});
  fs.writeFileSync(path.join(dir, K.KEY_FILE), 'ENC1:not-valid-base64-dpapi-@@@', 'utf8');
  let undecThrew = false;
  try { K.loadKey(); } catch (e) { undecThrew = (e.code === 'DBKEY_UNDECRYPTABLE'); }
  check('an undecryptable present key THROWS DBKEY_UNDECRYPTABLE (never silent-regenerate)', undecThrew === true);
  check('...and the key file is NOT overwritten by loadKey', fs.readFileSync(path.join(dir, K.KEY_FILE), 'utf8').startsWith('ENC1:not-valid'));

  // ── a NON-DPAPI-wrapped (plaintext) key file is refused, not trusted ────────
  dir = freshDir();
  await K.provision({});
  fs.writeFileSync(path.join(dir, K.KEY_FILE), Buffer.alloc(32, 7).toString('base64'), 'utf8');   // no ENC1:
  let plainRefused = false;
  try { K.loadKey(); } catch (e) { plainRefused = (e.code === 'DBKEY_UNDECRYPTABLE'); }
  check('a plaintext (non-ENC1:) key file is REFUSED', plainRefused === true);

  // ── 32-byte assertion on the recovery unwrap ───────────────────────────────
  check('REC_LEN is the fixed container size (magic+ver+salt+iv+tag+32 = 81)', K.REC_LEN === 4 + 1 + 16 + 12 + 16 + 32);

  // ── normaliseCode maps look-alikes so a hand-typed code still recovers ──────
  dir = freshDir();
  const { recoveryCode: rc3, masterKey: mk3 } = await K.provision({});
  const messy = rc3.toLowerCase().replace(/-/g, ' ');   // lowercase + spaces instead of dashes
  const rk3 = await K.recover(messy, { rewrapDpapi: false });
  check('a case/spacing-mangled code still recovers (normaliseCode)', rk3.equals(mk3));

  S.__setSafeStorage(undefined);
  console.log(`\ndbKey: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
