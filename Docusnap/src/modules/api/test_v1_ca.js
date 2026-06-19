#!/usr/bin/env node
'use strict';

/**
 * /v1/ca CA-bootstrap endpoint: lockstep-exempt, returns the managed CA to pin,
 * optional pairing-code gate, 404 when no managed cert exists.
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/api/test_v1_ca.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { X509Certificate } = require('crypto');
const Database = require('better-sqlite3');
const api = require('./handler');
const certService = require('../../services/certService');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  return db;
}
const set = (db, k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
function get(base, p, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + p);
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: headers || {} }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* */ } resolve({ status: r.statusCode, json: j }); });
    }).on('error', reject);
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ca-test-'));

  const db = freshDb();
  set(db, 'client_api_host', '192.168.5.10'); set(db, 'client_api_port', '8766');
  certService.generateServerCerts({ certsDir: path.join(tmp, 'certs'), sans: ['192.168.5.10'] });
  const server = api.createServer({ getDb: () => db, certsDir: path.join(tmp, 'certs') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Lockstep-exempt: no contract header → still 200.
  let r = await get(base, '/v1/ca');
  check('GET /v1/ca → 200 with NO contract header (lockstep-exempt)', r.status === 200);
  check('body has caPem + fingerprint + host + port', !!(r.json && r.json.caPem && r.json.caFingerprintSha256 && r.json.host && r.json.port));
  check('caPem parses as a certificate', (() => { try { new X509Certificate(r.json.caPem); return true; } catch { return false; } })());
  check('fingerprint matches the file CA', r.json.caFingerprintSha256 === certService.readCaFingerprint({ caCrtPath: path.join(tmp, 'certs', 'ca.crt') }));
  check('host echoes the configured LAN host', r.json.host === '192.168.5.10');

  // Pairing code gate.
  set(db, 'client_api_pairing_code', 'ABC123');
  r = await get(base, '/v1/ca');          check('pairing: no code → 403 PAIRING', r.status === 403 && r.json.code === 'PAIRING');
  r = await get(base, '/v1/ca?code=NOPE');check('pairing: bad code → 403', r.status === 403);
  r = await get(base, '/v1/ca?code=ABC123'); check('pairing: correct code → 200', r.status === 200);
  set(db, 'client_api_pairing_expires', String(Date.now() - 1000));
  r = await get(base, '/v1/ca?code=ABC123'); check('pairing: expired → 403', r.status === 403);
  await new Promise(r2 => server.close(r2));

  // No managed CA → 404.
  const db2 = freshDb(); set(db2, 'client_api_host', '192.168.5.10');
  const server2 = api.createServer({ getDb: () => db2, certsDir: path.join(tmp, 'empty') });
  await new Promise(r2 => server2.listen(0, '127.0.0.1', r2));
  r = await get(`http://127.0.0.1:${server2.address().port}`, '/v1/ca');
  check('no managed CA → 404 NO_MANAGED_CA', r.status === 404 && r.json.code === 'NO_MANAGED_CA');
  await new Promise(r2 => server2.close(r2));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  db.close(); db2.close();
  console.log(fail ? `\n${fail} check(s) FAILED.` : '\nAll /v1/ca checks passed.');
  return fail ? 1 : 0;
}
main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
