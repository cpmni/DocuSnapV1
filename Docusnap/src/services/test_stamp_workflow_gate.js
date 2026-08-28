#!/usr/bin/env node
'use strict';
/**
 * src/services/test_stamp_workflow_gate.js
 * Workflow+Stamping redesign — SLICE 2a (enforcement in the routing engine). Stubs the DB layer so the
 * GATE logic is tested in isolation. Proves:
 *   - you cannot route FOR APPROVAL to a non-stamper (RECIPIENT_CANNOT_STAMP); to a stamper it's ok;
 *   - routing FOR VIEW (acknowledge) to a non-stamper is fine (routing is not stamp-gated);
 *   - resolving approve/reject requires the actor to hold can_stamp (STAMP_FORBIDDEN otherwise).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_stamp_workflow_gate.js  (plain node ok)
 */

const { createWorkflowService } = require('./workflowService');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

console.log('\nWorkflow+Stamping slice 2a — approve/route gates');

const STAMPERS = new Set([2]);   // only user 2 may stamp
let seq = 100;
const routes = new Map();

const docsStub = { getById: (db, id) => ({ id, status: 'confirmed' }),
                   getExtractedTotalDisplay: () => null };
const authStub = { getUserById: (db, id) => ({ id, username: 'u' + id, is_active: 1 }) };
const wfStub = {
  insertRoute: (db, row) => { const r = { id: ++seq, version: 1, state: 'pending', claimed_by_id: null, ...row }; routes.set(r.id, r); return r; },
  getRoute: (db, id) => routes.get(id),
  updateState: (db, id, ver, fields) => { const r = routes.get(id); if (!r || r.version !== ver) return 0; Object.assign(r, fields); r.version++; return 1; },
  setDocWorkflowStatus: () => {},
  setStampedPath: () => {},
};

const svc = createWorkflowService({
  dbWorkflow: wfStub, dbAuth: authStub, dbDocuments: docsStub,
  canStamp: (db, userId) => STAMPERS.has(userId),
  stampDecision: () => null, audit: () => {}, notifyWorkflow: () => {},
});
const db = {};                                   // opaque — every DB op is stubbed
const sender = { userId: 1, username: 'u1', role: 'edit' };

// ── routing ───────────────────────────────────────────────────────────────────
check('route FOR APPROVAL to a non-stamper → refused',
  svc.assign(db, sender, { documentId: 5, toUserId: 3, actionRequired: 'approve' }).code === 'RECIPIENT_CANNOT_STAMP');
const okApprove = svc.assign(db, sender, { documentId: 5, toUserId: 2, actionRequired: 'approve' });
check('route FOR APPROVAL to a stamper → ok', okApprove.ok === true);
check('route FOR VIEW to a non-stamper → ok',
  svc.assign(db, sender, { documentId: 5, toUserId: 3, actionRequired: 'acknowledge' }).ok === true);

// ── resolving (approve/reject place a stamp → need can_stamp) ───────────────────
// A route addressed to a NON-stamper recipient (user 3) — even though you can't normally create one, a
// legacy/hand route or a revoked grant can produce it; resolving must still refuse.
const r3 = wfStub.insertRoute(db, { document_id: 9, to_user_id: 3, from_user_id: 1, action_required: 'approve' });
check('approve without can_stamp → STAMP_FORBIDDEN',
  svc.resolve(db, { userId: 3, username: 'u3', role: 'edit' }, r3.id, { decision: 'approve' }).code === 'STAMP_FORBIDDEN');

const r2 = wfStub.insertRoute(db, { document_id: 9, to_user_id: 2, from_user_id: 1, action_required: 'approve' });
const approved = svc.resolve(db, { userId: 2, username: 'u2', role: 'edit' }, r2.id, { decision: 'approve' });
check('approve with can_stamp → approved', approved.ok === true && approved.route.state === 'approved');

console.log(`\n${fails === 0 ? 'ALL OK' : fails + ' FAILED'}\n`);
process.exit(fails === 0 ? 0 : 1);
