#!/usr/bin/env node
'use strict';
/**
 * src/services/test_buyer_issued_convention_confirm.js — the ONE-CONFIRM buyer-issued convention hook in
 * reviewService.confirm (owner 2026-09-07; gary → Oracle SIGN-OFF-W/COND C1-C8; DARK
 * `buyer_issued_convention_one_confirm`).
 *
 * H1  human single confirm of a doc whose supplier row carries the note, letterhead kept → ONE record + the
 *     audit row + a 'convention' review event with undo type 'convention' + the re-check count of the still-
 *     noted queued siblings (C6); the note is NULL afterwards (the pre-claim capture is load-bearing).
 * H2  wording 2 (no vendor captured) also records (Oracle fork i).
 * N1  bulk:true (File All / Quick-check) → nothing.      N2  internal via 'scope_sweep' → nothing.
 * N3  issuer EDITED to the vendor → nothing (per-direction; the vendor gets an ordinary supplier_name hint).
 * N4  no note → nothing.   N5  a neighbouring note (prefill wording) → nothing.   N6  setting OFF → nothing.
 * C3  the doc was READ as a different type than the confirmed type → nothing.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/services/test_buyer_issued_convention_confirm.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const learning = require(path.join(ROOT, 'database', 'modules', 'learning'));
const { createReviewService } = require('./reviewService');
let fails = 0;
const check = (label, cond, detail) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && detail ? '\n      ' + detail : ''}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Purchase Order', 'purchase_order', 1)").run();
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (2, 'Invoice', 'invoice', 1)").run();
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('review_group_by_letterhead', 'false')").run();
learning.setSetting(db, 'output_folder', '/out');
learning.setSetting(db, 'buyer_issued_convention_one_confirm', 'true');

const X = 'Ironbridge Fabrication', V = 'Ashcombe Care Homes Ltd';
const W1 = `This purchase order is on ${X}'s letterhead but names '${V}' as the supplier — confirm which company to file under.`;
const W2 = `A purchase order usually files under the buyer — please confirm '${X}' is the right company for this one.`;
const PREFILL = 'This letterhead may read differently — please confirm the issuer.';

const calls = { audit: [], events: [], saveCorrections: [] };
const deps = {
  documents,
  learning: Object.assign(Object.create(learning), {
    saveCorrections: (_db, id, corr, s, slug, allValues) => { calls.saveCorrections.push({ id, corr, allValues }); },
  }),
  doctypes: { getWithFields: (_d, slug) => slug === 'purchase_order' ? { id: 1, name: 'Purchase Order', slug: 'purchase_order', ref_field_key: 'po_number', date_field_key: 'po_date', fields: [] }
                                        : slug === 'invoice' ? { id: 2, name: 'Invoice', slug: 'invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date', fields: [] } : null },
  filing: { normaliseDate: require('../modules/filing/handler').normaliseDate,
            commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml', srcPath: '/in/x.pdf' }) },
  fs: { existsSync: () => true, unlinkSync: () => {} }, path, logger: null,
  audit: (_d, e) => calls.audit.push(e),
  recordReviewEvent: (_d, ev) => { calls.events.push(ev); return ev; },
  releaseDelayMs: 0,
};
const svc = createReviewService(deps);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mkDoc({ typeId = 1, note = W1, method = 'template_fixed', display = X, status = 'needs_review' } = {}) {
  const id = Number(documents.insert(db, { original_filename: `d${Date.now()}${Math.random()}.pdf`, folder_path: '/in', status, supplier_name: X, document_type_id: typeId }).lastInsertRowid);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, was_corrected, validation_note)
              VALUES (?, 'supplier_name', ?, ?, 95, ?, 0, ?)`).run(id, display, display, method, note);
  return id;
}
const confirm = (id, { supplier = X, slug = 'purchase_order', typeName = 'Purchase Order', bulk = false, internal = {} } = {}) =>
  svc.confirm(db, { username: 'sarah', role: 'admin' }, { document_id: id, corrections: supplier === X ? {} : { supplier_name: { original_value: X, corrected_value: supplier } },
    allValues: { supplier_name: supplier, po_number: 'PO-1', po_date: '26-03-2026' }, supplier_name: X, document_type: typeName, document_type_slug: slug, taught_fields: [], bulk }, internal);
const recs = () => db.prepare("SELECT * FROM supplier_hints WHERE field_key = 'buyer_issued_convention'").all();
const audits = (a) => calls.audit.filter(e => e.action === a);

(async () => {
  console.log('H1 human single confirm, letterhead kept');
  const sib1 = mkDoc(), sib2 = mkDoc(), other = mkDoc({ typeId: 2 });   // 2 noted PO siblings + a noted invoice (not counted)
  const d1 = mkDoc();
  const r = await confirm(d1);
  check('the confirm succeeded', r && r.success === true, JSON.stringify(r).slice(0, 200));
  check('ONE record row: buyer_issued_convention / purchase_order / Ironbridge, usage 1', recs().length === 1 && recs()[0].document_type === 'purchase_order' && recs()[0].hint_value === X && recs()[0].usage_count === 1);
  check("the audit row 'buyer_issued_convention_recorded' names the doc + issuer + type", audits('buyer_issued_convention_recorded').length === 1 && audits('buyer_issued_convention_recorded')[0].document_id === d1 && audits('buyer_issued_convention_recorded')[0].metadata.issuer === X && audits('buyer_issued_convention_recorded')[0].metadata.typeSlug === 'purchase_order');
  const ev = calls.events.find(e => e.kind === 'convention');
  check("a 'convention' review event with undo type 'convention', ids [doc], scope (issuer, type) (C5)", ev && ev.undo && ev.undo.type === 'convention' && ev.ids[0] === d1 && ev.scope.supplier === X && ev.scope.typeSlug === 'purchase_order' && ev.approved === true);
  check('the result carries convention {issuer, typeSlug, usage 1, pending 2} — only the SAME-type noted siblings count (C6)', r.convention && r.convention.issuer === X && r.convention.typeSlug === 'purchase_order' && r.convention.usage === 1 && r.convention.pending === 2, JSON.stringify(r.convention));
  check('the note is NULL after the confirm (the pre-claim capture was what the hook read)', db.prepare('SELECT validation_note n FROM extractions WHERE document_id = ? AND field_key = ?').get(d1, 'supplier_name').n == null);
  check('the value is untouched', db.prepare('SELECT display_value v FROM extractions WHERE document_id = ? AND field_key = ?').get(d1, 'supplier_name').v === X);

  console.log('H2 wording 2 (no vendor captured) also records');
  const d2 = mkDoc({ note: W2 });
  await confirm(d2);
  check('usage 1 → 2', recs().length === 1 && recs()[0].usage_count === 2);

  console.log('N1 bulk:true → nothing');
  const n1 = mkDoc(); await confirm(n1, { bulk: true });
  check('no new record (usage stays 2), no audit', recs()[0].usage_count === 2 && audits('buyer_issued_convention_recorded').length === 2);

  console.log("N2 machine via 'scope_sweep' → nothing");
  const n2 = mkDoc(); await confirm(n2, { internal: { via: 'scope_sweep' } });
  check('usage stays 2', recs()[0].usage_count === 2);

  console.log('N3 issuer EDITED to the vendor → nothing (per-direction)');
  const n3 = mkDoc(); await confirm(n3, { supplier: V });
  check('usage stays 2; the vendor edit went to saveCorrections as an ordinary correction', recs()[0].usage_count === 2 && calls.saveCorrections.some(c => c.id === n3 && c.corr && c.corr.supplier_name && c.corr.supplier_name.corrected_value === V));

  console.log('N4 no note → nothing');
  const n4 = mkDoc({ note: null }); await confirm(n4);
  check('usage stays 2', recs()[0].usage_count === 2);

  console.log('N5 a neighbouring note (prefill wording) → nothing');
  const n5 = mkDoc({ note: PREFILL }); await confirm(n5);
  check('usage stays 2', recs()[0].usage_count === 2);

  console.log('C3 read as INVOICE, confirmed as Purchase Order → nothing (a re-typed doc is not an answer)');
  const c3 = mkDoc({ typeId: 2 }); await confirm(c3);
  check('usage stays 2', recs()[0].usage_count === 2);

  console.log('N6 setting OFF → nothing');
  learning.setSetting(db, 'buyer_issued_convention_one_confirm', 'false');
  const n6 = mkDoc(); await confirm(n6);
  check('usage stays 2, no audit row', recs()[0].usage_count === 2 && audits('buyer_issued_convention_recorded').length === 2);
  learning.setSetting(db, 'buyer_issued_convention_one_confirm', 'true');

  console.log('C2/C5 the undo road: retracting through the planting audit row');
  // the service's audit collector did not write to audit_log; write the row the real logAudit would have
  require(path.join(ROOT, 'database', 'modules', 'auth')).addAuditEntry(db, { action: 'buyer_issued_convention_recorded', action_category: 'review', outcome: 'success', document_id: d1, metadata: { document_id: d1, issuer: X, typeSlug: 'purchase_order' } });
  const u = learning.retractBuyerIssuedConventionForDoc(db, d1, { reason: 'undo' });
  check('undo retracts one (usage 2 → 1) and audits the retract', u.retracted === 1 && recs()[0].usage_count === 1 && db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'buyer_issued_convention_retracted' AND document_id = ?").get(d1).n === 1);
  check('a second undo of the same doc is a no-op', learning.retractBuyerIssuedConventionForDoc(db, d1).retracted === 0 && recs()[0].usage_count === 1);

  await sleep(50);
  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
