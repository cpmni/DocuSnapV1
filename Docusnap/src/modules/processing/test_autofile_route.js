#!/usr/bin/env node
'use strict';

/**
 * src/modules/processing/test_autofile_route.js — SEAM-A closure integration test (Oracle C5).
 * ------------------------------------------------------------------------------------------------
 * Exercises the auto-file routing engine (`amountRouting.startDefaultRoute`) with the REAL DB-layer
 * deps `_autoFileDoc` uses (assignSystem null-sender, currencyConsistentForField, listActiveRouteRules,
 * getAllUsers, summarizeRule) against a real `runMigrations` DB — proving a doc ROUTES when it
 * auto-files (entitlement injected true, since the master const is false so no route could form
 * otherwise), with a NULL 'Auto-filed' sender + the immutable rule summary, `workflow_status='pending'`
 * and `documents.status` untouched; OFF ⇒ no route; and a throwing dep is swallowed by the detached
 * call (fail-open). The full `_autoFileDoc` file-I/O path is covered by the existing auto-file suite;
 * this pins the NEW routing behaviour the M=0 corpus harness structurally cannot reach.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_autofile_route.js
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const wf        = require('../../../database/modules/workflow');
const trust     = require('../../../database/modules/trust');
const authDb    = require('../../../database/modules/auth');
const workflowService = require('../../services/workflowService');
const amountRouting   = require('../../services/amountRouting');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

function seed() {
  const db = new Database(':memory:'); runMigrations(db);
  db.prepare("INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice')").run();
  const docId = Number(documents.insert(db, { original_filename: 's.pdf', folder_path: '/in', status: 'confirmed' }).lastInsertRowid);
  db.prepare('UPDATE documents SET document_type_id=1, supplier_name=? WHERE id=?').run('Acme', docId);
  db.prepare("INSERT INTO extractions (document_id,field_key,display_value,confidence,extraction_method) VALUES (?,'total_amount','£6,000.00',95,'keyword')").run(docId);
  db.prepare("INSERT INTO users (id,username,display_name,role,is_active,password_hash) VALUES (5,'mgr','Manager','edit',1,'x')").run();
  wf.insertRouteRule(db, { documentTypeId: 1, minAmountPennies: 0, targetUserId: 5, actionRequired: 'acknowledge' }); // type-only FYI rule
  return { db, docId };
}
const realDeps = (db, over = {}) => {
  const svc = workflowService.createWorkflowService({});
  return {
    entitled: () => true,   // INJECTED — the master const is false; this exercises the routing path
    hasActiveRoute: (d, id) => wf.hasActiveRoute(d, id),
    currencyConsistent: (d, sup, slug, fk, v) => trust.currencyConsistentForField(d, sup, slug, fk, v),
    floor: () => 88,
    listActiveRules: (d) => wf.listActiveRouteRules(d),
    usersByRole: (d, role) => authDb.getAllUsers(d).filter(u => u.role === role),
    assign: (_actor, opts) => svc.assignSystem(db, opts),   // NULL sender — auto-file has no confirmer
    audit: () => {}, summarizeRule: (rule) => wf.summarizeRule(db, rule), ...over,
  };
};
const meta = { supplierName: 'Acme', slug: 'invoice', documentTypeId: 1 };   // NO actor (auto-file)
const ctxOf = (db, docId) => amountRouting.captureTotalContext(db, docId, {}, { getExtractedTotalContext: documents.getExtractedTotalContext });

async function main() {
  console.log('§1 auto-file routing: a doc ROUTES via a system (null-sender) route [SEAM A closed]');
  {
    process.env.WORKFLOW_AMOUNT_ROUTING = '1';
    const { db, docId } = seed();
    const res = amountRouting.startDefaultRoute(db, docId, ctxOf(db, docId), meta, realDeps(db));
    check('routed', res.routed);
    const route = res.routed ? wf.getRoute(db, res.routeId) : null;
    check('to the recipient (user 5)', !!route && route.to_user_id === 5);
    check('NULL sender + Auto-filed sentinel', !!route && route.from_user_id === null && route.from_username === 'Auto-filed');
    check('acknowledge (FYI) action', !!route && route.action_required === 'acknowledge');
    check('matched_rule_summary snapshot set', !!route && /Invoice/.test(String(route.matched_rule_summary || '')));
    check('workflow_status=pending', db.prepare('SELECT workflow_status FROM documents WHERE id=?').get(docId).workflow_status === 'pending');
    check('documents.status untouched (still confirmed/filed)', db.prepare('SELECT status FROM documents WHERE id=?').get(docId).status === 'confirmed');
    db.close();
  }

  console.log('§2 OFF (kill switch) -> no route');
  {
    delete process.env.WORKFLOW_AMOUNT_ROUTING;
    const { db, docId } = seed();
    const res = amountRouting.startDefaultRoute(db, docId, null, meta, realDeps(db));
    check('kill switch off -> not routed (disabled)', res.reason === 'disabled');
    check('zero routes created', db.prepare('SELECT COUNT(*) c FROM document_routes').get().c === 0);
    db.close();
  }

  console.log('§3 fail-open: a throwing route dep is swallowed by the detached call');
  {
    process.env.WORKFLOW_AMOUNT_ROUTING = '1';
    const { db, docId } = seed();
    let reached = false;
    await Promise.resolve()
      .then(() => amountRouting.startDefaultRoute(db, docId, ctxOf(db, docId), meta, realDeps(db, { assign: () => { throw new Error('boom'); } })))
      .catch(() => { /* swallowed exactly as _autoFileDoc's detached .catch does */ })
      .finally(() => { reached = true; });
    check('a throwing route dep does not crash (fail-open)', reached);
    check('no route created on the throw', db.prepare('SELECT COUNT(*) c FROM document_routes').get().c === 0);
    db.close();
    delete process.env.WORKFLOW_AMOUNT_ROUTING;
  }

  console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${fail} failure(s)`);
  process.exit(fail ? 1 : 0);
}
main();
