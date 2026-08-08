#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_pinned_keys.js
 * --------------------------------------------
 * SEC — offline forge hardening. The offline licence gate verifies token signatures against a
 * PINNED public-key map. Those keys used to come solely from config/license.json, which ships as a
 * LOOSE, user-editable file (electron-builder extraResources). An attacker could swap in their own
 * public key and sign a valid token offline. The fix bakes the keys into src/lib/license/pinnedKeys.js
 * (inside the asar) and makes the config loader use those.
 *
 * Pins:
 *   A. ROTATION GUARD — the baked keys are IDENTICAL to config/license.json (public_keys + active_kid),
 *      so a legitimate install is byte-identical and a key rotation MUST update both.
 *   B. LEGIT — a token signed by the REAL k1 private key verifies against the baked keys.
 *   C. ATTACK DEFEATED — a token signed by a FOREIGN key (kid k1) is REJECTED under the baked keys…
 *   D. …but WOULD be accepted if the key map were swapped to the foreign key (proving the loose file
 *      was the hole and that pinning the keys is what closes it — the red-vs-green control).
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_license_pinned_keys.js
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const ROOT   = path.join(__dirname, '..', '..');
const tokenLib    = require(path.join(ROOT, 'src', 'lib', 'license', 'token'));
const fingerprint = require(path.join(ROOT, 'src', 'lib', 'license', 'fingerprint'));
const pinned      = require(path.join(ROOT, 'src', 'lib', 'license', 'pinnedKeys'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'license.json'), 'utf8'));

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;

const PID = cfg.product_id;
const FP  = fingerprint.computeFpHash(PID);
const iso = (ms) => new Date(ms).toISOString();
const b64url = (b) => Buffer.from(b).toString('base64url');

function trialClaims() {
  const now = Date.now();
  return {
    product_id: PID, subject: 'trial:' + FP, kind: 'trial', state: 'active',
    trial_start: iso(now - 86400000), trial_end: iso(now + 10 * 86400000),
    issued_at: iso(now), not_after: iso(now + 7 * 86400000), grace_until: iso(now + 7 * 86400000), nonce: 'n',
  };
}
function sign(privKey, claims, kid = 'k1') {
  const h = b64url(JSON.stringify({ alg: 'EdDSA', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const sig = crypto.sign(null, Buffer.from(h + '.' + p, 'ascii'), privKey);
  return h + '.' + p + '.' + b64url(sig);
}
const ev = (jws, publicKeys) => tokenLib.evaluate(jws, { fpHash: FP, productId: PID, publicKeys, now: Date.now(), highWaterMark: 0 });

// ── A. rotation guard: baked === shipped config ───────────────────────────────
fail += !check('baked PINNED_PUBLIC_KEYS === config.public_keys',
  JSON.stringify(pinned.PINNED_PUBLIC_KEYS) === JSON.stringify(cfg.public_keys));
fail += !check('baked PINNED_ACTIVE_KID === config.active_kid', pinned.PINNED_ACTIVE_KID === cfg.active_kid);

// ── B. a REAL-key-signed token verifies against the baked keys ────────────────
const realPriv = crypto.createPrivateKey(fs.readFileSync(path.join(ROOT, 'licensing-backend', 'keys', 'ed25519_k1_private.pem')));
fail += !check('legit token (real k1) allowed under BAKED keys',
  ev(sign(realPriv, trialClaims()), pinned.PINNED_PUBLIC_KEYS).decision === 'allow');

// ── C/D. attacker swaps k1 for their own key ──────────────────────────────────
const foreign = crypto.generateKeyPairSync('ed25519');
const foreignEntry = { alg: 'EdDSA', format: 'spki-der-b64',
  key: foreign.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
const foreignToken = sign(foreign.privateKey, trialClaims(), 'k1');

fail += !check('C: FOREIGN-signed token REJECTED under baked keys (attack defeated)',
  ev(foreignToken, pinned.PINNED_PUBLIC_KEYS).decision === 'locked_invalid');
fail += !check('D: same token WOULD be allowed if keys were swapped (loose-file hole, control)',
  ev(foreignToken, { k1: foreignEntry }).decision === 'allow');

console.log(fail ? `\n${fail} FAILED` : '\nAll pinned-key hardening checks passed');
process.exit(fail ? 1 : 0);
