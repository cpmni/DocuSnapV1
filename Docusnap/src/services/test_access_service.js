#!/usr/bin/env node
'use strict';

/**
 * src/services/test_access_service.js
 * -----------------------------------
 * Slice 0 of the Workflow Suite (docs/designs/WORKFLOW_SUITE_2026-07-18.md §3/§10).
 * The per-document read-authz DENIAL MATRIX: role{admin,edit,readonly,null} ×
 * status{needs_review,deferred,confirmed,deleted} × route-membership{none,to,from,closed}.
 * Fail-closed; the routing visibility grant (Oracle C3) is OPEN routes only; the kill
 * switch reverts to legacy allow-any so a control test can prove OFF byte-identical.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_access_service.js
 */

const Database = require('better-sqlite3');
const workflow = require('../../database/modules/workflow');
const accessService = require('../services/accessService');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, supplier_name TEXT,
                            document_type_id INTEGER);
    CREATE TABLE document_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER,
                                  from_user_id INTEGER, to_user_id INTEGER, state TEXT DEFAULT 'pending', version INTEGER DEFAULT 1);
  `);
  return db;
}
const mkDoc = (db, status) => db.prepare("INSERT INTO documents (status) VALUES (?)").run(status).lastInsertRowid;
const mkRoute = (db, docId, fromU, toU, state) => db.prepare(
  "INSERT INTO document_routes (document_id, from_user_id, to_user_id, state) VALUES (?,?,?,?)").run(docId, fromU, toU, state);

const A = { role: 'admin', id: 1 };
const E = { role: 'edit', id: 2 };
const R = { role: 'readonly', id: 3 };            // a non-party readonly (the id-walker)
const RECIP = { role: 'readonly', id: 7 };        // a readonly route recipient
const NUL = null;
const can = (db, user, id) => accessService.canAccessDocument(db, user, id).allow;
const reason = (db, user, id) => accessService.canAccessDocument(db, user, id).reason;

console.log('§1 role × status, NO route (the id-walk matrix)');
{
  const db = makeDb();
  const nr = mkDoc(db, 'needs_review'), df = mkDoc(db, 'deferred'), cf = mkDoc(db, 'confirmed'), dl = mkDoc(db, 'deleted');
  // admin: everything incl. deleted
  check('admin sees needs_review/deferred/confirmed/deleted', [nr, df, cf, dl].every(id => can(db, A, id)));
  // edit (writer): any non-deleted; NOT deleted
  check('edit sees needs_review/deferred/confirmed', [nr, df, cf].every(id => can(db, E, id)));
  check('edit DENIED deleted', !can(db, E, dl) && reason(db, E, dl) === 'deleted');
  // readonly (non-party): confirmed ONLY — the SEC-03 fix
  check('readonly sees confirmed', can(db, R, cf) && reason(db, R, cf) === 'readonly_confirmed');
  check('readonly DENIED needs_review (SEC-03)', !can(db, R, nr) && reason(db, R, nr) === 'readonly_unconfirmed');
  check('readonly DENIED deferred (SEC-03)', !can(db, R, df));
  check('readonly DENIED deleted', !can(db, R, dl) && reason(db, R, dl) === 'deleted');
  // null / unknown
  check('null user DENIED everything', [nr, df, cf].every(id => !can(db, NUL, id)));
  check('unknown role DENIED', !can(db, { role: 'ghost', id: 9 }, cf) && reason(db, { role: 'ghost', id: 9 }, cf) === 'denied');
  check('missing doc DENIED not_found', !can(db, A, 9999) && reason(db, A, 9999) === 'not_found');
}

console.log('§2 route-party grant — OPEN routes only (Oracle C3), the workflow-critical rows');
{
  const db = makeDb();
  const nr = mkDoc(db, 'needs_review');
  mkRoute(db, nr, E.id, RECIP.id, 'pending');   // edit sender -> readonly recipient, OPEN
  check('readonly RECIPIENT on an OPEN route sees the needs_review doc (rule 3)', can(db, RECIP, nr) && reason(db, RECIP, nr) === 'route_party');
  check('readonly SENDER-party would also see it', can(db, { role: 'readonly', id: E.id }, nr));
  check('a DIFFERENT readonly (no route) still DENIED the same doc', !can(db, R, nr));

  // Close the route -> the grant ENDS (readonly recipient loses the LIVE doc)
  const db2 = makeDb();
  const nr2 = mkDoc(db2, 'needs_review');
  mkRoute(db2, nr2, E.id, RECIP.id, 'approved');   // CLOSED
  check('readonly recipient on a CLOSED route DENIED the live needs_review doc', !can(db2, RECIP, nr2), reason(db2, RECIP, nr2));

  // claimed is open; recalled is closed
  const db3 = makeDb();
  const d3 = mkDoc(db3, 'deferred');
  mkRoute(db3, d3, E.id, RECIP.id, 'claimed');
  check("claimed route = OPEN -> party sees it", can(db3, RECIP, d3));
  const db4 = makeDb();
  const d4 = mkDoc(db4, 'deferred');
  mkRoute(db4, d4, E.id, RECIP.id, 'recalled');
  check("recalled route = CLOSED -> party DENIED", !can(db4, RECIP, d4));

  // Remaining closed states (Slice-1 matrix completion). A dark-era 'paid' row is healed to
  // exactly 'approved' at boot (see test_workflow_paid_heal.js), so 'approved' above covers it —
  // no 'paid' state can exist post-heal.
  const db5 = makeDb();
  const d5 = mkDoc(db5, 'deferred');
  mkRoute(db5, d5, E.id, RECIP.id, 'rejected');
  check("rejected route = CLOSED -> party DENIED", !can(db5, RECIP, d5));
  const db6 = makeDb();
  const d6 = mkDoc(db6, 'deferred');
  mkRoute(db6, d6, E.id, RECIP.id, 'acknowledged');
  check("acknowledged route = CLOSED -> party DENIED", !can(db6, RECIP, d6));
}

console.log('§3 route-party never DOWNGRADES an existing allow (admin/writer still fine)');
{
  const db = makeDb();
  const cf = mkDoc(db, 'confirmed');
  mkRoute(db, cf, E.id, RECIP.id, 'pending');
  check('admin still allowed on a routed doc', can(db, A, cf));
  check('edit still allowed on a routed confirmed doc', can(db, E, cf));
}

console.log('§4 kill switch — ACCESS_GATE_ENABLED off ⇒ predicate unchanged, gateEnabled reflects env');
{
  check('gateEnabled() default ON', accessService.gateEnabled() === true);
  for (const v of ['0', 'false', 'off', 'no']) {
    process.env.ACCESS_GATE_ENABLED = v;
    check(`gateEnabled() false for '${v}'`, accessService.gateEnabled() === false);
  }
  process.env.ACCESS_GATE_ENABLED = '1';
  check("gateEnabled() true for '1'", accessService.gateEnabled() === true);
  delete process.env.ACCESS_GATE_ENABLED;
  check('gateEnabled() default ON when unset', accessService.gateEnabled() === true);
  // NOTE: the predicate itself always evaluates; the kill switch is applied by the CALLER
  // (each seam wraps `if (gateEnabled()) …`), so OFF is byte-identical legacy behaviour.
}

console.log('§5 user shape — accepts both transports (userId vs id)');
{
  const db = makeDb();
  const nr = mkDoc(db, 'needs_review');
  mkRoute(db, nr, 2, 7, 'pending');
  check('/v1 shape {userId,role}', accessService.canAccessDocument(db, { userId: 7, role: 'readonly' }, nr).allow);
  check('desktop shape {id,role}', accessService.canAccessDocument(db, { id: 7, role: 'readonly' }, nr).allow);
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
