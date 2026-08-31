#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_route_decisions.js
 * ----------------------------------------
 * DB-layer gate for the Workflow Slice-2 decision snapshot (append-only route_decisions).
 * Covers: the table is created by the REAL migrations; insert/list round-trip; the append-only
 * triggers actually block UPDATE/DELETE (Oracle C3); the schema-ensure is idempotent across a
 * double runMigrations (Oracle C4); the snapshot SURVIVES a parent-document delete cascade — the
 * whole point of the no-FK soft-ref design (Oracle C2); and append-only-by-absence (no mutator fn).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_route_decisions.js
 */

const Database  = require('better-sqlite3');
const { runMigrations } = require('../index');
const wf        = require('./workflow');
const documents = require('./documents');

let fail = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fail++; };
const threw = (fn) => { try { fn(); return false; } catch { return true; } };

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

const sampleDecision = {
  routeId: 10, documentId: 1, actorUserId: 2, actorUsername: 'editor', decision: 'approved',
  comment: null,
  snapshotJson: JSON.stringify({ document_id: 1, supplier_name: 'Acme Ltd', total: '£1,046.16', resulting_state: 'approved' }),
  snapshotTotalAmount: '£1,046.16', chainPosition: 1, onBehalfOfUserId: null, onBehalfOfUsername: null,
  decidedAt: '2026-07-19T10:00:00Z',
};

console.log('§1 schema + insert/list round-trip');
{
  const db = freshDb();
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='route_decisions'").get();
  check('route_decisions created by the real migrations', !!tbl);
  const trg = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND name IN ('route_decisions_noupd','route_decisions_nodel')").get().c;
  check('both append-only triggers created', trg === 2);
  const id = wf.insertRouteDecision(db, sampleDecision);            // no document row needed — no FK
  check('insertRouteDecision returns a rowid', Number(id) > 0);
  const rows = wf.listRouteDecisions(db, 1);
  check('listRouteDecisions returns the row', rows.length === 1 && rows[0].document_id === 1);
  check('decision + total stored', rows[0].decision === 'approved' && rows[0].snapshot_total_amount === '£1,046.16');
  check('chain_position defaults to 1', rows[0].chain_position === 1);
  const parsed = JSON.parse(rows[0].snapshot_json);
  check('snapshot_json round-trips', parsed.supplier_name === 'Acme Ltd' && parsed.resulting_state === 'approved');
}

console.log('§2 C4 — schema-ensure is idempotent (double runMigrations, own tableExists guard)');
{
  const db = freshDb();
  let ok = true; try { runMigrations(db); } catch (e) { ok = false; console.log('    (second run threw: ' + e.message + ')'); }
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='route_decisions'").get();
  check('second runMigrations does not throw + table intact', ok && !!tbl);
}

console.log('§3 C3 — the append-only triggers actually block UPDATE and DELETE');
{
  const db = freshDb();
  const id = wf.insertRouteDecision(db, sampleDecision);
  check('raw UPDATE route_decisions THROWS (trigger)', threw(() => db.prepare('UPDATE route_decisions SET decision=? WHERE id=?').run('rejected', id)));
  check('raw DELETE route_decisions THROWS (trigger)', threw(() => db.prepare('DELETE FROM route_decisions WHERE id=?').run(id)));
  check('row is unchanged after the blocked mutations', wf.listRouteDecisions(db, 1)[0].decision === 'approved');
}

console.log('§4 C2 — snapshot SURVIVES a parent-document delete cascade (no-FK audit durability)');
{
  const db = freshDb();
  db.pragma('foreign_keys = ON');   // the app runs FK enforcement ON (database/index.js:18)
  const docId = Number(documents.insert(db, { original_filename: 'scan.pdf', folder_path: '/in', status: 'confirmed' }).lastInsertRowid);
  db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, 'total_amount', '1046.16', '£1,046.16', 95, 'keyword')").run(docId);
  const routeId = Number(db.prepare("INSERT INTO document_routes (document_id, action_required, state) VALUES (?, 'approve', 'approved')").run(docId).lastInsertRowid);
  wf.insertRouteDecision(db, { ...sampleDecision, routeId, documentId: docId });
  db.prepare('DELETE FROM documents WHERE id=?').run(docId);   // route + extractions both ON DELETE CASCADE
  check('parent route cascaded away', !db.prepare('SELECT 1 FROM document_routes WHERE id=?').get(routeId));
  check('parent extractions cascaded away', !db.prepare('SELECT 1 FROM extractions WHERE document_id=?').get(docId));
  const rows = wf.listRouteDecisions(db, docId);
  check('route_decisions row SURVIVES the cascade (the no-FK property)', rows.length === 1);
  check('and is still fully readable from snapshot_json', rows.length === 1 && JSON.parse(rows[0].snapshot_json).total === '£1,046.16');
}

console.log('§5 append-only by absence — no mutator functions exist');
check('no wf.updateRouteDecision', typeof wf.updateRouteDecision === 'undefined');
check('no wf.deleteRouteDecision', typeof wf.deleteRouteDecision === 'undefined');

console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${fail} failure(s)`);
process.exit(fail ? 1 : 0);
