'use strict';
/*
 * test_segment_hold_stamp.js — the DB half of the split-segment "look first" hold (2026-09-16; gary →
 * Oracle SIGN-OFF-W/COND C1-C10; mig 176 default ON). A multi-page segment of a HEURISTIC split may be
 * document A's page + a stranger page B — it reads 100 % clean from page A and used to AUTO-FILE on a
 * manual import (measured 2026-09-16: 12 of 16 such cuts filed at 100 %). The belt stamps a lane-hold note
 * on the ref-role row at import so the ONE predicate refuses it at every machine door until a human confirms.
 *
 * Pins: stamped → isAutoFileEligible 'flagged' (incl. the File-All bypass) + the readiness classifier
 * 'flagged' + the sweep's Tier-2 'stored-flagged' (Oracle C7) + review_hold; positive control; OFF
 * byte-identical; THE TRADE-OFF (a correct 2-page cut IS held — do not exempt clean multi-page cuts);
 * sheet-bounded cuts + a user's own `*_split_p2-3.pdf` without a rewrite NOT held (C6); target-row order
 * (C3); idempotent; the reprocess merge drops the note on a changed value and carrySegmentHold puts it back
 * (C1); source contracts (C10).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/processing/test_segment_hold_stamp.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require(path.join(REPO, 'database', 'index'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
const H = require('./handler.js');
const SP = require('./split_plan');
const { evaluateSweepConsistency } = require(path.join(REPO, 'src', 'services', 'sweepPredicate'));
const ReviewReadiness = require(path.join(REPO, 'src', 'windows', 'shared', 'reviewReadiness'));

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };
const read = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const db = new Database(':memory:');
quiet(() => runMigrations(db));
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req] of [['supplier_name', 1], ['invoice_number', 1], ['invoice_date', 1], ['total', 0]])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, 'text', ?, 1, 1)").run(k, k, req);
learning.setSetting(db, 'auto_file_threshold', '1');   // the laxest slider: only the note can refuse
const FOLDER = path.join(require('os').tmpdir(), 'sf-segment-hold-pin');   // no files here — the IO tail is best-effort

const fileDone = (name, over = {}) => ({
  type: 'file_done', success: true, status: 'needs_review', needs_review: false, original_filename: name,
  overall_confidence: 100, document_type: 'Invoice', supplier_name: 'Acme Widgets', page_count: 2,
  extractions: {
    supplier_name:  { value: 'Acme Widgets', confidence: 100, method: 'logo' },
    invoice_number: { value: 'INV-100', confidence: 100, method: 'keyword' },
    invoice_date:   { value: '01-08-2026', confidence: 100, method: 'keyword' },
  }, ...over,
});
const rowsOf = (id) => db.prepare('SELECT field_key, display_value, validation_note, extraction_method FROM extractions WHERE document_id = ? ORDER BY field_key').all(id);
const noteOf = (id, k) => (db.prepare('SELECT validation_note FROM extractions WHERE document_id = ? AND field_key = ?').get(id, k) || {}).validation_note;
const doc = (id) => documents.getById(db, id);
const queueRow = (id) => documents.getReviewQueue(db).find(r => r.id === id);
const strip = (rows) => rows.map(r => ({ ...r }));   // plain objects for JSON diffs

(async () => {
  console.log('§1 stamped at import → refused at every machine door');
  const hold = new Map([['stack_split_p2-3.pdf', { from: 2, to: 3 }]]);
  const m1 = fileDone('stack_split_p2-3.pdf');
  await H.handleFileMessage(db, m1, FOLDER, null, null, false, { segmentHold: hold });
  const id1 = m1.db_id;
  const n1 = noteOf(id1, 'invoice_number');
  check('the ref-role row carries the sentence', SP.hasSegmentHold(n1) && String(n1).endsWith('— confirm once.'), n1);
  check('…with the page range', /^Pages 2–3 /.test(String(n1)));
  const v1 = trust.isAutoFileEligible(db, doc(id1));
  check("isAutoFileEligible refuses it: 'flagged'", v1.eligible === false && v1.reason === 'flagged', JSON.stringify(v1));
  check('the File-All bypass (bypassPutBack) does NOT lift it', !trust.autoFileEligibleIds(db, [doc(id1)], { bypassPutBack: true }).includes(id1));
  const q1 = queueRow(id1);
  check("the readiness classifier says 'flagged' (File-All-Ready skips it)", !!q1 && ReviewReadiness.classify(q1) === 'flagged', q1 && ReviewReadiness.classify(q1));
  check('the import-strip chip verdict is a hold (msg.review_hold set)', !!m1.review_hold);
  check('msg.needs_review was raised for the legacy import bail', m1.needs_review === true);
  const sweep = evaluateSweepConsistency({ storedRows: rowsOf(id1), freshFields: { supplier_name: { value: 'Acme Widgets' }, invoice_number: { value: 'INV-100' }, invoice_date: { value: '01-08-2026' } },
    roleKeys: new Set(['supplier_name', 'invoice_number', 'invoice_date']), storedSlug: 'invoice', freshSlug: 'invoice' });
  check("the sweep's Tier-2 consistency check refuses on 'stored-flagged' (Oracle C7 — the one Tier-2 guard)", sweep.pass === false && sweep.reason === 'stored-flagged', JSON.stringify(sweep));

  console.log('\n§2 positive control + OFF byte-identical');
  const m2 = fileDone('stack_split_p4.pdf');
  await H.handleFileMessage(db, m2, FOLDER, null, null, false, { segmentHold: hold });
  check('a 1-page cut (not in the set) is untouched and eligible', !SP.hasSegmentHold(noteOf(m2.db_id, 'invoice_number')) && trust.isAutoFileEligible(db, doc(m2.db_id)).eligible === true && m2.review_hold == null);
  learning.setSetting(db, 'split_segment_multipage_hold', 'false');
  const m3 = fileDone('stack2_split_p2-3.pdf');
  await H.handleFileMessage(db, m3, FOLDER, null, null, false, { segmentHold: new Map([['stack2_split_p2-3.pdf', { from: 2, to: 3 }]]) });
  check("OFF ('false'): the same multi-page cut lands with rows identical to the control (no note, eligible)",
    JSON.stringify(strip(rowsOf(m3.db_id))) === JSON.stringify(strip(rowsOf(m2.db_id))) && trust.isAutoFileEligible(db, doc(m3.db_id)).eligible === true);
  learning.setSetting(db, 'split_segment_multipage_hold', 'true');
  const m4 = fileDone('stack3_split_p2-3.pdf');
  await H.handleFileMessage(db, m4, FOLDER, null, null, false, {});
  check('C6: a `*_split_p2-3.pdf` WITHOUT a rewrite (the Review Split tool / a user-named file) is NOT held', !SP.hasSegmentHold(noteOf(m4.db_id, 'invoice_number')) && trust.isAutoFileEligible(db, doc(m4.db_id)).eligible === true);
  const m4b = fileDone('stack4_split_p2-3.pdf');
  await H.handleFileMessage(db, m4b, FOLDER, null, null, false);
  check('C6: opts omitted entirely (the legacy 6-arg call) → same, not held', !SP.hasSegmentHold(noteOf(m4b.db_id, 'invoice_number')) && trust.isAutoFileEligible(db, doc(m4b.db_id)).eligible === true);

  console.log('\n§3 THE PINNED TRADE-OFF — a CORRECT 2-page cut is held too (a future dev must not exempt clean multi-page cuts)');
  check('the §1 doc IS a clean 100 % read with no other note — and it is held', trust.isAutoFileEligible(db, doc(id1)).eligible === false && rowsOf(id1).filter(r => r.validation_note).length === 1);

  console.log('\n§4 sheet-bounded cuts are exempt (operator-declared boundaries)');
  const sheetHold = SP.segmentHoldPages([{ original: 's.pdf', segments: ['s_split_p1-2.pdf', 's_split_p3.pdf'], separators: 1 }]);
  const m5 = fileDone('s_split_p1-2.pdf');
  await H.handleFileMessage(db, m5, FOLDER, null, null, false, { segmentHold: sheetHold });
  check('a multi-page segment between separator sheets is NOT held', sheetHold.size === 0 && !SP.hasSegmentHold(noteOf(m5.db_id, 'invoice_number')));

  console.log('\n§5 target-row order (Oracle C3) + idempotence');
  const mk = (rows) => {
    const id = Number(documents.insert(db, { original_filename: `t${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: FOLDER, status: 'needs_review', supplier_name: 'Acme Widgets', document_type_id: 1 }).lastInsertRowid);
    for (const [k, v, note] of rows) db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note) VALUES (?, ?, ?, ?, 99, 'keyword', ?)").run(id, k, v, v, note || null);
    return id;
  };
  const r = { from: 2, to: 3 };
  let id = mk([['supplier_name', 'Acme Widgets'], ['invoice_number', 'INV-1'], ['invoice_date', '01-08-2026']]);
  let res = H._stampSegmentHold(db, id, 1, r);
  check('ref-role row first', res.field_key === 'invoice_number' && SP.hasSegmentHold(noteOf(id, 'invoice_number')));
  const again = H._stampSegmentHold(db, id, 1, r);
  check('idempotent — a second stamp is a no-op', again.stamped === false && rowsOf(id).filter(x => SP.hasSegmentHold(x.validation_note)).length === 1);
  id = mk([['supplier_name', 'Acme Widgets'], ['invoice_date', '01-08-2026']]);
  check('no ref row → the date-role row', H._stampSegmentHold(db, id, 1, r).field_key === 'invoice_date');
  id = mk([['supplier_name', 'Acme Widgets'], ['total', '9.99'], ['po_ref', 'PO-1']]);
  check('no ref/date → a VISIBLE valued non-identity row of this type (total), never the foreign po_ref, never supplier_name', H._stampSegmentHold(db, id, 1, r).field_key === 'total');
  id = mk([['supplier_name', 'Acme Widgets'], ['total', '9.99', 'some other note'], ['vat_no', 'GB1']]);
  check('…preferring a row with NO existing note when one exists (vat_no is foreign → total keeps it, prepended)', (() => { const o = H._stampSegmentHold(db, id, 1, r); return o.field_key === 'total' && String(noteOf(id, 'total')).endsWith('some other note'); })());
  id = mk([['supplier_name', 'Acme Widgets']]);
  check('only supplier_name → supplier_name LAST', H._stampSegmentHold(db, id, 1, r).field_key === 'supplier_name');
  id = mk([]);
  res = H._stampSegmentHold(db, id, 1, r);
  check('no rows at all → a stub on the ref key (the C12 shape: empty value, segment_hold method, the note)', res.stub === true && res.field_key === 'invoice_number' && (rowsOf(id)[0] || {}).extraction_method === 'segment_hold' && (rowsOf(id)[0] || {}).display_value === null);
  check('…and the stub still holds the doc', trust.isAutoFileEligible(db, { ...doc(id), overall_confidence: 100 }).eligible === false);

  console.log('\n§6 the reprocess merge (Oracle C1 — slice 2 carry)');
  const sentence = SP.segmentHoldNote(2, 3);
  const existing = [{ field_key: 'invoice_number', display_value: 'INV-1', raw_value: 'INV-1', confidence: 100, validation_note: sentence, corrected_to: null, extraction_method: 'keyword' },
                    { field_key: 'invoice_date', display_value: '01-08-2026', raw_value: '01-08-2026', confidence: 100, validation_note: null, corrected_to: null, extraction_method: 'keyword' }];
  const fresh = (ref) => [{ field_key: 'invoice_number', display_value: ref, raw_value: ref, confidence: 100, validation_note: null, corrected_to: null, extraction_method: 'keyword' },
                          { field_key: 'invoice_date', display_value: '01-08-2026', raw_value: '01-08-2026', confidence: 100, validation_note: null, corrected_to: null, extraction_method: 'keyword' }];
  const same = H._mergeReprocessRows(existing, fresh('INV-1'));
  check('same fresh value → the lane-hold note survives the merge', SP.hasSegmentHold((same.find(x => x.field_key === 'invoice_number') || {}).validation_note));
  const diff = H._mergeReprocessRows(existing, fresh('INV-2'));
  const dropped = !SP.hasSegmentHold((diff.find(x => x.field_key === 'invoice_number') || {}).validation_note);
  check('a DIFFERENT fresh value: the merge alone DROPS it (the used_new gap slice 2 closes)', dropped);
  SP.carrySegmentHold(existing, diff, { refKey: 'invoice_number', dateKey: 'invoice_date' });
  check('carrySegmentHold puts it back on the merged ref-role row', SP.hasSegmentHold((diff.find(x => x.field_key === 'invoice_number') || {}).validation_note));
  const H_SRC = read(path.join(__dirname, 'handler.js'));
  check('the carry is wired at the ONE production merge site, directly after mergeReprocessRows(...) and before the row write',
    /const mergedRows = mergeReprocessRows\(existing, newRows, flip, _emitMerge, _hiddenKeys,[\s\S]{0,1500}?carrySegmentHold\(existing, mergedRows, \{ refKey: _sr\.ref_field_key, dateKey: _sr\.date_field_key \}\)/.test(H_SRC)
    && H_SRC.indexOf('carrySegmentHold(existing, mergedRows') < H_SRC.indexOf('const _supBlanked = _imageless ? false : supplierColumnBlanked(mergedRows);'));

  console.log('\n§7 source contracts (Oracle C10)');
  const W = read(path.join(REPO, 'src', 'modules', 'watch', 'handler.js'));
  check("watch: the pinned import-time hold line is byte-identical", W.includes("const _autoFileRun = !(heldNames && msg.type === 'file_done' && heldNames.has(msg.original_filename));"));
  check('watch: BOTH handleFileMessage call sites pass { segmentHold: segHold, segmentPairs: pairCtx }', (W.match(/handleFileMessage\(db, msg, watchFolder, notifyMainWindow, _ctx\.logger, _autoFileRun, \{ segmentHold: segHold, segmentPairs: pairCtx \}\)/g) || []).length === 2);
  check('watch: segHold is built from sep.rewrites via split_plan.segmentHoldPages', W.includes("segHold = require('../processing/split_plan').segmentHoldPages(sep.rewrites);"));
  check('manual: segHold is built from sepRes.rewrites (the "only the count is used" discard is gone)', H_SRC.includes('segHold = segmentHoldPages(sepRes && sepRes.rewrites);') && !H_SRC.includes('so only the count is used'));
  check('manual: the file_done call passes { segmentHold: segHold, segmentPairs: pairCtx }', H_SRC.includes('_handleFileMessage(db, msg, folderPath, notifyMainWindow, logger, autoFileRun, { segmentHold: segHold, segmentPairs: pairCtx })'));
  check('the rewrite carries `separators` (sheet-bounded exemption source)', H_SRC.includes("rewrites.push({ original: name, segments: made.map(f => path.basename(f)), separators: plan.separators || 0 });"));
  check('the stamp sits in the success branch after insertExtractions and before the chip verdict (Oracle C2)',
    // (window widened 2500 → 4500 on 2026-09-17: the segment PAIR hold block sits between the stamp and the chip verdict)
    /learning\.insertExtractions\(db, docId, rows\);\s*\n\s*\}\s*\n\s*\/\/ SPLIT-SEGMENT HOLD[\s\S]{0,1600}?_stampSegmentHold\(db, docId, document_type_id, _segHold\.get\(msg\.original_filename\)\);[\s\S]{0,4500}?msg\.review_hold = null;/.test(H_SRC));
  const RS = read(path.join(REPO, 'src', 'services', 'reviewService.js'));
  check('a human confirm still clears every note (reviewService)', RS.includes('UPDATE extractions SET validation_note = NULL, corrected_to = NULL WHERE document_id = ?'));
  const ISF = read(path.join(REPO, 'src', 'services', 'issuerSiblingFillService.js'));
  check("issuerSiblingFillService's machine note-clear stays scoped to field_key = 'supplier_name' (why supplier_name is the LAST target)", /UPDATE extractions\s*\n\s*SET confidence = @conf,\s*\n\s*validation_note = NULL,[\s\S]{0,200}?field_key = 'supplier_name'/.test(ISF));
  const RV = read(path.join(REPO, 'src', 'modules', 'review', 'handler.js'));
  check("get-auto-file-reason reports the hold as its own kind 'segment-hold' with the page range (Oracle C4), never 'flagged by a formatting check'", RV.includes("out.kind = 'segment-hold'") && RV.includes('out.pages = SP.segmentHoldRange(held.validation_note)'));
  const RR = read(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'));
  check("Review's reason copy has the 'segment-hold' sentence pointing at Split", RR.includes("'segment-hold':") && RR.includes('were cut from a multi-document scan') && RR.includes('use <strong>Split</strong>'));

  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('PIN CRASHED:', e); process.exit(1); });
