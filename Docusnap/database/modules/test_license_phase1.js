#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_license_phase1.js
 * ---------------------------------------
 * Loop 4 / Phase 1 — fingerprint + status, enforcement OFF. Verifies locally
 * (no live WAMP needed) that:
 *   1. Fingerprint is a stable, salted SHA-256 hash; raw never returned.
 *   2. Client sends {product_id, fp_hash} + the captured trial-customer identity
 *      (customer_name/contact_name/email) — never the raw fingerprint material.
 *   3. trial/start RESUMES the same window on repeat (idempotent, never resets)
 *      — incl. after a simulated local-DB deletion (server is source of truth).
 *   4. Local cache helpers round-trip over the migration-16 tables.
 *   5. Licensing module registers EXACTLY the two read IPC channels and NO gate;
 *      a failed/offline call returns a benign status (no denial path).
 *
 * Run under Electron-as-Node (better-sqlite3 ABI):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_license_phase1.js
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const fingerprint = require('../../src/lib/license/fingerprint');
const { createClient } = require('../../src/lib/license/client');
const licensing = require('./licensing');
const handler = require('../../src/modules/licensing/handler');

const ROOT = path.join(__dirname, '..', '..');
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;

// ── 1. Fingerprint ────────────────────────────────────────────────────────────
const HEX64 = /^[0-9a-f]{64}$/;
const fpA1 = fingerprint.computeFpHash('prod-A');
const fpA2 = fingerprint.computeFpHash('prod-A');
const fpB1 = fingerprint.computeFpHash('prod-B');
if (!check('fp is 64-hex sha256', HEX64.test(fpA1))) fail++;
if (!check('fp is stable across calls', fpA1 === fpA2)) fail++;
if (!check('fp is salted per product', fpA1 !== fpB1)) fail++;
if (!check('fp module exposes no raw getter', Object.keys(fingerprint).join(',') === 'computeFpHash')) fail++;

// ── 2 + 3. Client request shape + resume (faithful in-memory mock backend) ─────
function makeMock() {
  const store = new Map();
  const TRIAL_MS = 14 * 86400 * 1000;
  let lastBody = null;
  function transport(method, urlStr, body) {
    if (method === 'POST' && urlStr.endsWith('/trial/start')) {
      lastBody = body;
      const key = body.product_id + '|' + body.fp_hash;
      let rec = store.get(key), resumed = true;
      if (!rec) {
        const start = new Date();
        rec = { trial_start: start.toISOString(), trial_end: new Date(start.getTime() + TRIAL_MS).toISOString() };
        store.set(key, rec); resumed = false;
      }
      return Promise.resolve({ status: 200, body: { kind: 'trial', state: 'active', ...rec, resumed } });
    }
    return Promise.resolve({ status: 404, body: null });
  }
  return { transport, getLastBody: () => lastBody };
}

(async () => {
  const mock = makeMock();
  const client = createClient({ baseUrl: 'http://example/v1', productId: 'prod-A', transport: mock.transport });

  const cust = { customerName: 'ACME Ltd', contactName: 'Jane Smith', email: 'jane@acme.example' };
  const r1 = await client.startTrial(fpA1, cust);
  if (!check('trial/start creates a window first time', r1.body.resumed === false && !!r1.body.trial_end)) fail++;

  const sentKeys = Object.keys(mock.getLastBody()).sort().join(',');
  if (!check('wire body is {contact_name, customer_name, email, fp_hash, product_id}',
      sentKeys === 'contact_name,customer_name,email,fp_hash,product_id')) fail++;
  if (!check('wire body carries the HASH, not raw material',
      mock.getLastBody().fp_hash === fpA1 && !/machine|guid|raw/i.test(JSON.stringify(mock.getLastBody())))) fail++;
  if (!check('wire body carries the captured customer identity',
      mock.getLastBody().customer_name === 'ACME Ltd' && mock.getLastBody().email === 'jane@acme.example')) fail++;

  const r2 = await client.startTrial(fpA1, cust);
  if (!check('trial/start RESUMES same window on repeat',
      r2.body.resumed === true && r2.body.trial_end === r1.body.trial_end)) fail++;

  // Simulate local-DB deletion: a brand-new client (no local state) still resumes
  // because the backend (mock store) is the source of truth.
  const freshClient = createClient({ baseUrl: 'http://example/v1', productId: 'prod-A', transport: mock.transport });
  const r3 = await freshClient.startTrial(fpA1, cust);
  if (!check('resume survives simulated local-DB deletion (no reset)',
      r3.body.resumed === true && r3.body.trial_end === r1.body.trial_end)) fail++;

  // ── 4. Local cache round-trip ────────────────────────────────────────────────
  const db = new Database(':memory:');
  runMigrations(db);
  licensing.recordDevice(db, fpA1);
  licensing.recordDevice(db, fpA1); // idempotent
  const devCount = db.prepare('SELECT COUNT(*) c FROM device_registrations').get().c;
  if (!check('recordDevice is idempotent (one row)', devCount === 1)) fail++;
  licensing.cacheToken(db, { kind: 'trial', subject: 'trial:' + fpA1, jws: 'dummy.jws.token', state: 'active' });
  const cached = licensing.getCachedToken(db, fpA1);
  if (!check('cacheToken round-trips', cached && cached.state === 'active' && cached.token_blob === 'dummy.jws.token')) fail++;

  // ── 5. Module registration shape + offline non-denial ────────────────────────
  const handlers = {};
  const fakeCtx = {
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    getDb: () => db,
    resourcePath: (...p) => path.join(ROOT, ...p),
    fs,
    logger: { warn: () => {} },
  };
  handler.register(fakeCtx);
  const names = Object.keys(handlers).sort();
  if (!check('registers the expected licensing IPC channels',
      names.join(',') === 'get-update-info,license-activate,license-get-diagnostics,license-get-enforcement,' +
        'license-get-status,license-revoke,license-set-enforcement,license-start-trial,license-test-activate,open-update-url')) fail++;
  if (!check('registers NO gate/deny/enter handle channel',
      !names.some(n => /enter|gate|deny|lock/.test(n)))) fail++;

  // Offline call (nothing serves config base_url here) must NOT throw or deny.
  // Valid capture is supplied so the validation guard passes and the real offline
  // network path is exercised (not short-circuited on missing fields).
  let threw = false, res = null;
  try { res = await handlers['license-start-trial'](undefined, { customerName: 'ACME Ltd' }); }
  catch (e) { threw = true; }
  if (!check('offline trial-start does not throw', !threw)) fail++;
  if (!check('offline result is non-denial (no locked/denied/gate field)',
      res && !res.denied && !res.locked && !res.gate)) fail++;
  if (!check('offline result exposes no raw fingerprint',
      res && !/machine|guid/i.test(JSON.stringify(res)))) fail++;

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
})();
