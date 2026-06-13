#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_phase5.js
 * ---------------------------------------
 * Loop 4 / Phase 5 — hardening + host migration. Verifies:
 *   key rotation (dual-kid overlap): tokens signed by k1 AND k2 both verify while
 *     both are pinned; after retiring k1, k1 -> unknown_kid (locked_invalid),
 *     k2 -> allow.
 *   seat-refresh: a fresh seat token from validate replaces the cached one and
 *     advances grace_until (paid users refresh online; no 7-day lockout).
 *   host migration is config-only: the request URL is driven entirely by
 *     config base_url (no hardcoded host in the client).
 *
 * Run under Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_license_phase5.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const tokenLib = require('../../src/lib/license/token');
const fingerprint = require('../../src/lib/license/fingerprint');
const handler = require('../../src/modules/licensing/handler');
const licensing = require('./licensing');
const learning = require('./learning');

const ROOT = path.join(__dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'license.json'), 'utf8'));
const PID = cfg.product_id;
const FP = fingerprint.computeFpHash(PID);
const PRIV = {
  k1: crypto.createPrivateKey(fs.readFileSync(path.join(ROOT, 'licensing-backend', 'keys', 'ed25519_k1_private.pem'))),
  k2: crypto.createPrivateKey(fs.readFileSync(path.join(ROOT, 'licensing-backend', 'keys', 'ed25519_k2_private.pem'))),
};

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;
const iso = (ms) => new Date(ms).toISOString();
const b64url = (b) => Buffer.from(b).toString('base64url');
function sign(claims, kid) {
  const h = b64url(JSON.stringify({ alg: 'EdDSA', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  return h + '.' + p + '.' + b64url(crypto.sign(null, Buffer.from(h + '.' + p, 'ascii'), PRIV[kid]));
}
function trialClaims() {
  const n = Date.now();
  return { product_id: PID, subject: 'trial:' + FP, kind: 'trial', state: 'active',
    trial_start: iso(n - 864e5), trial_end: iso(n + 10 * 864e5),
    issued_at: iso(n), not_after: iso(n + 7 * 864e5), grace_until: iso(n + 7 * 864e5), nonce: 'n' };
}
function seatClaims({ issued = Date.now(), seatsUsed = 1 } = {}) {
  return { product_id: PID, subject: 'seat:s1', kind: 'seat', state: 'active', fp_hash: FP,
    entitlement_id: 'e1', seat_id: 's1', seats_total: 2, seats_used: seatsUsed, expires_at: null,
    issued_at: iso(issued), not_after: iso(issued + 7 * 864e5), grace_until: iso(issued + 7 * 864e5), nonce: 'n' };
}
const ev = (jws, publicKeys, over = {}) => tokenLib.evaluate(jws, { fpHash: FP, productId: PID, publicKeys, now: Date.now(), highWaterMark: 0, ...over });

// ── Key rotation: dual-kid overlap ─────────────────────────────────────────────
const BOTH = cfg.public_keys;                 // { k1, k2 }
const ONLY_K2 = { k2: cfg.public_keys.k2 };   // k1 retired
if (!check('config pins both k1 and k2', !!BOTH.k1 && !!BOTH.k2)) fail++;
if (!check('overlap: k1-signed token verifies', ev(sign(trialClaims(), 'k1'), BOTH).decision === 'allow')) fail++;
if (!check('overlap: k2-signed token verifies', ev(sign(trialClaims(), 'k2'), BOTH).decision === 'allow')) fail++;
if (!check('after retiring k1: k1 token -> locked_invalid', ev(sign(trialClaims(), 'k1'), ONLY_K2).decision === 'locked_invalid')) fail++;
if (!check('after retiring k1: k2 token -> allow', ev(sign(trialClaims(), 'k2'), ONLY_K2).decision === 'allow')) fail++;

(async () => {
  // ── Seat-refresh via validate ────────────────────────────────────────────────
  const db = new Database(':memory:'); runMigrations(db);
  // Seed an OLD seat token (issued ~6 days ago; grace nearly elapsed).
  const oldIssued = Date.now() - 6 * 864e5;
  licensing.cacheToken(db, { kind: 'seat', subject: 'seat:s1', jws: sign(seatClaims({ issued: oldIssued }), 'k1'),
    state: 'active', graceUntil: iso(oldIssued + 7 * 864e5) });
  const oldGrace = licensing.getActiveToken(db, FP).grace_until;

  // Backend validate returns a FRESH seat token (issued now).
  const transport = (m, u) => Promise.resolve(
    (m === 'POST' && u.endsWith('/validate'))
      ? { status: 200, body: { token: sign(seatClaims({ issued: Date.now() }), 'k1'), kind: 'seat', state: 'active', seats_total: 2, seats_used: 1, expires_at: null } }
      : { status: 200, body: { state: 'none' } });
  handler.register({ ipcMain: { handle: () => {} }, getDb: () => db, resourcePath: (...p) => path.join(ROOT, ...p), fs, logger: { warn: () => {}, err: () => {} }, licenseTransport: transport });
  learning.setSetting(db, 'license_enforcement_enabled', 'true');

  const gate = await handler.decideAccess();
  const newGrace = licensing.getActiveToken(db, FP).grace_until;
  if (!check('seat-refresh: gate ALLOWs', gate.decision === 'allow')) fail++;
  if (!check('seat-refresh: grace_until advanced after validate', newGrace > oldGrace)) fail++;

  // ── Host migration is config-only ────────────────────────────────────────────
  const { createClient } = require('../../src/lib/license/client');
  let url = null;
  const c = createClient({ baseUrl: 'https://new-host.example/v1', productId: PID, transport: (m, u) => { url = u; return Promise.resolve({ status: 200, body: {} }); } });
  await c.validate(FP, null);
  if (!check('request URL is driven entirely by config base_url', url.startsWith('https://new-host.example/v1/'))) fail++;

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
})();
