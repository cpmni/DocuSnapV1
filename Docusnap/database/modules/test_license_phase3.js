#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_phase3.js
 * ---------------------------------------
 * Loop 4 / Phase 3 — paid activation + seat binding. Verifies:
 *   token/state: seat token verifies (fp + product bound), fp-mismatch ->
 *     locked_invalid, expired seat -> locked; offline grace unchanged.
 *   getActiveToken: a bound seat token takes precedence over the trial token.
 *   client.activate: sends only {product_id, fp_hash, account_key, device_label}.
 *   handler license-activate (via transport seam, MAIN decides):
 *     valid key -> ok + seat cached + used by the gate; invalid key -> rejected;
 *     seat-limit -> blocked; re-activate same fp -> idempotent (same seat);
 *     audit_log mirrors success AND failure.
 *
 * Run under Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_license_phase3.js
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
const privKey = crypto.createPrivateKey(fs.readFileSync(path.join(ROOT, 'licensing-backend', 'keys', 'ed25519_k1_private.pem')));
const PID = cfg.product_id;
const FP = fingerprint.computeFpHash(PID);
const PUB = cfg.public_keys;

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;
const iso = (ms) => new Date(ms).toISOString();
const b64url = (b) => Buffer.from(b).toString('base64url');

function sign(claims, kid = 'k1') {
  const h = b64url(JSON.stringify({ alg: 'EdDSA', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const sig = crypto.sign(null, Buffer.from(h + '.' + p, 'ascii'), privKey);
  return h + '.' + p + '.' + b64url(sig);
}
function seatClaims({ fp = FP, seatId = 's1', seatsTotal = 2, seatsUsed = 1, expires = null, productId = PID, state = 'active' } = {}) {
  const now = Date.now();
  return {
    product_id: productId, subject: 'seat:' + seatId, kind: 'seat', state, fp_hash: fp,
    entitlement_id: 'e1', seat_id: seatId, seats_total: seatsTotal, seats_used: seatsUsed,
    expires_at: expires != null ? iso(expires) : null,
    issued_at: iso(now), not_after: iso(now + 7 * 864e5), grace_until: iso(now + 7 * 864e5), nonce: 'n',
  };
}
const ev = (jws, over = {}) => tokenLib.evaluate(jws, { fpHash: FP, productId: PID, publicKeys: PUB, now: Date.now(), highWaterMark: 0, ...over });

// ── token/state: seat tokens ──────────────────────────────────────────────────
if (!check('valid seat token -> allow', ev(sign(seatClaims())).decision === 'allow')) fail++;
if (!check('seat fp mismatch -> locked_invalid', ev(sign(seatClaims({ fp: 'a'.repeat(64) }))).decision === 'locked_invalid')) fail++;
if (!check('seat product mismatch -> locked_invalid', ev(sign(seatClaims({ productId: 'other' }))).decision === 'locked_invalid')) fail++;
if (!check('expired seat (expires_at past) -> locked', ev(sign(seatClaims({ expires: Date.now() - 1000 }))).decision === 'locked')) fail++;

// ── getActiveToken precedence: seat > trial ────────────────────────────────────
const db = new Database(':memory:');
runMigrations(db);
function trialJws(state = 'active') {
  const now = Date.now();
  return sign({ product_id: PID, subject: 'trial:' + FP, kind: 'trial', state,
    trial_start: iso(now - 864e5), trial_end: iso(now + 10 * 864e5),
    issued_at: iso(now), not_after: iso(now + 7 * 864e5), grace_until: iso(now + 7 * 864e5), nonce: 'n' });
}
licensing.cacheToken(db, { kind: 'trial', subject: 'trial:' + FP, jws: trialJws(), state: 'active' });
licensing.cacheToken(db, { kind: 'seat', subject: 'seat:s1', jws: sign(seatClaims()), state: 'active' });
if (!check('getActiveToken prefers the bound seat token',
    (() => { const r = licensing.getActiveToken(db, FP); const c = JSON.parse(Buffer.from(r.token_blob.split('.')[1], 'base64url')); return c.kind === 'seat'; })())) fail++;

// ── client.activate request shape ──────────────────────────────────────────────
(async () => {
  const { createClient } = require('../../src/lib/license/client');
  let sent = null;
  const c = createClient({ baseUrl: 'http://x/v1', productId: PID, transport: (m, u, body) => { sent = body; return Promise.resolve({ status: 200, body: { token: sign(seatClaims()), kind: 'seat', seat_id: 's1', seats_total: 2, seats_used: 1 } }); } });
  await c.activate(FP, 'KEY', 'PC1');
  if (!check('activate wire body is exactly {account_key,device_label,fp_hash,product_id}',
      Object.keys(sent).sort().join(',') === 'account_key,device_label,fp_hash,product_id')) fail++;
  if (!check('activate sends fp HASH, not raw', sent.fp_hash === FP && !/machine|guid/i.test(JSON.stringify(sent)))) fail++;

  // ── handler license-activate (transport seam; MAIN decides) ──────────────────
  function seatBackend({ seatsTotal = 2, goodKey = 'GOOD-KEY' } = {}) {
    const bindings = new Map(); let n = 1;
    return (method, url, body) => {
      if (method === 'POST' && url.endsWith('/activate')) {
        if (body.account_key !== goodKey) return Promise.resolve({ status: 400, body: { error: { code: 'unknown_account' } } });
        let seatId = bindings.get(body.fp_hash);
        if (!seatId) { if (bindings.size >= seatsTotal) return Promise.resolve({ status: 400, body: { error: { code: 'seat_limit_reached' } } }); seatId = 's' + (n++); bindings.set(body.fp_hash, seatId); }
        const used = bindings.size;
        return Promise.resolve({ status: 200, body: { token: sign(seatClaims({ fp: body.fp_hash, seatId, seatsTotal, seatsUsed: used })), kind: 'seat', state: 'active', entitlement_id: 'e1', seat_id: seatId, seats_total: seatsTotal, seats_used: used, expires_at: null } });
      }
      return Promise.resolve({ status: 200, body: { state: 'none' } }); // gate's validate
    };
  }
  function makeCtx(database, transport) {
    const handlers = {};
    handler.register({ ipcMain: { handle: (nm, fn) => { handlers[nm] = fn; } }, getDb: () => database, resourcePath: (...p) => path.join(ROOT, ...p), fs, logger: { warn: () => {}, err: () => {} }, licenseTransport: transport });
    return handlers;
  }
  const auditCount = (database, action) => database.prepare('SELECT COUNT(*) c FROM audit_log WHERE action = ?').get(action).c;

  // success
  const dbA = new Database(':memory:'); runMigrations(dbA);
  const hA = makeCtx(dbA, seatBackend());
  // NB: ipcMain.handle passes (event, data) — mirror that with a leading arg.
  const r1 = await hA['license-activate'](null, { accountKey: 'GOOD-KEY', deviceLabel: 'PC1' });
  if (!check('valid activation -> ok seat', r1.ok === true && r1.kind === 'seat' && !!r1.seat_id)) fail++;
  if (!check('activation result has no raw token/fingerprint', !r1.token && !/machine|guid/i.test(JSON.stringify(r1)))) fail++;
  if (!check('seat token cached for the gate', (() => { const t = licensing.getActiveToken(dbA, FP); return t && JSON.parse(Buffer.from(t.token_blob.split('.')[1], 'base64url')).kind === 'seat'; })())) fail++;
  if (!check('audit_log mirrors license.activated', auditCount(dbA, 'license.activated') === 1)) fail++;

  // seat token used by the Phase 2 gate
  learning.setSetting(dbA, 'license_enforcement_enabled', 'true');
  const gate = await handler.decideAccess();
  if (!check('gate ALLOWs on the cached seat token', gate.decision === 'allow')) fail++;

  // idempotent re-activate (same fp)
  const r2 = await hA['license-activate'](null, { accountKey: 'GOOD-KEY' });
  if (!check('re-activate same fp is idempotent (same seat)', r2.ok === true && r2.seat_id === r1.seat_id)) fail++;

  // invalid key
  const r3 = await hA['license-activate'](null, { accountKey: 'WRONG' });
  if (!check('invalid key -> rejected (unknown_account)', r3.ok === false && r3.code === 'unknown_account')) fail++;
  if (!check('audit_log mirrors license.activate_failed', auditCount(dbA, 'license.activate_failed') >= 1)) fail++;

  // seat-limit exhaustion (backend reports full)
  const dbB = new Database(':memory:'); runMigrations(dbB);
  const hB = makeCtx(dbB, (m, u, body) => Promise.resolve(m === 'POST' && u.endsWith('/activate') ? { status: 400, body: { error: { code: 'seat_limit_reached' } } } : { status: 200, body: { state: 'none' } }));
  const r4 = await hB['license-activate'](null, { accountKey: 'GOOD-KEY' });
  if (!check('seat-limit -> blocked with clear code', r4.ok === false && r4.code === 'seat_limit_reached')) fail++;

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
})();
