#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_workflow_paid_heal.js
 * ------------------------------------------
 * The Workflow Slice-1 'paid' boot heal (TOP of runJsMigrations in database/index.js):
 * dark-era document_routes.state='paid' + documents.workflow_status='paid' rows are healed
 * to 'approved' BEFORE any stamped migration runs (Oracle condition 1 — a future Slice-4
 * CHECK-adding table rebuild must never see a nonconforming 'paid' row, even on the first
 * boot of a restored dark-era DB).
 *
 * Battery:
 *   §1 heal converts route + doc, preserves resolution fields, does NOT bump version,
 *      restores the route to listCompleted, audits EXACTLY ONCE ({routes, docs} metadata)
 *   §2 idempotent: re-run -> no change, NO second audit row
 *   §3 doc-only orphan (workflow_status='paid' with NO paid route) -> healed
 *   §4 fresh-DB control: zero heal audit rows (byte-identical for every normal install)
 *   §5 ORDERING pin (source-text): the heal sits BEFORE the first stamped block inside
 *      runJsMigrations — moving it below the stamped blocks re-opens the Oracle C1
 *      boot-brick seam and MUST fail this test
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_workflow_paid_heal.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const workflow = require('./workflow');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const healAudits = (db) =>
  db.prepare(`SELECT * FROM audit_log WHERE action='workflow_paid_migrated'`).all();
const newDoc = (db, status = 'confirmed') =>
  Number(documents.insert(db, { original_filename: 'scan.pdf', folder_path: '/in', status }).lastInsertRowid);

console.log('§1 heal converts a dark-era paid route + doc (visibility restored, version untouched)');
const db = new Database(':memory:');
runMigrations(db);                     // full real schema, fully stamped

const docId = newDoc(db);
db.prepare(`INSERT INTO document_routes
    (document_id, from_user_id, from_username, to_user_id, to_username, action_required,
     state, resolution_comment, resolved_at, version)
    VALUES (?, 5, 'sender', 7, 'recipient', 'approve', 'paid', 'paid via BACS', '2026-07-01T10:00:00Z', 3)`)
  .run(docId);
const routeId = Number(db.prepare('SELECT last_insert_rowid() id').get().id);
db.prepare(`UPDATE documents SET workflow_status='paid' WHERE id=?`).run(docId);

runMigrations(db);                     // second boot -> heal fires (stamped blocks all no-op)

const healed = db.prepare('SELECT * FROM document_routes WHERE id=?').get(routeId);
check("route state healed 'paid' -> 'approved'", healed.state === 'approved');
check('resolution_comment preserved', healed.resolution_comment === 'paid via BACS');
check('resolved_at preserved', healed.resolved_at === '2026-07-01T10:00:00Z');
check('version NOT bumped (paid is terminal; no CAS can act on it — pinned)', healed.version === 3);
check("doc workflow_status healed 'paid' -> 'approved'",
  db.prepare('SELECT workflow_status FROM documents WHERE id=?').get(docId).workflow_status === 'approved');
check('healed route is VISIBLE in listCompleted (the user-facing point of the heal)',
  workflow.listCompleted(db, 7).some(r => r.id === routeId));
let audits = healAudits(db);
check('exactly ONE workflow_paid_migrated audit row', audits.length === 1);
{
  let meta = {};
  try { meta = JSON.parse(audits[0].metadata_json || '{}'); } catch { /* leave empty -> fails below */ }
  check('audit metadata records routes=1 docs=1 (sanitised values arrive as strings)',
    String(meta.routes) === '1' && String(meta.docs) === '1');
}

console.log('§2 idempotent: third boot -> no change, no second audit row');
runMigrations(db);
check('still exactly ONE audit row after a no-change re-run', healAudits(db).length === 1);
check('route still approved', db.prepare('SELECT state FROM document_routes WHERE id=?').get(routeId).state === 'approved');

console.log("§3 doc-only orphan: workflow_status='paid' with NO paid route -> healed");
const docId2 = newDoc(db);
db.prepare(`UPDATE documents SET workflow_status='paid' WHERE id=?`).run(docId2);
runMigrations(db);
check('orphan doc workflow_status healed to approved',
  db.prepare('SELECT workflow_status FROM documents WHERE id=?').get(docId2).workflow_status === 'approved');
audits = healAudits(db);
check('orphan heal audited as its own row (routes=0, docs=1)', audits.length === 2);
{
  let meta = {};
  try { meta = JSON.parse(audits[1].metadata_json || '{}'); } catch { /* leave empty -> fails below */ }
  check('second audit metadata routes=0 docs=1', String(meta.routes) === '0' && String(meta.docs) === '1');
}
check('zero paid rows anywhere after all heals',
  db.prepare(`SELECT COUNT(*) c FROM document_routes WHERE state='paid'`).get().c === 0
  && db.prepare(`SELECT COUNT(*) c FROM documents WHERE workflow_status='paid'`).get().c === 0);
db.close();

console.log('§4 fresh-DB control: a clean install never writes a heal audit row');
const dbFresh = new Database(':memory:');
runMigrations(dbFresh);
check('fresh DB has ZERO workflow_paid_migrated rows (byte-identical normal installs)',
  healAudits(dbFresh).length === 0);
dbFresh.close();

console.log('§5 ORDERING pin: the heal precedes the first stamped block in runJsMigrations');
{
  // Source-text pin, deliberately crude: TODAY no stamped block can observe the difference
  // (the future Slice-4 CHECK-rebuild is what the ordering protects), so no black-box test
  // can catch a re-ordering — this tripwire can. Do not remove it; move it only together
  // with a Slice-4-aware behavioural ordering test.
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const body = src.slice(src.indexOf('function runJsMigrations'));
  const healAt = body.indexOf(`WHERE state='paid'`);
  const firstStamped = body.indexOf('applied.has(');
  check('heal UPDATE appears before the first applied.has( stamped gate',
    healAt > -1 && firstStamped > -1 && healAt < firstStamped);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll paid-heal checks passed.');
process.exit(fails ? 1 : 0);
