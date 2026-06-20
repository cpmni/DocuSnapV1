#!/usr/bin/env node
'use strict';

/**
 * src/modules/api/test_v1_seats.js — concurrent sticky-seat enforcement on the /v1
 * API, end to end against the REAL server on an ephemeral loopback port.
 *
 * Covers: acquire up to the licensed seat count · reject the next client (409
 * SEAT_LIMIT) · a reconnecting client reuses its seat · admin release frees a seat so
 * another client connects · the login audit records ip + hostname · a seat-denied
 * audit row is written.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_seats.js
 */

const http = require('http');
const Database = require('better-sqlite3');

const api = require('./handler');
const pw  = require('../auth/password');
const { createSeatPool } = require('../../services/seatPool');
const { runMigrations } = require('../../../database/index');

const PWD = 'Correct-Horse-9';
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

async function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);                         // real users + audit_log + settings tables
  const h = await pw.hashPassword(PWD);
  db.prepare(`INSERT INTO users (username, display_name, password_hash, role, is_active)
              VALUES ('user', 'User', ?, 'edit', 1)`).run(h);
  return db;
}

function req(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let out = ''; res.on('data', d => { out += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: out ? JSON.parse(out) : null }); } catch (e) { reject(e); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const login = (port, clientId, hostname) =>
  req(port, 'POST', '/v1/auth/login', { username: 'user', password: PWD, client_id: clientId, hostname });

async function main() {
  let fail = 0;
  const db = await freshDb();
  const seatPool = createSeatPool({ getDb: () => db });   // persisted in the same DB (client_seats via migration 30)
  const server = api.createServer({
    getDb: () => db,
    learning: { getDigitsOnlyFields: () => [] },
    checkEntitlement: () => ({ entitled: true, feature: 'detached_client', seats: 2 }),
    seatPool,
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // acquire up to the cap (2)
  let r = await login(port, 'CLIENT-A', 'PC-A');
  fail += !check('client A login → 200 + token', r.status === 200 && !!r.json.token);
  r = await login(port, 'CLIENT-B', 'PC-B');
  fail += !check('client B login → 200', r.status === 200 && !!r.json.token);
  fail += !check('two seats in use', seatPool.count() === 2);

  // the 3rd distinct client is refused
  r = await login(port, 'CLIENT-C', 'PC-C');
  fail += !check('client C → 409 SEAT_LIMIT (inUse 2 / cap 2)',
    r.status === 409 && r.json.code === 'SEAT_LIMIT' && r.json.inUse === 2 && r.json.cap === 2);
  fail += !check('still two in use (C did not get a seat)', seatPool.count() === 2);

  // a returning client reuses its seat (no growth)
  r = await login(port, 'CLIENT-A', 'PC-A');
  fail += !check('client A reconnect → 200 (reused)', r.status === 200);
  fail += !check('reconnect did not consume a new seat', seatPool.count() === 2);

  // admin release frees a seat → client C now connects
  const aSeat = seatPool.list().find(s => s.clientKey === 'CLIENT-A');
  fail += !check('admin release of A’s seat → true', seatPool.release(aSeat.id) === true);
  fail += !check('one seat free after release', seatPool.count() === 1);
  r = await login(port, 'CLIENT-C', 'PC-C');
  fail += !check('client C now connects into the freed seat → 200', r.status === 200 && seatPool.count() === 2);

  // audit: login_success rows carry ip + hostname; a seat-denied row was written
  const logins = db.prepare("SELECT metadata_json FROM audit_log WHERE action='login_success'").all()
    .map(r => { try { return JSON.parse(r.metadata_json || '{}'); } catch { return {}; } });
  fail += !check('login audit records hostname', logins.some(m => m.hostname === 'PC-A'));
  fail += !check('login audit records a client ip', logins.some(m => typeof m.ip === 'string' && m.ip.length > 0));
  const denied = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='license.seat_denied'").get().c;
  fail += !check('a seat-denied audit row was written', denied >= 1);

  await new Promise(r2 => server.close(r2));
  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll /v1 seat-enforcement checks passed.');
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
