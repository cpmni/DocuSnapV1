#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_buyer_issued_convention_record.js — the ONE-CONFIRM buyer-issued convention RECORD
 * (owner 2026-09-07; gary → Oracle SIGN-OFF-W/COND C1-C8): learning.recordBuyerIssuedConvention /
 * retractBuyerIssuedConvention / retractBuyerIssuedConventionForDoc / isBuyerIssuedConventionNote.
 *
 * Pins: the row shape (pseudo field key, slug, scoped never __global__, UPSERT 1→2); getAllHints carries it
 * unprojected; the note regex matches BOTH engine wordings and rejects the neighbouring notes (C1); the
 * forget-sender inverse deletes it; C2: retractConfirmHints retracts it ONLY through the planting confirm's
 * audit row (a non-noted confirm of the same company never decrements), a repeat retract is a no-op, and
 * replantConfirmHints does NOT replant it.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_buyer_issued_convention_record.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const learning = require('./learning');
const documents = require('./documents');
const auth = require('./auth');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Purchase Order', 'purchase_order', 1)").run();
const X = 'Ironbridge Fabrication';
const rowFor = (issuer, slug) => db.prepare("SELECT * FROM supplier_hints WHERE field_key = 'buyer_issued_convention' AND hint_value = ? AND document_type = ?").get(issuer, slug);

console.log('§1 the record');
const r1 = learning.recordBuyerIssuedConvention(db, { issuer: X, typeSlug: 'purchase_order' });
check('first record → usage 1', r1 && r1.usage_count === 1);
const row = rowFor(X, 'purchase_order');
check("pseudo field key 'buyer_issued_convention', document_type = the SLUG, hint_value = the display issuer", row && row.field_key === 'buyer_issued_convention' && row.document_type === 'purchase_order' && row.hint_value === X);
check('scoped under the issuer (normalised), never __global__', row && row.supplier_name !== '__global__' && row.supplier_name === (learning.normalizeSupplierName(X) || X));
const r2 = learning.recordBuyerIssuedConvention(db, { issuer: X, typeSlug: 'purchase_order' });
check('second record → UPSERT usage 2', r2 && r2.usage_count === 2 && db.prepare("SELECT COUNT(*) n FROM supplier_hints WHERE field_key = 'buyer_issued_convention'").get().n === 1);
check('empty issuer / empty slug → null, no row', learning.recordBuyerIssuedConvention(db, { issuer: '', typeSlug: 'purchase_order' }) === null && learning.recordBuyerIssuedConvention(db, { issuer: X, typeSlug: '' }) === null);
check('getAllHints carries it unprojected (field_key + document_type intact) — the --hints-file road', learning.getAllHints(db).some(h => h.field_key === 'buyer_issued_convention' && h.document_type === 'purchase_order' && h.hint_value === X && h.usage_count === 2));

console.log('§2 the note regex (C1: BOTH wordings; neighbours rejected)');
const W1 = "This purchase order is on Ironbridge Fabrication's letterhead but names 'Ashcombe Care Homes Ltd' as the supplier — confirm which company to file under.";
const W2 = "A purchase order usually files under the buyer — please confirm 'Ironbridge Fabrication' is the right company for this one.";
check('wording 1 (vendor named) matches', learning.isBuyerIssuedConventionNote(W1));
check('wording 2 (no vendor captured) matches', learning.isBuyerIssuedConventionNote(W2));
for (const bad of ["A known supplier's name appears on this page, but not in the letterhead area, so it wasn't trusted as the issuer. Please confirm who issued this document.",
                   'This letterhead may read differently — please confirm the issuer.', 'Read differently after straightening — confirm once.',
                   'This name is used for several document types — confirm the type.', null, '', undefined]) {
  check(`rejects ${JSON.stringify(bad === undefined ? 'undefined' : String(bad)).slice(0, 60)}`, !learning.isBuyerIssuedConventionNote(bad));
}

console.log('§3 retract by value');
const rr = learning.retractBuyerIssuedConvention(db, { issuer: X, typeSlug: 'purchase_order' });
check('retract → usage 2 → 1', rr.retracted === 1 && rowFor(X, 'purchase_order').usage_count === 1);
check('retract of an unknown pair → 0', learning.retractBuyerIssuedConvention(db, { issuer: 'Nobody', typeSlug: 'purchase_order' }).retracted === 0);

console.log('§4 C2: retractConfirmHints retracts ONLY through the planting audit row');
const docA = Number(documents.insert(db, { original_filename: 'a.pdf', folder_path: '/in', status: 'confirmed', supplier_name: X, document_type_id: 1 }).lastInsertRowid);
const docB = Number(documents.insert(db, { original_filename: 'b.pdf', folder_path: '/in', status: 'confirmed', supplier_name: X, document_type_id: 1 }).lastInsertRowid);
// doc B confirmed the same company with NO note → no audit row → its send-back must not touch the record
const before = rowFor(X, 'purchase_order').usage_count;
const rb = learning.retractConfirmHints(db, docB);
check('a NON-noted confirm of the same company: send-back leaves the record alone', rowFor(X, 'purchase_order').usage_count === before && rb.convention === 0);
// doc A is the planting confirm: the audit row the service writes
auth.addAuditEntry(db, { action: 'buyer_issued_convention_recorded', action_category: 'review', outcome: 'success', document_id: docA, metadata: { document_id: docA, issuer: X, typeSlug: 'purchase_order' } });
const ra = learning.retractConfirmHints(db, docA);
check('the planting confirm: send-back retracts the record (usage 1 → row gone)', ra.convention === 1 && !rowFor(X, 'purchase_order'));
check('…and writes the retracted audit row', db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'buyer_issued_convention_retracted' AND document_id = ?").get(docA).n === 1);
const ra2 = learning.retractConfirmHints(db, docA);
check('a repeated send-back is a no-op (recorded − retracted = 0)', ra2.convention === 0);
learning.replantConfirmHints(db, docA);
check('replantConfirmHints does NOT replant the record (fail toward review)', !rowFor(X, 'purchase_order'));

console.log('§5 the forget-sender inverse');
learning.recordBuyerIssuedConvention(db, { issuer: X, typeSlug: 'purchase_order' });
learning.clearSupplierHintsForScope(db, { supplier_name: learning.normalizeSupplierName(X) || X, document_type: 'purchase_order' });
check('clearSupplierHintsForScope deletes it', !rowFor(X, 'purchase_order'));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
