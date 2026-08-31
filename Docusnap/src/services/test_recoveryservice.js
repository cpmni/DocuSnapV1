#!/usr/bin/env node
'use strict';
// recoveryService — the "Fix a document type" composition. Reproduces the owner's
// scenario (a doc filed 6 times across 2 types, plus a good doc from another supplier)
// and proves apply() sets aside the offending docs + forgets the scope's learning while
// leaving the other type, other supplier, and logo_fingerprints untouched — and Undo
// (restore) reverses the set-aside.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_recoveryservice.js

const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const documents = require('../../database/modules/documents');
const doctypes  = require('../../database/modules/document_types');
const learning  = require('../../database/modules/learning');
const { createRecoveryService } = require('./recoveryService');

let fail = 0;
const check = (l, c, extra) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}${extra ? '  ' + extra : ''}`); if (!c) fail++; };

const db = new Database(':memory:');
runMigrations(db);
doctypes.seedBuiltInTypes(db);
const invId = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get().id;
const soId  = db.prepare("SELECT id FROM document_types WHERE slug='sales_order'").get().id;

let seq = 0;
function confirmedDoc({ supplier, typeId, field, value }) {
  const id = documents.insert(db, { original_filename: `d${++seq}.pdf`, folder_path: '/in', document_type_id: typeId, supplier_name: supplier, status: 'needs_review' }).lastInsertRowid;
  documents.update(db, id, { status: 'confirmed', confirmed_at: new Date().toISOString(), supplier_name: supplier, document_type_id: typeId });
  db.prepare("INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method) VALUES (?,?,?,?,?)").run(id, field, value, 90, 'keyword');
  return id;
}
const insHint = db.prepare("INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count) VALUES (?,?,?,?,2)");
const insRule = db.prepare("INSERT INTO field_rules (supplier_name, document_type, field_key, rule_type, token_norm) VALUES (?,?,?,?,?)");
const insAnc  = db.prepare("INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction, page_zone) VALUES (?,?,?,?,?,?)");
const insLogo = db.prepare("INSERT INTO logo_fingerprints (supplier_name, phash, ahash, match_count) VALUES (?,?,?,?)");

// The poisoned scan: filed 3× as invoice + 3× as sales_order with spurious values.
const invBad = [1,2,3].map(i => confirmedDoc({ supplier: 'Acme', typeId: invId, field: 'total_amount', value: `$9${i}9.00` }));
const soBad  = [1,2,3].map(i => confirmedDoc({ supplier: 'Acme', typeId: soId,  field: 'total_amount', value: `$5${i}5.00` }));
// A GOOD invoice from a different supplier — must be untouched.
const betaGood = confirmedDoc({ supplier: 'Beta', typeId: invId, field: 'total_amount', value: '$10.00' });

insHint.run('Acme', 'invoice', 'total_amount', '$919.00');
insHint.run('Acme', 'sales_order', 'total_amount', '$515.00');
insHint.run('Beta', 'invoice', 'total_amount', '$10.00');
insRule.run('Acme', 'invoice', 'supplier_name', 'remove_text', 'ltd');
insAnc.run('Acme', 'invoice', 'total_amount', 'Total', 'right', 'full');
insAnc.run('Acme', 'sales_order', 'total_amount', 'Total', 'right', 'full');
insLogo.run('Acme', 'abc123', 'def456', 6);

const svc = createRecoveryService({ documents, learning });
const cnt = (table, sn, dt) => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE (@sn IS NULL OR supplier_name=@sn) AND (@dt IS NULL OR document_type=@dt)`).get({ sn: sn||null, dt: dt||null }).n;

// ── overview ────────────────────────────────────────────────────────────────
const ov = svc.overview(db, { document_type_slug: 'invoice', supplier_name: 'Acme' });
check('overview: confirmed count for Acme/invoice = 3', ov.confirmedCount === 3, `(${ov.confirmedCount})`);
check('overview: learned inventory populated', ov.learned.hints === 1 && ov.learned.anchors === 1 && ov.learned.fieldRules === 1);
check('overview needs a type', !!svc.overview(db, {}).error);

// ── apply: set aside the 3 bad invoice docs + forget Acme/invoice learning ────
const res = svc.apply(db, { username: 'admin' }, { document_type_slug: 'invoice', supplier_name: 'Acme', documentIds: invBad, forgetLearning: true });
check('apply ok', res.ok === true);
check('  → set aside 3 documents', res.summary.setAside === 3, JSON.stringify(res.summary));
check('  → forgot Acme/invoice hints+anchors+rules+corrections', cnt('supplier_hints','Acme','invoice')===0 && cnt('field_anchors','Acme','invoice')===0 && cnt('field_rules','Acme','invoice')===0);

// PRESERVE everything else
check('other TYPE (Acme/sales_order) learning intact', cnt('supplier_hints','Acme','sales_order')===1 && cnt('field_anchors','Acme','sales_order')===1);
check('other SUPPLIER (Beta/invoice) learning intact', cnt('supplier_hints','Beta','invoice')===1);
check('logo_fingerprints NEVER touched', db.prepare("SELECT COUNT(*) n FROM logo_fingerprints WHERE supplier_name='Acme'").get().n === 1);
check('the good Beta doc still confirmed', documents.getById(db, betaGood).status === 'confirmed');
check('the 3 bad invoice docs are set aside (deleted)', invBad.every(id => documents.getById(db, id).status === 'deleted'));
check('the sales_order copies untouched (still confirmed)', soBad.every(id => documents.getById(db, id).status === 'confirmed'));

// derived model: the spurious invoice values no longer surface
const hist = learning.getFieldValueHistory(db, { supplier_name: 'Acme', document_type: 'invoice', field_key: 'total_amount' });
check('spurious invoice values gone from the derived history', !hist.some(v => /^\$9\d9\.00$/.test(v.value)));

// ── Undo: restore the set-aside docs ──────────────────────────────────────────
for (const id of res.setAsideIds) documents.restoreDeleted(db, id);
check('Undo restores the set-aside docs to confirmed', invBad.every(id => documents.getById(db, id).status === 'confirmed'));

// ── guard: nothing selected ───────────────────────────────────────────────────
check('apply with nothing selected → error', svc.apply(db, {}, { document_type_slug: 'invoice' }).ok === false);

// ── diagnosis: same doc filed under two types is flagged (read-only suggestion) ──
const dupInv = confirmedDoc({ supplier: 'Dup', typeId: invId, field: 'total_amount', value: '$1.00' });
const dupSO  = confirmedDoc({ supplier: 'Dup', typeId: soId,  field: 'total_amount', value: '$1.00' });
documents.update(db, dupInv, { reference_number: 'DUP-REF-1' });
documents.update(db, dupSO,  { reference_number: 'DUP-REF-1' });
check('diagnosis flags a doc also filed under another type', (svc.overview(db, { document_type_slug: 'invoice', supplier_name: 'Dup' }).suggestedIds || []).includes(dupInv));
check('diagnosis leaves a normal doc unflagged', !(svc.overview(db, { document_type_slug: 'invoice', supplier_name: 'Beta' }).suggestedIds || []).includes(betaGood));

// ── requeue variant (whole-type de-confirm) ───────────────────────────────────
const rq = svc.apply(db, {}, { document_type_slug: 'sales_order', requeue: true });
check('requeue de-confirms the sales_order docs', rq.summary.requeued === 4 && soBad.every(id => documents.getById(db, id).status === 'needs_review'), `(${rq.summary.requeued})`);

// ── CASE-INSENSITIVE forget (COLLATE NOCASE) ──────────────────────────────────
// The doc list populates case-insensitively (LIKE), so typing 'superstore' must forget the
// learning stored under 'SuperStore' too — else the owner sees the docs but nothing clears.
confirmedDoc({ supplier: 'SuperStore', typeId: invId, field: 'total_amount', value: '$7.00' });
insHint.run('SuperStore', 'invoice', 'total_amount', '$7.00');
insAnc.run('SuperStore', 'invoice', 'invoice_number', 'INVOICE', 'right', 'full');
check('case: overview counts SuperStore learning when queried as "superstore"',
  svc.overview(db, { document_type_slug: 'invoice', supplier_name: 'superstore' }).learned.anchors === 1);
const ssRes = svc.apply(db, { username: 'admin' }, { document_type_slug: 'invoice', supplier_name: 'superstore', forgetLearning: true });
check('case: forgetting as "superstore" clears the "SuperStore" learning',
  ssRes.ok === true && cnt('supplier_hints','SuperStore','invoice') === 0 && cnt('field_anchors','SuperStore','invoice') === 0);

db.close();
console.log(`\n${fail ? fail + ' FAILED' : 'All recoveryService checks passed.'}`);
process.exit(fail ? 1 : 0);
