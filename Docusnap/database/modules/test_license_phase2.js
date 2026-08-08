#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_phase2.js
 * ---------------------------------------
 * Loop 4 / Phase 2 — verify + gate. Signs JWS in Node with the Phase 0 private
 * key and verifies with token.js against the config public key (same keypair the
 * PHP backend will use). Verifies:
 *   token.evaluate: valid->allow, expired->locked, past-grace->needs_online,
 *     tampered/alg-confusion/unknown-kid/product-mismatch/fp-mismatch->locked_invalid,
 *     clock-rollback defeated by the high-water mark.
 *   decideAccess gate (enforcement is ALWAYS ON): no token -> needs_online; valid
 *     -> allow; expired -> locked; tampered -> locked_invalid.
 *   main.js wiring: license-enter-app re-decides via enterMainApp (no self-grant).
 *
 * Run under Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_license_phase2.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const tokenLib = require('../../src/lib/license/token');
const fingerprint = require('../../src/lib/license/fingerprint');
const handler = require('../../src/modules/licensing/handler');
const learning = require('./learning');

const ROOT = path.join(__dirname, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'license.json'), 'utf8'));
const privKey = crypto.createPrivateKey(
  fs.readFileSync(path.join(ROOT, 'licensing-backend', 'keys', 'ed25519_k1_private.pem'))
);
const PID = cfg.product_id;
const FP = fingerprint.computeFpHash(PID);
const PUB = cfg.public_keys;

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;
const iso = (ms) => new Date(ms).toISOString();
const b64url = (b) => Buffer.from(b).toString('base64url');

function sign(claims, { kid = 'k1', header = null } = {}) {
  const h = b64url(JSON.stringify(header || { alg: 'EdDSA', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const sig = crypto.sign(null, Buffer.from(h + '.' + p, 'ascii'), privKey);
  return h + '.' + p + '.' + b64url(sig);
}
function trialClaims({ state = 'active', issued, grace, end, productId = PID, subject = 'trial:' + FP } = {}) {
  const now = Date.now();
  return {
    product_id: productId, subject, kind: 'trial', state,
    trial_start: iso(now - 86400000),
    trial_end: iso(end != null ? end : now + 10 * 86400000),
    issued_at: iso(issued != null ? issued : now),
    not_after: iso(grace != null ? grace : now + 7 * 86400000),
    grace_until: iso(grace != null ? grace : now + 7 * 86400000),
    nonce: 'n',
  };
}
const ev = (jws, over = {}) => tokenLib.evaluate(jws, {
  fpHash: FP, productId: PID, publicKeys: PUB, now: Date.now(), highWaterMark: 0, ...over,
});

// ── token.evaluate ──────────────────────────────────────────────────────────
const now = Date.now();
if (!check('valid active -> allow', ev(sign(trialClaims())).decision === 'allow')) fail++;
if (!check('state expired -> locked', ev(sign(trialClaims({ state: 'expired' }))).decision === 'locked')) fail++;
if (!check('trial_end past -> locked(expired)', (() => { const r = ev(sign(trialClaims({ end: now - 1000 }))); return r.decision === 'locked' && r.reason === 'expired'; })())) fail++;
if (!check('past grace -> locked_needs_online',
    ev(sign(trialClaims({ issued: now - 8 * 86400000, grace: now - 86400000 }))).decision === 'locked_needs_online')) fail++;

// tampered signature — flip the FIRST signature char (always meaningful bits;
// flipping the LAST char can hit ignored padding bits and not change the bytes).
function tamper(jws) { const p = jws.split('.'); const s = p[2]; p[2] = (s[0] === 'A' ? 'B' : 'A') + s.slice(1); return p.join('.'); }
if (!check('tampered signature -> locked_invalid', ev(tamper(sign(trialClaims()))).decision === 'locked_invalid')) fail++;
// alg confusion
if (!check('alg confusion (none) -> locked_invalid',
    ev(sign(trialClaims(), { header: { alg: 'none', kid: 'k1', typ: 'JWT' } })).decision === 'locked_invalid')) fail++;
// unknown kid
if (!check('unknown kid -> locked_invalid', ev(sign(trialClaims(), { kid: 'kX' })).decision === 'locked_invalid')) fail++;
// product / fp mismatch
if (!check('product mismatch -> locked_invalid', ev(sign(trialClaims({ productId: 'other' }))).decision === 'locked_invalid')) fail++;
if (!check('fp mismatch -> locked_invalid', ev(sign(trialClaims({ subject: 'trial:' + 'f'.repeat(64) }))).decision === 'locked_invalid')) fail++;

// clock rollback: stale token; rolled-back clock must NOT extend grace
const stale = sign(trialClaims({ issued: now - 8 * 86400000, grace: now - 86400000 }));
if (!check('rollback w/o hwm would allow (control)', ev(stale, { now: 0, highWaterMark: 0 }).decision === 'allow')) fail++;
if (!check('rollback defeated by high-water mark', ev(stale, { now: 0, highWaterMark: now }).decision === 'locked_needs_online')) fail++;

// ── decideAccess gate ─────────────────────────────────────────────────────────
const db = new Database(':memory:');
runMigrations(db);
const ctx = {
  ipcMain: { handle: () => {} },
  getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p),
  // Hermetic: force the online refresh to fail so the gate evaluates the SEEDED
  // cached token only (no dependency on a real/reachable backend at cfg.base_url).
  licenseTransport: () => Promise.reject(new Error('test-offline')),
  fs,
  logger: { warn: () => {}, err: () => {} },
};
handler.register(ctx);
const licensing = require('./licensing');
const seed = (jws, state) => licensing.cacheToken(db, { kind: 'trial', subject: 'trial:' + FP, jws, state });

(async () => {
  // Enforcement is ALWAYS ON now (no off path) — with no cached token the gate
  // locks regardless of any setting. (The setSetting below is therefore inert; it
  // is kept only to show the setting can no longer relax enforcement.)
  let r = await handler.decideAccess();
  if (!check('always-on: no token -> locked_needs_online', r.decision === 'locked_needs_online' && r.enforcement === true)) fail++;

  learning.setSetting(db, 'license_enforcement_enabled', 'true');

  // ON + no cached token
  r = await handler.decideAccess();
  if (!check('ON + no token -> locked_needs_online', r.decision === 'locked_needs_online')) fail++;

  // ON + valid token
  seed(sign(trialClaims()), 'active');
  r = await handler.decideAccess();
  if (!check('ON + valid token -> allow', r.decision === 'allow' && r.enforcement === true)) fail++;

  // ON + expired token
  seed(sign(trialClaims({ state: 'expired' })), 'expired');
  r = await handler.decideAccess();
  if (!check('ON + expired token -> locked', r.decision === 'locked')) fail++;

  // ON + tampered token
  seed(tamper(sign(trialClaims())), 'active');
  r = await handler.decideAccess();
  if (!check('ON + tampered token -> locked_invalid', r.decision === 'locked_invalid')) fail++;

  // ── main.js wiring (renderer cannot self-grant) ──────────────────────────────
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  // The handler was hardened (Stage 2 — M2): it now SENDER-scopes the signal to the licence
  // window and requires an authenticated session before re-deciding, so the regex pins that
  // hardened shape — the anti-self-grant sender guard AND the enterMainApp re-decide — rather
  // than the old bare `() => enterMainApp()` form (which this scrape used to expect).
  if (!check('license-enter-app re-decides via enterMainApp (sender-guarded, no self-grant)',
      /ipcMain\.on\('license-enter-app',[\s\S]*?BrowserWindow\.fromWebContents\(e\.sender\)[\s\S]*?enterMainApp\(\)/.test(mainSrc))) fail++;
  if (!check('enterMainApp gates on decideAccess before openMainShell',
      /licensingModule\.decideAccess\(\)/.test(mainSrc) && /gate\.decision === 'allow'/.test(mainSrc))) fail++;
  if (!check('openMainShell not wired directly to a renderer enter signal',
      !/ipcMain\.on\([^)]*=>\s*openMainShell\(\)/.test(mainSrc))) fail++;

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
})();
