#!/usr/bin/env node
'use strict';

/**
 * Hermetic tests for certService (no server, no network).
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/services/test_certservice.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { X509Certificate } = require('crypto');
const cs = require('./certService');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + label); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-certsvc-'));

// ── 1. generate + structural validity ──────────────────────────────────────────
const r = cs.generateServerCerts({ certsDir: tmp, sans: ['192.168.5.10', 'sf.acme.local'], days: 825 });
check('all four files written', ['caCrtPath', 'caKeyPath', 'serverCrtPath', 'serverKeyPath'].every(k => fs.existsSync(r[k])));

const caPem  = fs.readFileSync(r.caCrtPath, 'utf8');
const srvPem = fs.readFileSync(r.serverCrtPath, 'utf8');
const caX  = new X509Certificate(caPem);
const srvX = new X509Certificate(srvPem);

check('CA is a CA (basicConstraints)', caX.ca === true);
check('server is signed by the CA', srvX.verify(caX.publicKey) === true);          // the "lone self-signed leaf" regression guard
check('server SAN includes the IP', /IP Address:192\.168\.5\.10/.test(srvX.subjectAltName || ''));
check('server SAN includes the DNS name', /DNS:sf\.acme\.local/.test(srvX.subjectAltName || ''));
check('returned fingerprint matches the cert', r.caFingerprintSha256 === caX.fingerprint256);

const now = new Date();
check('validFrom is backdated (clock skew)', new Date(srvX.validFrom).getTime() < now.getTime());
const daysOut = (new Date(srvX.validTo).getTime() - now.getTime()) / 864e5;
check('validTo ~= now + 825d', daysOut > 800 && daysOut < 830);

// ── 2. rotation: reuse CA, add a new IP ────────────────────────────────────────
const r2 = cs.generateServerCerts({ certsDir: tmp, sans: ['192.168.5.10', '10.0.0.9'], days: 825, reuseCa: true });
check('CA reused on re-issue', r2.caReused === true);
check('CA fingerprint UNCHANGED across rotate (clients stay trusted)', r2.caFingerprintSha256 === r.caFingerprintSha256);
const srv2 = new X509Certificate(fs.readFileSync(r2.serverCrtPath, 'utf8'));
check('new IP appears in rotated server SAN', /IP Address:10\.0\.0\.9/.test(srv2.subjectAltName || ''));
check('server serial changed on rotate', srv2.serialNumber !== srvX.serialNumber);
check('rotated server still signed by same CA', srv2.verify(caX.publicKey) === true);

// ── 3. certCoversAddresses (rotation decision) ─────────────────────────────────
const cov1 = cs.certCoversAddresses({ serverCrtPath: r2.serverCrtPath, addresses: ['192.168.5.10', '10.0.0.9'] });
check('covers all current addresses → valid', cov1.valid === true && cov1.missingSans.length === 0);
const cov2 = cs.certCoversAddresses({ serverCrtPath: r2.serverCrtPath, addresses: ['192.168.5.10', '172.16.0.1'] });
check('reports a missing SAN → invalid', cov2.valid === false && cov2.missingSans.includes('172.16.0.1'));

const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-certsvc-exp-'));
const rExp = cs.generateServerCerts({ certsDir: tmp2, sans: ['192.168.5.10'], days: 1 });
const covExp = cs.certCoversAddresses({ serverCrtPath: rExp.serverCrtPath, addresses: ['192.168.5.10'], expiryGraceDays: 30 });
check('near-expiry (1d cert vs 30d grace) flagged for re-issue', covExp.expired === true && covExp.valid === false);

// ── 4. detectLanIdentities (stubbed os) ────────────────────────────────────────
const fakeOs = {
  networkInterfaces: () => ({
    lo:   [{ family: 'IPv4', address: '127.0.0.1',    internal: true }],
    eth0: [{ family: 'IPv4', address: '192.168.1.50', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    wifi: [{ family: 'IPv4', address: '10.0.0.5',     internal: false }],
  }),
  hostname: () => 'TEST-PC',
};
const ids = cs.detectLanIdentities({ os: fakeOs });
check('detect: only external IPv4 (no loopback/IPv6)', JSON.stringify(ids.ipv4) === JSON.stringify(['192.168.1.50', '10.0.0.5']));
check('detect: hostname returned', ids.hostname === 'TEST-PC');

// ── 5. readCaFingerprint ───────────────────────────────────────────────────────
const fp = cs.readCaFingerprint({ caCrtPath: r.caCrtPath });
check('readCaFingerprint is stable', fp === cs.readCaFingerprint({ caCrtPath: r.caCrtPath }));
check('readCaFingerprint equals X509 fingerprint256', fp === new X509Certificate(caPem).fingerprint256);

// cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tmp2, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\ncertService: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
