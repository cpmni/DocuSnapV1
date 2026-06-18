#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_audit_log.js
 * ----------------------------------
 * Structured audit logging (migration 25 + auth.js helpers).
 * Verifies the foundation the admin Audit view depends on:
 *   1. migration 25 adds the structured columns + indexes on a fresh DB.
 *   2. addAuditEntry snapshots the actor (username/role) so a later rename
 *      doesn't rewrite history, and infers action_category from the action.
 *   3. metadata is sanitised: secret-named keys redacted, a setting's NAME/value
 *      preserved, nested objects collapsed, long values capped — never raw
 *      secrets/contents (GDPR guardrail).
 *   4. getAuditLogFiltered honours user/document/category/outcome/text filters
 *      and paginates (limit/offset + total).
 *   5. Old-schema audit_log tables (pre-25) still accept writes (column-aware
 *      degrade) — never throws on legacy DBs used by the auth/license tests.
 *
 * Run under Electron-as-Node (better-sqlite3 ABI):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_audit_log.js
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const auth = require('./auth');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;
const hasCol = (db, t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(r => r.name === c);

const db = new Database(':memory:');
runMigrations(db);

// 1. Migration 25 columns
for (const c of ['action_category', 'outcome', 'document_id', 'customer_id', 'session_id',
                 'source', 'metadata_json', 'actor_username', 'actor_role']) {
  if (!check(`migration 25: audit_log.${c} exists`, hasCol(db, 'audit_log', c))) fail++;
}

// seed a user we can rename afterwards
const uid = db.prepare("INSERT INTO users (username,display_name,password_hash,role) VALUES (?,?,?,?)")
  .run('alice', 'Alice Admin', 'x', 'admin').lastInsertRowid;

// 2. Actor snapshot + category inference
auth.addAuditEntry(db, { user_id: uid, action: 'login_success', outcome: 'success' });
db.prepare("UPDATE users SET username='renamed' WHERE id=?").run(uid);
const login = db.prepare("SELECT * FROM audit_log WHERE action='login_success'").get();
if (!check('actor username snapshotted at write time', login.actor_username === 'alice')) fail++;
if (!check('actor role snapshotted at write time',     login.actor_role === 'admin')) fail++;
if (!check('category inferred (login_success → auth)',  login.action_category === 'auth')) fail++;

auth.addAuditEntry(db, { user_id: uid, action: 'license.activated', outcome: 'success' });
const lic = db.prepare("SELECT action_category FROM audit_log WHERE action='license.activated'").get();
if (!check('category inferred (license.* → licensing)', lic.action_category === 'licensing')) fail++;

// 3. Metadata sanitisation
auth.addAuditEntry(db, { user_id: uid, action: 'setting_changed', target_type: 'setting',
  target_id: 'theme', outcome: 'success',
  metadata: { key: 'theme', value: 'light', password: 'hunter2', account_key: 'AK-123',
              fingerprint: 'deadbeef', nested: { a: 1 }, long: 'x'.repeat(400) } });
const meta = JSON.parse(db.prepare("SELECT metadata_json FROM audit_log WHERE action='setting_changed'").get().metadata_json);
if (!check('secret key "password" redacted',     meta.password === '[redacted]')) fail++;
if (!check('secret key "account_key" redacted',   meta.account_key === '[redacted]')) fail++;
if (!check('secret key "fingerprint" redacted',   meta.fingerprint === '[redacted]')) fail++;
if (!check('setting NAME "key" preserved',        meta.key === 'theme')) fail++;
if (!check('safe value preserved',                meta.value === 'light')) fail++;
if (!check('nested object collapsed',             meta.nested === '[object]')) fail++;
if (!check('long value capped at 300 chars',      typeof meta.long === 'string' && meta.long.length === 300)) fail++;

// 4. Filters + pagination
auth.addAuditEntry(db, { action: 'access_denied', action_category: 'admin', outcome: 'denied',
  details: 'required admin; has readonly' });
auth.addAuditEntry(db, { user_id: uid, action: 'document_open', document_id: 42, outcome: 'success' });
auth.addAuditEntry(db, { user_id: uid, action: 'document_close', document_id: 42, outcome: 'success' });

if (!check('filter document_id=42 → 2 rows',
  auth.getAuditLogFiltered(db, { document_id: 42 }).total === 2)) fail++;
if (!check('filter category=licensing → 1 row',
  auth.getAuditLogFiltered(db, { category: 'licensing' }).total === 1)) fail++;
if (!check('filter outcome=denied → 1 row (access_denied)',
  (() => { const r = auth.getAuditLogFiltered(db, { outcome: 'denied' });
    return r.total === 1 && r.rows[0].action === 'access_denied'; })())) fail++;
if (!check('filter text~readonly → 1 row',
  auth.getAuditLogFiltered(db, { text: 'readonly' }).total === 1)) fail++;
const page = auth.getAuditLogFiltered(db, { limit: 2, offset: 0 });
if (!check('pagination: limit caps rows, total counts all',
  page.rows.length === 2 && page.total === 6)) fail++;
if (!check('pagination: newest first (DESC by id)',
  page.rows[0].id > page.rows[1].id)) fail++;

// 5. Old-schema degrade — a legacy audit_log that predates migration 25
const legacy = new Database(':memory:');
legacy.exec(`CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL,
  target_type TEXT, target_id TEXT, details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
let threw = false;
try {
  auth.addAuditEntry(legacy, { action: 'login_success', action_category: 'auth', outcome: 'success',
    document_id: 9, metadata: { password: 'x' } });
} catch (e) { threw = true; console.log('   threw:', e.message); }
if (!check('legacy schema: write did not throw', !threw)) fail++;
if (!check('legacy schema: row landed (known cols only)',
  legacy.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='login_success'").get().c === 1)) fail++;

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
