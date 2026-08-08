#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_workflow_route_rules.js — Slice-3 DB-layer gate: the workflow_route_rules
 * table is created by the real migrations (idempotent), the CHECK(target present) holds, and
 * insert/listActive behave (active filter + evaluation order + null-max unbounded + defaults).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_workflow_route_rules.js
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const wf = require('./workflow');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };
const threw = (fn) => { try { fn(); return false; } catch { return true; } };
function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

console.log('§1 table created by migrations + idempotent double-migrate');
{
  const db = freshDb();
  check('workflow_route_rules exists', !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_route_rules'").get());
  let ok = true; try { runMigrations(db); } catch { ok = false; }
  check('second runMigrations no-throw', ok);
}

console.log('§2 insert + listActiveRouteRules (active filter, order, null-max, defaults)');
{
  const db = freshDb();
  wf.insertRouteRule(db, { documentTypeId: 1, minAmountPennies: 500000, targetRole: 'manager', stepOrder: 2 });
  wf.insertRouteRule(db, { documentTypeId: null, minAmountPennies: 0, maxAmountPennies: 500000, targetUserId: 7, stepOrder: 1 });
  wf.insertRouteRule(db, { minAmountPennies: 0, targetRole: 'x', active: 0 });   // inactive → excluded
  const rules = wf.listActiveRouteRules(db);
  check('only active rules returned', rules.length === 2);
  check('ordered by step_order (1 then 2)', rules[0].step_order === 1 && rules[1].step_order === 2);
  check('null max persisted as unbounded', rules[1].max_amount_pennies === null);
  check('defaults applied (action_required=approve, active=1)', rules[0].action_required === 'approve' && rules[0].active === 1);
}

console.log('§3 CHECK(target present) rejects a rule with neither role nor user');
{
  const db = freshDb();
  check('both-null target THROWS', threw(() => wf.insertRouteRule(db, { minAmountPennies: 0 })));
}

console.log('§4 captureTotalContext reads the total note/conf (proves the pre-note-clear capture)');
{
  const documents = require('./documents');
  const { captureTotalContext } = require('../../src/services/amountRouting');
  const deps = { getExtractedTotalContext: documents.getExtractedTotalContext };
  const db = freshDb();
  const docId = Number(documents.insert(db, { original_filename: 's.pdf', folder_path: '/in', status: 'confirmed' }).lastInsertRowid);
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value, confidence, validation_note, extraction_method) VALUES (?, 'total_amount', '£6,000.00', 95, 'looks off', 'keyword')").run(docId);

  process.env.WORKFLOW_AMOUNT_ROUTING = '1';
  const ctx = captureTotalContext(db, docId, {}, deps);
  check('captured field/value/conf/NOTE (still readable pre-clear)',
    !!ctx && ctx.fieldKey === 'total_amount' && ctx.value === '£6,000.00' && ctx.confidence === 95 && ctx.note === 'looks off');
  check('wasCorrected false when total not in corrections', !!ctx && ctx.wasCorrected === false);
  check('wasCorrected TRUE when total IS in the corrections payload',
    captureTotalContext(db, docId, { total_amount: 'x' }, deps)?.wasCorrected === true);

  delete process.env.WORKFLOW_AMOUNT_ROUTING;
  check('OFF -> null (no DB read, byte-identical)', captureTotalContext(db, docId, {}, deps) === null);
  process.env.WORKFLOW_AMOUNT_ROUTING = '1';
  const db2 = freshDb();
  const noTotal = Number(documents.insert(db2, { original_filename: 's2.pdf', folder_path: '/in', status: 'confirmed' }).lastInsertRowid);
  check('no total field -> null', captureTotalContext(db2, noTotal, {}, deps) === null);
  delete process.env.WORKFLOW_AMOUNT_ROUTING;
}

console.log('§5 rule CRUD (settings-area DB layer)');
{
  const db = freshDb();
  const id = wf.insertRouteRule(db, { documentTypeId: 1, minAmountPennies: 50000, targetUserId: 5, actionRequired: 'approve' });
  check('getRouteRule returns the row', wf.getRouteRule(db, id) && wf.getRouteRule(db, id).target_user_id === 5);
  wf.insertRouteRule(db, { minAmountPennies: 0, targetRole: 'x', active: 0 });   // inactive
  check('listAllRouteRules returns active AND inactive', wf.listAllRouteRules(db).length === 2);
  check('listActiveRouteRules returns only active', wf.listActiveRouteRules(db).length === 1);
  wf.updateRouteRule(db, id, { documentTypeId: 1, minAmountPennies: 100000, targetUserId: 6, actionRequired: 'approve' });
  const upd = wf.getRouteRule(db, id);
  check('updateRouteRule persists', upd && upd.min_amount_pennies === 100000 && upd.target_user_id === 6);
  wf.setRouteRuleActive(db, id, 0);
  check('setRouteRuleActive toggles off', wf.getRouteRule(db, id).active === 0);
  check('rule no longer in listActive', !wf.listActiveRouteRules(db).some(r => r.id === id));
  wf.deleteRouteRule(db, id);
  check('deleteRouteRule removes it', !wf.getRouteRule(db, id));
}

console.log('§6 summarizeRule action PHRASE (FYI slice grammar pin — never "to for information")');
{
  const db = freshDb();
  const ackRule = { document_type_id: null, min_amount_pennies: 0, max_amount_pennies: null,
    target_role: 'managers', target_user_id: null, action_required: 'acknowledge' };
  check('acknowledge -> "... for information."',
    wf.summarizeRule(db, ackRule) === 'When a document is filed, send it to the managers team for information.');
  check('approve stays byte-identical "... to approve."',
    wf.summarizeRule(db, { ...ackRule, action_required: 'approve' }) === 'When a document is filed, send it to the managers team to approve.');
}

console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${fail} failure(s)`);
process.exit(fail ? 1 : 0);
