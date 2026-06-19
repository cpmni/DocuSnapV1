#!/usr/bin/env node
'use strict';

/**
 * src/modules/api/test_v1_entitlement.js
 * Stage 7 add-on entitlement gate over the REAL /v1 API + client transport, using
 * the REAL entitlementService (settings-driven). Proves: when not licensed, login
 * and /entitlement still work but the feature routes return 402; flipping the
 * install setting to licensed unlocks them. Default-deny.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/api/test_v1_entitlement.js
 */

const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const { createClient } = require('../../../client/apiClient');
const { SETTING_KEY } = require('../../services/entitlementService');

const PWD = 'Entitle-Test-5';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

async function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, supplier_name TEXT, status TEXT, document_type_id INTEGER,
      confirmed_at TEXT, processed_at TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, password_hash TEXT,
      role TEXT, is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0,
      totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT, updated_at TEXT);
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')`).run();
  db.prepare(`INSERT INTO documents (id,supplier_name,status,document_type_id,confirmed_at,processed_at)
              VALUES (1,'Acme','confirmed',1,'2026-03-11','2026-03-11')`).run();
  db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active)
              VALUES (1,'admin','Admin',?,'admin',1)`).run(await pw.hashPassword(PWD));
  return db;
}

async function main() {
  const db = await freshDb();
  // Real entitlementService (no checkEntitlement override) → reads the setting.
  const server = api.createServer({ getDb: () => db, learning: { getDigitsOnlyFields: () => [] } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const c = createClient({ baseUrl });

  await c.connect();
  // Login is exempt from the entitlement gate even when not licensed.
  const li = await c.login('admin', PWD);
  check('login works while NOT licensed (gate is feature-only)', li.ok);

  // Default-deny: not licensed.
  let e = await c.entitlement();
  check('entitlement probe -> entitled:false (default-deny)', e.status === 200 && e.json.entitled === false);
  let s = await c.search({});
  check('search blocked while not licensed -> 402', s.status === 402 && s.json.code === 'FEATURE_NOT_LICENSED');
  let d = await c.getDocument(1);
  check('document blocked while not licensed -> 402', d.status === 402);

  // License the add-on for this install.
  db.prepare(`INSERT INTO settings (key,value) VALUES (?, 'true')
              ON CONFLICT(key) DO UPDATE SET value='true'`).run(SETTING_KEY);

  e = await c.entitlement();
  check('entitlement probe -> entitled:true after licensing', e.json.entitled === true);
  s = await c.search({});
  check('search works once licensed -> 200', s.status === 200 && s.json.confirmed.length === 1);

  await new Promise(r2 => server.close(r2));
  db.close();
  console.log(fail ? `\n${fail} check(s) FAILED — entitlement gate changed.` : '\nAll /v1 entitlement checks passed.');
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
