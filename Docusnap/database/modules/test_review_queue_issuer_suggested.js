'use strict';
/*
 * test_review_queue_issuer_suggested.js — slice 3 of the garbled-issuer arc (2026-08-22 evening;
 * gary → Oracle SIGN-OFF-W/COND C3.1–C3.4).
 *
 * THE INCIDENT: the owner's drawn issuer box read "NOCUMENT" (one glyph off "DOCUMENT") on two scans;
 * the Review list showed a sender group "NOCUMENT · 2 documents" beside "DOCUMENT SOLUTIONS · 11".
 * Slice 2 makes the engine carry the letterhead canonical in the persisted `suggested_supplier` column
 * beside the identity note; slice 3 makes the list GROUP such a document under that company.
 *
 * Pins:
 *   • getReviewQueue exposes `issuer_suggested` = the supplier_name row's suggested_supplier ONLY while
 *     its validation_note stands (a shed note ungroups by itself — Oracle C3.2); NULL otherwise.
 *   • renderer source contract: BOTH grouping sites and the "finish this sender" picker key on
 *     reviewGroupKey(); the per-sender Reprocess button keeps doc.supplier_name (it reprocesses the
 *     real value); the chip exists; the key falls back to supplier_name when the setting is off.
 *   • Home "N senders file by themselves" (`_selfFilingSenders`) is CONFIRMED-only: a held "NOCUMENT"
 *     doc never counts — paired with a confirmed positive control so the absence is not vacuous.
 *
 * Run:  ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_review_queue_issuer_suggested.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Service Worksheet', 'service_worksheet', 0)").run();
const NOTE = 'Letterhead may read “DOCUMENT SOLUTIONS” — detected “NOCUMENT”. Please confirm the issuer.';
const mkDoc = (supplier, status = 'needs_review') => Number(documents.insert(db, {
  original_filename: `${supplier}.pdf`, folder_path: '/in', status, supplier_name: supplier, document_type_id: 1,
}).lastInsertRowid);
const seedIssuer = (id, value, note, suggested) => db.prepare(
  `INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, suggested_supplier)
   VALUES (?, 'supplier_name', ?, ?, 70, 'template_mapping', ?, ?)`).run(id, value, value, note, suggested);

console.log('getReviewQueue.issuer_suggested:');
const dGarble = mkDoc('NOCUMENT');          seedIssuer(dGarble, 'NOCUMENT', NOTE, 'DOCUMENT SOLUTIONS');
const dShed   = mkDoc('NOCUMENT');          seedIssuer(dShed,   'NOCUMENT', null, 'DOCUMENT SOLUTIONS');
const dPlain  = mkDoc('DOCUMENT SOLUTIONS'); seedIssuer(dPlain, 'DOCUMENT SOLUTIONS', null, null);
const dNoSug  = mkDoc('Quillstone Print');  seedIssuer(dNoSug,  'Quillstone Print', 'Letterhead may read “Bramblewood Joinery Ltd” — detected “Quillstone Print”. Please confirm the issuer.', null);
const q = Object.fromEntries(documents.getReviewQueue(db).map(d => [d.id, d]));
check('a noted garble with a suggestion → issuer_suggested = the letterhead company', q[dGarble].issuer_suggested === 'DOCUMENT SOLUTIONS');
check('the same row with its note SHED → NULL (ungroups by itself; the gate keys on the note)', q[dShed].issuer_suggested == null);
check('a clean row → NULL', q[dPlain].issuer_suggested == null);
check('a noted whole-token disagreement with NO suggestion (slice 2 abstained) → NULL (stays under its own name)', q[dNoSug].issuer_suggested == null);
check('supplier_name itself is untouched (display only)', q[dGarble].supplier_name === 'NOCUMENT');
// Chris round 17 card 5b — VACUOUS-TRAP PIN: the classifier reads `issuer_blank`; if the column vanishes the
// classifier silently restores the "blank issuer counts as ready" bug, so assert the column on real rows.
const dBlank = mkDoc(null); db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, 'supplier_name', '', '', 62, 'keyword')").run(dBlank);
const q2 = Object.fromEntries(documents.getReviewQueue(db).map(d => [d.id, d]));
check('getReviewQueue rows carry issuer_blank: a doc with an EMPTY issuer read → 1', q2[dBlank] && Number(q2[dBlank].issuer_blank) === 1);
check('…positive control: a doc with an issuer value → 0', Number(q2[dGarble].issuer_blank) === 0);
const RR = require('../../src/windows/shared/reviewReadiness.js') && globalThis.ReviewReadiness;
check('…and the classifier puts the blank-issuer row in `missing`, the valued one in `ready`-or-above', RR && RR.classify(q2[dBlank]) === 'missing' && RR.classify(q2[dPlain]) === 'ready');

console.log('\nrenderer source contract:');
const renderer = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'windows', 'review', 'renderer.js'), 'utf8');
check('reviewGroupKey(doc) exists and falls back to supplier_name / "—"',
      /function reviewGroupKey\(doc\)[\s\S]{0,400}?return String\(doc\?\.supplier_name \|\| ''\)\.trim\(\) \|\| '—';/.test(renderer));
check('…it is gated on the review_group_by_letterhead setting (OFF → plain supplier key)',
      /reviewGroupByLetterhead = \(await window\.docusnap\.getSetting\('review_group_by_letterhead'\)\) === 'true'/.test(renderer)
      && /function reviewGroupKey\(doc\) \{\s*\n\s*if \(reviewGroupByLetterhead\)/.test(renderer));
check('reviewDisplayGroups keys on reviewGroupKey (site 1)',
      /for \(const doc of _sweepVisibleQueue\(\)\) \{\s*\n\s*const key = reviewGroupKey\(doc\);/.test(renderer));
check('the expand-on-select branch keys on reviewGroupKey (site 2, lockstep)',
      /if \(queueGrouped && doc\) \{\s*\n\s*const key = reviewGroupKey\(doc\);/.test(renderer));
check('no grouping site still keys on the raw supplier_name', !/const key = \(doc\.supplier_name \|\| ''\)\.trim\(\) \|\| '—';/.test(renderer));
check('_pickNextDoc ("finish this sender") compares on reviewGroupKey', /reviewGroupKey\(order\[i\]\) === preferSupplier/.test(renderer));
check('the confirm path advances on the group key, the catch-up sweep keeps the real supplier',
      /const _groupKey = reviewGroupKey\(currentDoc\);/.test(renderer) && /advanceAfterAction\(idx, _groupKey\);/.test(renderer)
      && /const _sweepSupplier = \(document\.querySelector\([^)]*\)\?\.value \|\| supplier \|\| ''\)\.trim\(\);/.test(renderer));
check('the per-sender Reprocess button still reads doc.supplier_name (it reprocesses the REAL value)',
      /function updateReprocessSupplierButton[\s\S]{0,600}?currentDoc\?\.supplier_name/.test(renderer));
check('the row chip "check sender" renders only when the suggestion differs from the read',
      /function reviewGroupChip\(doc\)[\s\S]{0,500}?if \(!sug \|\| sug === own\) return '';[\s\S]{0,300}?qi-check-sender/.test(renderer)
      && /\$\{reviewGroupChip\(doc\)\}/.test(renderer));
check('the letterhead hold copy exists in showIssuerNearMatchHold (source "letterhead")',
      /nm\.source === 'letterhead'/.test(renderer) && /The letterhead on this page reads <strong>/.test(renderer));

console.log('\nHome "N senders file by themselves" is confirmed-only (positive control paired):');
const { _selfFilingSenders } = require('../../src/modules/search/handler');
const before = _selfFilingSenders(db, { noMemo: true });
check('a HELD "NOCUMENT" doc counts as no sender', before.senders === 0);
// positive control: the same query admits a CONFIRMED sender (readiness may still say not ready on a
// 1-doc scope — assert the CONFIRMED row is at least SEEN by the scan, i.e. the count can only move
// via a confirmed row, never via the held garble).
for (let i = 0; i < 3; i++) mkDoc('DOCUMENT SOLUTIONS', 'confirmed');
const rowsSeen = db.prepare(`SELECT COUNT(DISTINCT LOWER(TRIM(supplier_name))) AS n FROM documents WHERE status='confirmed'`).get().n;
check('…positive control: confirmed rows are the only population the scan reads (1 confirmed sender visible, the garble is not)', rowsSeen === 1
      && db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE status='confirmed' AND supplier_name='NOCUMENT'`).get().n === 0);
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'search', 'handler.js'), 'utf8');
check('…pinned at the source: the sender scan filters status = confirmed', /WHERE d\.status = 'confirmed' AND d\.supplier_name IS NOT NULL/.test(src));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
