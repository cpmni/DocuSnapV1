#!/usr/bin/env node
'use strict';
/**
 * test_issuer_sibling_fill.js — the first-batch letterhead sibling-fill, on a REAL migrated DB, run in
 * the LIVE prefill config (Oracle C5: the rows MUST be letterhead_prefill rows — a test that seeded
 * suggested_supplier would green an inert feature, since mig-77 forces prefill mode where that field is
 * never written). DARK behind ISSUER_SIBLING_FILL / issuer_sibling_fill.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_issuer_sibling_fill.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const doctypes = require('../../database/modules/document_types');
const learning = require('../../database/modules/learning');
const svc = require('./issuerSiblingFillService');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const C = 'Saltmarsh Seafoods';
const NOTE = "Couldn't confirm who issued this page — the top reads 'Saltmarsh Seafoods'. Please confirm the correct company (check it's the sender, not the customer).";

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  doctypes.seedBuiltInTypes(db);
  return db;
}
// A HELD first-contact doc: needs_review, template_id NULL, a letterhead-prefill supplier_name @69 + note.
function seedHeld(db, { display = C, phash = 'aaaaaaaaaaaaaaaa', method = 'letterhead_prefill', note = NOTE,
                        status = 'needs_review', putBack = false, overall = 72, kwfp = null } = {}) {
  const inv = doctypes.getWithFields(db, 'invoice');
  const r = db.prepare(`INSERT INTO documents
      (document_type_id, original_filename, folder_path, status, supplier_name, doc_date, reference_number,
       overall_confidence, logo_phash, keyword_fingerprint, put_back_at)
    VALUES (?, 'inv.pdf', 'C:/in', ?, ?, '01-02-2026', 'INV-1', ?, ?, ?, ?)`)
    .run(inv.id, status, display, overall, phash, kwfp ? JSON.stringify(kwfp) : null, putBack ? new Date().toISOString() : null);
  const docId = r.lastInsertRowid;
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, was_corrected)
              VALUES (?, 'supplier_name', ?, ?, 69, ?, ?, 0)`).run(docId, display, display, method, note || null);
  // give it a date + ref so nothing but the issuer holds it (keeps the test focused)
  db.prepare(`INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method) VALUES (?, 'invoice_date', '01-02-2026', 95, 'keyword')`).run(docId);
  db.prepare(`INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method) VALUES (?, 'invoice_number', 'INV-1', 95, 'keyword')`).run(docId);
  return docId;
}
const sup = (db, id) => db.prepare("SELECT display_value, confidence, validation_note, extraction_method, corrected_to FROM extractions WHERE document_id=? AND field_key='supplier_name'").get(id);
const overallOf = (db, id) => db.prepare('SELECT overall_confidence FROM documents WHERE id=?').get(id).overall_confidence;
const src = { method: 'letterhead_prefill', display: C, note: NOTE, phash: 'aaaaaaaaaaaaaaaa' };
const deps = () => ({ learning, audit: () => {}, actorName: 'sarah' });

// ── ON: the happy path — matching same-layout siblings adopt ──────────────────────────────────
(function () {
  process.env.ISSUER_SIBLING_FILL = '1';
  svc._reset();
  const db = fresh();
  const source = seedHeld(db);
  const sibExact = seedHeld(db, { phash: 'aaaaaaaaaaaaaaaa' });         // dist 0
  const sibNear  = seedHeld(db, { phash: 'aaaaaaaaaaaaaaab' });         // dist 1 (<= 4)
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src, typeSlug: 'invoice', ...deps() });
  check('happy: fired, batchId present', !!(r && r.batchId));
  check('happy: filled 2 siblings', !!(r && r.docs && r.docs.length === 2));
  for (const id of [sibExact, sibNear]) {
    const s = sup(db, id);
    check(`  sib ${id}: confidence raised >= 70`, s.confidence >= 70);
    check(`  sib ${id}: note cleared`, s.validation_note == null);
    check(`  sib ${id}: marker on method`, String(s.extraction_method).endsWith(svc.MARKER));
    check(`  sib ${id}: value UNCHANGED = C`, s.display_value === C);
    check(`  sib ${id}: NO corrected_to (C4)`, !s.corrected_to);
    check(`  sib ${id}: overall_confidence UNTOUCHED (C4 — no silent auto-file)`, overallOf(db, id) === 72);
  }
  check('happy: SOURCE doc untouched', sup(db, source).extraction_method === 'letterhead_prefill');
  db.close();
})();

// ── PIN b: a DIFFERENT-letterhead sibling (its own read != C) is REFUSED ───────────────────────
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const source = seedHeld(db);
  const other = seedHeld(db, { display: 'Bramblewood Joinery Ltd' });   // reads a DIFFERENT company
  svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src, typeSlug: 'invoice', ...deps() });
  check('PIN b: different-letterhead sibling REFUSED (still held)', sup(db, other).validation_note != null && sup(db, other).confidence === 69);
  db.close();
})();

// ── PIN c: a CORRECTED confirm (C != the prefilled read) does NOT propagate at all ─────────────
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const source = seedHeld(db);
  const sib = seedHeld(db);
  // The human CHANGED the issuer to '...Seafoods Ltd'; src.display was plain 'Saltmarsh Seafoods'.
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: 'Saltmarsh Seafoods Ltd', src, typeSlug: 'invoice', ...deps() });
  check('PIN c: corrected-confirm => no fire', r === null);
  check('PIN c: no sibling touched', sup(db, sib).validation_note != null);
  db.close();
})();

// ── PIN d: a same-STRING sibling with a DIFFERENT logo (far phash) is REFUSED ───────────────────
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const source = seedHeld(db);
  const impostor = seedHeld(db, { phash: '5555555555555555' });   // dist 64 from 'aaaa…'
  const good = seedHeld(db, { phash: 'aaaaaaaaaaaaaaaa' });
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src, typeSlug: 'invoice', ...deps() });
  check('PIN d: only the same-logo sibling filled', r && r.docs.length === 1 && r.docs[0].id === good);
  check('PIN d: different-logo same-string sibling REFUSED (the two-senders collision guard)', sup(db, impostor).validation_note != null && sup(db, impostor).confidence === 69);
  db.close();
})();

// ── PIN e: a null-phash sibling is REFUSED (no layout signature) ───────────────────────────────
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const source = seedHeld(db);
  const noph = seedHeld(db, { phash: null });
  svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src, typeSlug: 'invoice', ...deps() });
  check('PIN e: null-phash sibling REFUSED', sup(db, noph).validation_note != null);
  db.close();
})();

// ── PIN h: the BRANDING arm rescues a LOGO-DRIFTED genuine sibling (Oracle C2 OR-leg) ───────────
// A supplier's own second invoice: near-identical distinctive branding fingerprint, but its scanned logo
// drifted past the phash band (0-28 same-supplier spread). convergesByBranding (ratio 1.0, shared >= 3)
// admits it; the logo arm alone would have wrongly refused it.
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const FP = ['saltmarsh', 'seafoods', 'harbour', 'quayside', 'belfast'];             // 5 distinctive tokens
  const srcKw = { method: 'letterhead_prefill', display: C, note: NOTE, phash: 'aaaaaaaaaaaaaaaa', keyword_fingerprint: FP };
  const source  = seedHeld(db, { kwfp: FP });
  const drifted = seedHeld(db, { phash: '5555555555555555', kwfp: FP });              // logo dist 64 (>13); branding ratio 1.0
  const weakBr  = seedHeld(db, { phash: '5555555555555555', kwfp: ['alpha', 'beta', 'gamma', 'delta'] });  // far logo + 0 shared distinctive
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src: srcKw, typeSlug: 'invoice', ...deps() });
  check('PIN h: branding-convergence admits the logo-drifted genuine sibling', !!(r && r.docs && r.docs.some(d => d.id === drifted)));
  check('PIN h: branding arm fires alone (only the converging sibling filled)', !!(r && r.docs && r.docs.length === 1));
  check('PIN h: far-logo NON-converging sibling REFUSED (control)', sup(db, weakBr).validation_note != null && sup(db, weakBr).confidence === 69);
  db.close();
})();

// ── PIN h2: THE COLLISION (Oracle SEND-BACK mandated gate) — two senders garble to the SAME string C, ─
// different logos. Their fingerprints share only the garbled NAME + generic company boilerplate. Raw
// keywordOverlap>=0.60 ADMITTED these (the subset sibling scored 1.0 directionally, the boilerplate one
// 0.83) — misfiling sender-2 under sender-1. convergesByBranding (symmetric ratio, >=3 distinctive floor)
// REFUSES both while still admitting the genuine same-supplier sibling. RED on the old raw-0.60 code.
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const CC = 'Acme Plumbing Ltd';
  const srcFP = ['acme', 'plumbing', 'ltd', 'vat', 'tel', 'email', 'northgate', 'depot'];   // 8 distinctive
  const srcKw = { method: 'letterhead_prefill', display: CC, note: NOTE, phash: 'aaaaaaaaaaaaaaaa', keyword_fingerprint: srcFP };
  const source = seedHeld(db, { display: CC, kwfp: srcFP });
  // genuine same-supplier sibling: near-identical fingerprint, drifted logo => branding admits.
  const genuine = seedHeld(db, { display: CC, phash: '5555555555555555', kwfp: srcFP });
  // COLLISION A — a DIFFERENT sender, degraded OCR => SHORT fingerprint that is a SUBSET of the source
  // (old keywordOverlap = 3/3 = 1.0 => admitted). ratio here = 3/8 = 0.375 => refused.
  const collSubset = seedHeld(db, { display: CC, phash: '5555555555555555', kwfp: ['acme', 'plumbing', 'ltd'] });
  // COLLISION B — a DIFFERENT sender sharing name + generic boilerplate only (old overlap = 5/6 = 0.83 =>
  // admitted). shared distinctive = 5, ratio = 5/8 = 0.625 => refused.
  const collBoiler = seedHeld(db, { display: CC, phash: '5555555555555555', kwfp: ['acme', 'plumbing', 'ltd', 'vat', 'tel', 'fax'] });
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: CC, src: srcKw, typeSlug: 'invoice', ...deps() });
  check('PIN h2: genuine same-supplier sibling ADMITTED', !!(r && r.docs && r.docs.some(d => d.id === genuine)));
  check('PIN h2: ONLY the genuine sibling filled (both collisions refused)', !!(r && r.docs && r.docs.length === 1));
  check('PIN h2: subset-fingerprint collision REFUSED (kills the directional-1.0 bug)', sup(db, collSubset).validation_note != null && sup(db, collSubset).confidence === 69);
  check('PIN h2: name+boilerplate collision REFUSED (kills the name-token inflation)', sup(db, collBoiler).validation_note != null && sup(db, collBoiler).confidence === 69);
  db.close();
})();

// ── PIN h3: a MATURE sibling whose template identity DISAGREES with C is refused (Oracle cond 2) ──────
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const FP = ['saltmarsh', 'seafoods', 'harbour', 'quayside', 'belfast'];
  const srcKw = { method: 'letterhead_prefill', display: C, note: NOTE, phash: 'aaaaaaaaaaaaaaaa', keyword_fingerprint: FP };
  const source = seedHeld(db, { kwfp: FP });
  // a sibling whose OWN letterhead garble-reads C, layout converges — BUT it is linked to a mature template
  // whose confirmed identity is a DIFFERENT company. Filling it with C would override that identity.
  const inv = doctypes.getWithFields(db, 'invoice');
  const t = db.prepare(`INSERT INTO templates (name, slug, document_type_slug) VALUES ('Bramblewood Joinery Ltd', 'bramblewood-joinery-inv', 'invoice')`).run();
  const matureSib = seedHeld(db, { kwfp: FP });
  db.prepare('UPDATE documents SET template_id = ? WHERE id = ?').run(t.lastInsertRowid, matureSib);
  // a confirmed doc under that template establishes its identity as Bramblewood.
  const conf = db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, template_id) VALUES (?, 'b.pdf', 'C:/in', 'confirmed', 'Bramblewood Joinery Ltd', ?)`).run(inv.id, t.lastInsertRowid);
  db.prepare(`INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method, was_corrected) VALUES (?, 'supplier_name', 'Bramblewood Joinery Ltd', 95, 'keyword', 0)`).run(conf.lastInsertRowid);
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src: srcKw, typeSlug: 'invoice', ...deps() });
  check('PIN h3: mature sibling with a DISAGREEING template identity REFUSED', sup(db, matureSib).validation_note != null && sup(db, matureSib).confidence === 69);
  db.close();
})();

// ── PIN i: a source with NEITHER signature (no phash, no kwfp) fires nothing (C2 source guard) ──
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const noSigSrc = { method: 'letterhead_prefill', display: C, note: NOTE, phash: null, keyword_fingerprint: null };
  const source = seedHeld(db, { phash: null });
  const sib    = seedHeld(db, { kwfp: ['invoice number', 'total due'] });
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src: noSigSrc, typeSlug: 'invoice', ...deps() });
  check('PIN i: no source layout proof (no phash AND no kwfp) => refused', r === null && sup(db, sib).validation_note != null);
  db.close();
})();

// ── PIN f: OFF is inert ────────────────────────────────────────────────────────────────────────
(function () {
  process.env.ISSUER_SIBLING_FILL = '0'; svc._reset();
  const db = fresh();
  const source = seedHeld(db);
  const sib = seedHeld(db);
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src, typeSlug: 'invoice', ...deps() });
  check('PIN f: OFF => null, nothing written', r === null && sup(db, sib).validation_note != null);
  db.close();
})();

// ── PIN g: undo restores the held state; a filed sibling is left alone ──────────────────────────
(function () {
  process.env.ISSUER_SIBLING_FILL = '1'; svc._reset();
  const db = fresh();
  const source = seedHeld(db);
  const a = seedHeld(db), b = seedHeld(db);
  const r = svc.applyForConfirm(db, { documentId: source, confirmedIssuer: C, src, typeSlug: 'invoice', ...deps() });
  check('undo setup: 2 filled', r && r.docs.length === 2);
  // b files in the meantime
  db.prepare("UPDATE documents SET status='confirmed' WHERE id=?").run(b);
  const u = svc.undoBatch(db, r.batchId, { audit: () => {} });
  check('undo: restored the still-queued sibling', u.ok && u.restored === 1 && u.skipped === 1);
  check('undo: a note back + conf back on the restored one', sup(db, a).validation_note != null && sup(db, a).confidence === 69 && !String(sup(db, a).extraction_method).endsWith(svc.MARKER));
  db.close();
})();

console.log(fails ? `\n${fails} FAILED\n` : '\nALL PASS\n');
process.exit(fails ? 1 : 0);
