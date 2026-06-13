#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_release_invalidates_cache.js
 * ---------------------------------------------------------
 * Regression for the server-side-release bypass: a seat freed on the backend
 * must lock this device on its next ONLINE check, not ride out the cached
 * token's 7-day grace.
 *
 * decideAccess() refreshes via validate(). When a seat is released server-side
 * (and there's no trial) validate() returns {state:'none'} with NO token. The
 * gate must treat a REACHABLE-but-no-grant response as authoritative and clear
 * the cached seat token. OFFLINE (no response) must still honor the cache.
 *
 * Proves:
 *   reachable + no grant  -> cached seat token CLEARED -> locked_needs_online
 *   offline   + cached    -> cache KEPT               -> allow (grace)
 *   reachable + grant     -> cache refreshed          -> allow
 *
 * Run under Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_license_release_invalidates_cache.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const fingerprint = require('../../src/lib/license/fingerprint');
const handler = require('../../src/modules/licensing/handler');
const learning = require('./learning');
const licensing = require('./licensing');

const ROOT = path.join(__dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'license.json'), 'utf8'));
const privKey = crypto.createPrivateKey(
  fs.readFileSync(path.join(ROOT, 'licensing-backend', 'keys', 'ed25519_k1_private.pem'))
);
const PID = cfg.product_id;
const FP = fingerprint.computeFpHash(PID);

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;
const iso = (ms) => new Date(ms).toISOString();
const b64url = (b) => Buffer.from(b).toString('base64url');

function sign(claims) {
  const h = b64url(JSON.stringify({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const sig = crypto.sign(null, Buffer.from(h + '.' + p, 'ascii'), privKey);
  return h + '.' + p + '.' + b64url(sig);
}
function seatClaims({ state = 'active', issued, grace } = {}) {
  const now = Date.now();
  return {
    product_id: PID, subject: 'seat:1', kind: 'seat', state, fp_hash: FP,
    entitlement_id: 1, seat_id: 1, seats_total: 2, seats_used: 1, expires_at: null,
    issued_at: iso(issued != null ? issued : now),
    not_after: iso(grace != null ? grace : now + 7 * 86400000),
    grace_until: iso(grace != null ? grace : now + 7 * 86400000),
    nonce: 'n',
  };
}
function seedSeat() {
  licensing.cacheToken(db, {
    kind: 'seat', subject: 'seat:1', jws: sign(seatClaims()), state: 'active',
    notAfter: iso(Date.now() + 7 * 86400000), graceUntil: iso(Date.now() + 7 * 86400000),
  });
}
const cached = () => !!licensing.getActiveToken(db, FP);

// validate() transport stub (the ctx.licenseTransport test seam). Mode drives the
// simulated backend reply for POST .../v1/validate.
let mode = 'none';
const licenseTransport = (method, urlStr) => {
  if (!/\/validate$/.test(String(urlStr))) return Promise.resolve({ status: 200, body: {} });
  if (mode === 'offline') return Promise.reject(new Error('ECONNREFUSED'));
  if (mode === 'grant')   return Promise.resolve({ status: 200, body: { token: sign(seatClaims()), kind: 'seat', state: 'active' } });
  return Promise.resolve({ status: 200, body: { state: 'none' } }); // released/revoked: no grant
};

const db = new Database(':memory:');
runMigrations(db);
handler.register({
  ipcMain: { handle: () => {} },
  getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p),
  licenseTransport,
  fs,
  logger: { warn: () => {}, err: () => {} },
});
learning.setSetting(db, 'license_enforcement_enabled', 'true');

(async () => {
  // 1) REACHABLE + NO GRANT -> cache cleared -> locked
  seedSeat();
  if (!check('precondition: seat token cached', cached() === true)) fail++;
  mode = 'none';
  let r = await handler.decideAccess();
  if (!check('reachable + no grant -> locked_needs_online', r.decision === 'locked_needs_online')) fail++;
  if (!check('reachable + no grant -> cached seat token CLEARED', cached() === false)) fail++;

  // 2) OFFLINE + cached -> cache kept -> allow (grace)
  seedSeat();
  mode = 'offline';
  r = await handler.decideAccess();
  if (!check('offline + cached -> allow (grace)', r.decision === 'allow')) fail++;
  if (!check('offline + cached -> cache KEPT (not cleared)', cached() === true)) fail++;

  // 3) REACHABLE + grant -> allow, cache present
  mode = 'grant';
  r = await handler.decideAccess();
  if (!check('reachable + grant -> allow', r.decision === 'allow')) fail++;
  if (!check('reachable + grant -> cache present', cached() === true)) fail++;

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
})();
