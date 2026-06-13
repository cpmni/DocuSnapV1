#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_phase4.js
 * ---------------------------------------
 * Loop 4 / Phase 4 — revoke / reactivate. Verifies (transport seam; MAIN decides):
 *   client.revoke sends only {product_id, fp_hash, account_key};
 *   revoke releases the seat (seats_used drops), clears the local seat token,
 *     and mirrors license.revoked; the gate then locks (locked_needs_online);
 *   revoking an unbound device -> not_bound (+ license.revoke_failed);
 *   reactivate (activate after revoke) binds WITHOUT a new entitlement and
 *     reuses the freed seat; status surfaces seats_used/seats_total.
 *
 * Run under Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_license_phase4.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const fingerprint = require('../../src/lib/license/fingerprint');
const handler = require('../../src/modules/licensing/handler');
const licensing = require('./licensing');
const learning = require('./learning');

const ROOT = path.join(__dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'license.json'), 'utf8'));
const privKey = crypto.createPrivateKey(fs.readFileSync(path.join(ROOT, 'licensing-backend', 'keys', 'ed25519_k1_private.pem')));
const PID = cfg.product_id;
const FP = fingerprint.computeFpHash(PID);

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;
const iso = (ms) => new Date(ms).toISOString();
const b64url = (b) => Buffer.from(b).toString('base64url');
function sign(claims) {
  const h = b64url(JSON.stringify({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  return h + '.' + p + '.' + b64url(crypto.sign(null, Buffer.from(h + '.' + p, 'ascii'), privKey));
}
function seatClaims({ fp, seatId, seatsTotal, seatsUsed }) {
  const n = Date.now();
  return { product_id: PID, subject: 'seat:' + seatId, kind: 'seat', state: 'active', fp_hash: fp,
    entitlement_id: 'e1', seat_id: seatId, seats_total: seatsTotal, seats_used: seatsUsed, expires_at: null,
    issued_at: iso(n), not_after: iso(n + 7 * 864e5), grace_until: iso(n + 7 * 864e5), nonce: 'n' };
}

function backend({ seatsTotal = 2, goodKey = 'GOOD-KEY' } = {}) {
  const bindings = new Map(); const freed = []; let n = 1;
  const used = () => bindings.size;
  const R = (s, b) => Promise.resolve({ status: s, body: b });
  return (method, url, body) => {
    if (method === 'POST' && url.endsWith('/activate')) {
      if (body.account_key !== goodKey) return R(400, { error: { code: 'unknown_account' } });
      let seatId = bindings.get(body.fp_hash);
      if (!seatId) { if (used() >= seatsTotal) return R(400, { error: { code: 'seat_limit_reached' } }); seatId = freed.length ? freed.shift() : 's' + (n++); bindings.set(body.fp_hash, seatId); }
      return R(200, { token: sign(seatClaims({ fp: body.fp_hash, seatId, seatsTotal, seatsUsed: used() })), kind: 'seat', state: 'active', entitlement_id: 'e1', seat_id: seatId, seats_total: seatsTotal, seats_used: used(), expires_at: null });
    }
    if (method === 'POST' && url.endsWith('/revoke')) {
      if (body.account_key !== goodKey) return R(400, { error: { code: 'unknown_account' } });
      const seatId = bindings.get(body.fp_hash);
      if (!seatId) return R(400, { error: { code: 'not_bound' } });
      bindings.delete(body.fp_hash); freed.push(seatId);
      return R(200, { released: true, seats_total: seatsTotal, seats_used: used() });
    }
    if (method === 'GET' && url.includes('/status')) return R(200, { state: 'active' });
    return R(200, { state: 'none' }); // validate
  };
}
function makeCtx(database, transport) {
  const handlers = {};
  handler.register({ ipcMain: { handle: (nm, fn) => { handlers[nm] = fn; } }, getDb: () => database, resourcePath: (...p) => path.join(ROOT, ...p), fs, logger: { warn: () => {}, err: () => {} }, licenseTransport: transport });
  return handlers;
}
const auditCount = (db, action) => db.prepare('SELECT COUNT(*) c FROM audit_log WHERE action = ?').get(action).c;

(async () => {
  // client.revoke request shape
  const { createClient } = require('../../src/lib/license/client');
  let sent = null;
  const c = createClient({ baseUrl: 'http://x/v1', productId: PID, transport: (m, u, body) => { sent = body; return Promise.resolve({ status: 200, body: { released: true, seats_total: 1, seats_used: 0 } }); } });
  await c.revoke(FP, 'KEY');
  if (!check('revoke wire body is exactly {account_key,fp_hash,product_id}', Object.keys(sent).sort().join(',') === 'account_key,fp_hash,product_id')) fail++;

  const db = new Database(':memory:'); runMigrations(db);
  const h = makeCtx(db, backend({ seatsTotal: 2 }));

  // activate -> seat
  const a1 = await h['license-activate'](null, { accountKey: 'GOOD-KEY', deviceLabel: 'PC1' });
  if (!check('activate binds a seat', a1.ok === true && a1.kind === 'seat')) fail++;
  const entId = a1.entitlement_id, seatId1 = a1.seat_id;

  // status surfaces seats
  const st = await h['license-get-status'](null);
  if (!check('status surfaces seats_used/seats_total', st.kind === 'seat' && st.seats_total === 2 && st.seats_used === 1)) fail++;

  // gate allows on the seat
  learning.setSetting(db, 'license_enforcement_enabled', 'true');
  if (!check('gate ALLOWs on the seat', (await handler.decideAccess()).decision === 'allow')) fail++;

  // revoke -> frees the seat, clears local token, audits
  const rv = await h['license-revoke'](null, { accountKey: 'GOOD-KEY' });
  if (!check('revoke releases seat (seats_used 0)', rv.ok === true && rv.released === true && rv.seats_used === 0)) fail++;
  if (!check('local seat token cleared', !licensing.getActiveToken(db, FP))) fail++;
  if (!check('audit_log mirrors license.revoked', auditCount(db, 'license.revoked') === 1)) fail++;

  // after revoke (no seat, no trial) the gate locks
  if (!check('revoked device -> locked_needs_online', (await handler.decideAccess()).decision === 'locked_needs_online')) fail++;

  // revoking again -> not_bound (+ audit failure)
  const rv2 = await h['license-revoke'](null, { accountKey: 'GOOD-KEY' });
  if (!check('second revoke -> not_bound', rv2.ok === false && rv2.code === 'not_bound')) fail++;
  if (!check('audit_log mirrors license.revoke_failed', auditCount(db, 'license.revoke_failed') === 1)) fail++;

  // reactivate -> reuses freed seat, SAME entitlement (no new entitlement)
  const a2 = await h['license-activate'](null, { accountKey: 'GOOD-KEY', deviceLabel: 'PC1-new' });
  if (!check('reactivate binds without a new entitlement', a2.ok === true && a2.entitlement_id === entId)) fail++;
  if (!check('reactivate reuses the freed seat', a2.seat_id === seatId1)) fail++;
  if (!check('gate ALLOWs again after reactivation', (await handler.decideAccess()).decision === 'allow')) fail++;

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
})();
