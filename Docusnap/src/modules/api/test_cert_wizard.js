#!/usr/bin/env node
'use strict';

/**
 * Hermetic tests for the Certificate Wizard orchestration (handler.ensureManagedCert
 * / managedCertStatus). In-memory SQLite + a temp certs dir; no server, no network.
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/api/test_cert_wizard.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { X509Certificate } = require('crypto');
const Database = require('better-sqlite3');
const api = require('./handler');
const learning = require('../../../database/modules/learning');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + label); } };

function makeDb(host, port) {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  if (host) learning.setSetting(db, 'client_api_host', host);
  learning.setSetting(db, 'client_api_port', String(port || 8766));
  return db;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-wiz-'));

// ── LAN host → wizard generates a managed cert and points the settings at it ────
const dbLan = makeDb('0.0.0.0');
const ctx = { getDb: () => dbLan, fs, certsDir: path.join(tmp, 'lan'), logger: { log() {}, warn() {} } };
const r1 = api.ensureManagedCert(ctx);
check('LAN: managed + generated', r1.managed === true && r1.regenerated === true);
check('LAN: tls_cert setting points at server.crt', learning.getSetting(dbLan, 'client_api_tls_cert') === path.join(tmp, 'lan', 'server.crt'));
check('LAN: tls_key setting points at server.key', learning.getSetting(dbLan, 'client_api_tls_key') === path.join(tmp, 'lan', 'server.key'));
check('LAN: ca fingerprint persisted', !!learning.getSetting(dbLan, 'client_api_ca_fingerprint'));
check('LAN: SANs persisted', (learning.getSetting(dbLan, 'client_api_cert_sans') || '').length > 0);
check('LAN: cert files exist', fs.existsSync(path.join(tmp, 'lan', 'server.crt')) && fs.existsSync(path.join(tmp, 'lan', 'ca.crt')));

const srvX = new X509Certificate(fs.readFileSync(path.join(tmp, 'lan', 'server.crt'), 'utf8'));
const caX  = new X509Certificate(fs.readFileSync(path.join(tmp, 'lan', 'ca.crt'), 'utf8'));
check('LAN: server cert signed by managed CA', srvX.verify(caX.publicKey) === true);

// ── idempotent: a covering cert already exists → no regen, no CA churn ──────────
const fpBefore = learning.getSetting(dbLan, 'client_api_ca_fingerprint');
const r2 = api.ensureManagedCert(ctx);
check('idempotent: not regenerated when cert already covers', r2.managed === true && r2.regenerated === false);
check('idempotent: CA fingerprint unchanged', learning.getSetting(dbLan, 'client_api_ca_fingerprint') === fpBefore);

// ── status reflects the managed cert ───────────────────────────────────────────
const st = api.managedCertStatus(ctx);
check('status: hasCert + valid', st.hasCert === true && st.valid === true);
check('status: caFingerprint surfaced', !!st.caFingerprint && st.caFingerprint === fpBefore);

// ── loopback host → wizard is a no-op (no cert, no settings) ────────────────────
const dbLoop = makeDb('127.0.0.1');
const ctx2 = { getDb: () => dbLoop, fs, certsDir: path.join(tmp, 'loop'), logger: { log() {}, warn() {} } };
const r3 = api.ensureManagedCert(ctx2);
check('loopback: not managed (reason loopback)', r3.managed === false && r3.reason === 'loopback');
check('loopback: no cert written', !fs.existsSync(path.join(tmp, 'loop', 'server.crt')));
check('loopback: no tls setting written', !learning.getSetting(dbLoop, 'client_api_tls_cert'));

// ── force re-issue keeps the CA (clients stay trusted) ─────────────────────────
const r4 = api.ensureManagedCert(ctx, { force: true });
check('force: regenerated', r4.regenerated === true);
check('force: CA fingerprint unchanged (reused)', r4.caFingerprint === fpBefore);

// ── respects an admin's own (Advanced) cert outside the managed dir ─────────────
const dbMan = makeDb('0.0.0.0');
fs.mkdirSync(path.join(tmp, 'manual'), { recursive: true });
const manualCrt = path.join(tmp, 'manual', 'server.crt');
fs.copyFileSync(path.join(tmp, 'lan', 'server.crt'), manualCrt); // any existing cert outside certsDir
learning.setSetting(dbMan, 'client_api_tls_cert', manualCrt);
const ctxMan = { getDb: () => dbMan, fs, certsDir: path.join(tmp, 'man-certs'), logger: { log() {}, warn() {} } };
const rm = api.ensureManagedCert(ctxMan);
check('manual cert respected on auto-run (not overridden)', rm.managed === false && rm.reason === 'manual');
check('manual: no managed cert generated', !fs.existsSync(path.join(tmp, 'man-certs', 'server.crt')));
const rmf = api.ensureManagedCert(ctxMan, { force: true });
check('explicit Generate (force) overrides manual → managed', rmf.managed === true && rmf.regenerated === true);
check('force: settings now point at managed cert', learning.getSetting(dbMan, 'client_api_tls_cert') === path.join(tmp, 'man-certs', 'server.crt'));

// ── connection profile (Stage C) ───────────────────────────────────────────────
const prof = api.buildConnectionProfile(ctx); // ctx → certsDir tmp/lan (managed CA present)
check('profile: ok', prof.ok === true);
check('profile: v=1, tls true, port carried', prof.profile.v === 1 && prof.profile.tls === true && prof.profile.port === 8766);
check('profile: host is a real address (not 0.0.0.0)', !!prof.profile.host && prof.profile.host !== '0.0.0.0');
check('profile: caPem parses as a cert', (() => { try { new X509Certificate(prof.profile.caPem); return true; } catch { return false; } })());
check('profile: fingerprint matches the CA', prof.profile.caFingerprintSha256 === new X509Certificate(fs.readFileSync(path.join(tmp, 'lan', 'ca.crt'), 'utf8')).fingerprint256);

const dbNo = makeDb('0.0.0.0');
const ctxNo = { getDb: () => dbNo, fs, certsDir: path.join(tmp, 'empty'), logger: { log() {}, warn() {} } };
check('profile: no managed CA → error', api.buildConnectionProfile(ctxNo).error === 'no_managed_ca');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\ncert wizard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
