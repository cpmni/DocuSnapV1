'use strict';
/*
 * test_segment_pair_stamp.js — the DB half of the segment PAIR hold (2026-09-17; gary → Oracle SIGN-OFF-W/COND
 * C1-C12; DARK mig 180 `segment_pair_hold`). A WEAK (letterhead-only) 1-page cut is compared with its neighbour once
 * both halves have landed; the first to land carries a PROVISIONAL durable note; two halves that read as ONE document
 * (same supplier, no date on the later page, the same / no number) both stay held; a complete later page releases the
 * earlier one (its note cleared, its auto-file re-invoked — only for an auto-file landing, only after its IO tail).
 *
 * Pins: provisional → refused at every machine door, msg.needs_review NOT raised (C1's precondition); orphan successor →
 * both marked; complete successor → release + re-invoke (the onRelease seam) + rows clean; successor-first; successor
 * error → the predecessor keeps its note (C10); OFF byte-identical; a 176-marked multi-page weak successor carries both
 * sentences, the 176 stamp not duplicated; overlapping pairs keep the held pair's sentence (C3); the stub row round-trip;
 * watch parity (a non-auto-file landing is released without a re-invoke — C1); the legacy 6-arg call untouched.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/processing/test_segment_pair_stamp.js
 */
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

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const db = new Database(':memory:');
quiet(() => runMigrations(db));
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req] of [['supplier_name', 1], ['invoice_number', 1], ['invoice_date', 1], ['total', 0]])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, 'text', ?, 1, 1)").run(k, k, req);
learning.setSetting(db, 'auto_file_threshold', '1');           // the laxest slider: only a note can refuse
learning.setSetting(db, 'auto_file_full_confidence', 'false');  // _maybeAutoFile returns at once — no file IO; the re-invoke is observed via ctx.onRelease
learning.setSetting(db, 'segment_pair_hold', 'true');
const FOLDER = path.join(require('os').tmpdir(), 'sf-segment-pair-pin');   // no files here — the IO tail is best-effort

const fileDone = (name, { supplier = 'Acme Widgets', ref, date, pages = 1 } = {}) => {
  const ex = { supplier_name: { value: supplier, confidence: 95, method: 'template_fixed' } };
  if (ref != null) ex.invoice_number = { value: ref, confidence: 94, method: 'template_mapping' };
  if (date != null) ex.invoice_date = { value: date, confidence: 96, method: 'template_mapping' };
  return { type: 'file_done', success: true, status: 'needs_review', needs_review: false, original_filename: name,
    overall_confidence: 100, document_type: 'Invoice', supplier_name: supplier, page_count: pages, extractions: ex };
};
const rowsOf = (id) => db.prepare('SELECT field_key, display_value, validation_note, extraction_method FROM extractions WHERE document_id = ? ORDER BY field_key').all(id);
const notesOf = (id) => rowsOf(id).map(r => r.validation_note).filter(Boolean);
const doc = (id) => documents.getById(db, id);
const ctxFor = (segments, weak, onRelease) => { const c = SP.buildPairContext([{ original: 'stack.pdf', segments, separators: 0, weak }]); c.onRelease = onRelease; return c; };
const land = (msg, ctx, autoFileRun = true, extra = {}) => H.handleFileMessage(db, msg, FOLDER, null, null, autoFileRun, { segmentHold: null, segmentPairs: ctx, ...extra });

(async () => {
  console.log('§1 the predecessor lands first → a PROVISIONAL note; the orphan successor lands → BOTH held at every machine door');
  {
    const released = [];
    const ctx = ctxFor(['a_split_p1.pdf', 'a_split_p2.pdf'], ['a_split_p2.pdf'], (...a) => released.push(a));
    const S = SP.pairSentences(ctx.pairs[0]);
    const m1 = fileDone('a_split_p1.pdf', { ref: 'INV-29597', date: '23-11-2026' });
    await land(m1, ctx);
    const n1 = notesOf(m1.db_id);
    check('the predecessor\'s ref-role row carries ITS pair sentence (provisional)', n1.length === 1 && n1[0] === S.pred && rowsOf(m1.db_id).find(r => r.field_key === 'invoice_number').validation_note === S.pred, JSON.stringify(n1));
    check("isAutoFileEligible refuses it ('flagged'); the File-All bypass does NOT lift it", trust.isFlaggedReason(trust.isAutoFileEligible(db, doc(m1.db_id))) && !trust.autoFileEligibleIds(db, [doc(m1.db_id)], { bypassPutBack: true }).includes(m1.db_id));
    check('PIN (C1 precondition): the provisional stamp does NOT raise msg.needs_review (the T1 bail must pass the release re-run)', m1.needs_review === false && !!m1.review_hold);
    const m2 = fileDone('a_split_p2.pdf', { ref: 'INV-29597' });   // the exhibit: same supplier, the same number, no date
    await land(m2, ctx);
    check('the successor (same number, no date) is marked with ITS sentence; the predecessor keeps its own — read as ONE document', notesOf(m2.db_id).length === 1 && notesOf(m2.db_id)[0] === S.succ && notesOf(m1.db_id)[0] === S.pred);
    check('both refused by the ONE predicate', trust.isAutoFileEligible(db, doc(m1.db_id)).eligible === false && trust.isAutoFileEligible(db, doc(m2.db_id)).eligible === false);
    const sweep = evaluateSweepConsistency({ storedRows: rowsOf(m1.db_id), freshFields: { supplier_name: { value: 'Acme Widgets' }, invoice_number: { value: 'INV-29597' }, invoice_date: { value: '23-11-2026' } },
      roleKeys: new Set(['supplier_name', 'invoice_number', 'invoice_date']), storedSlug: 'invoice', freshSlug: 'invoice' });
    check("the sweep's Tier-2 guard refuses on 'stored-flagged'", sweep.pass === false && sweep.reason === 'stored-flagged');
    check('no release fired', released.length === 0);
  }

  console.log('\n§2 the predecessor lands first; a COMPLETE successor (its own number + date) → the predecessor is released');
  {
    const released = [];
    const ctx = ctxFor(['b_split_p1.pdf', 'b_split_p2.pdf'], ['b_split_p2.pdf'], (...a) => released.push(a));
    const m1 = fileDone('b_split_p1.pdf', { ref: 'PO-46491', date: '03-07-2026' });
    await land(m1, ctx);
    check('provisional note present while the partner is unread', notesOf(m1.db_id).length === 1 && trust.isAutoFileEligible(db, doc(m1.db_id)).eligible === false);
    const m2 = fileDone('b_split_p2.pdf', { ref: 'PO-53795', date: '24-03-2026' });
    await land(m2, ctx);
    check('the predecessor\'s note is CLEARED (NULL, no residue) and it is eligible again', notesOf(m1.db_id).length === 0 && trust.isAutoFileEligible(db, doc(m1.db_id)).eligible === true, JSON.stringify(rowsOf(m1.db_id)));
    check('the successor carries no note and is eligible', notesOf(m2.db_id).length === 0 && trust.isAutoFileEligible(db, doc(m2.db_id)).eligible === true);
    check('the release re-invoke fired for the PREDECESSOR with autoFileRun=true (the onRelease seam)', released.length === 1 && released[0][0] === 'b_split_p1.pdf' && released[0][1] === 'b_split_p2.pdf' && released[0][2] === true, JSON.stringify(released));
    check('rows byte-identical to a doc that was never paired (no stub, no residue)', JSON.stringify(rowsOf(m1.db_id).map(r => ({ ...r, validation_note: r.validation_note || null }))) === JSON.stringify([
      { field_key: 'invoice_date', display_value: '03-07-2026', validation_note: null, extraction_method: 'template_mapping' },
      { field_key: 'invoice_number', display_value: 'PO-46491', validation_note: null, extraction_method: 'template_mapping' },
      { field_key: 'supplier_name', display_value: 'Acme Widgets', validation_note: null, extraction_method: 'template_fixed' }]));
  }

  console.log('\n§3 the SUCCESSOR lands first (shards scatter a pair) — provisional on it; the predecessor lands → decided');
  {
    const released = [];
    const ctx = ctxFor(['c_split_p1.pdf', 'c_split_p2.pdf'], ['c_split_p2.pdf'], (...a) => released.push(a));
    const S = SP.pairSentences(ctx.pairs[0]);
    const m2 = fileDone('c_split_p2.pdf', { ref: 'INV-2', date: '02-02-2026' });
    await land(m2, ctx);
    check('the successor carries ITS provisional sentence', notesOf(m2.db_id)[0] === S.succ);
    const m1 = fileDone('c_split_p1.pdf', { ref: 'INV-1', date: '01-01-2026' });
    await land(m1, ctx);
    check('a complete successor → released: its note cleared, onRelease(succ, pred, true), the predecessor never marked', notesOf(m2.db_id).length === 0 && notesOf(m1.db_id).length === 0 && released.length === 1 && released[0][0] === 'c_split_p2.pdf' && released[0][2] === true);
    const ctx2 = ctxFor(['d_split_p1.pdf', 'd_split_p2.pdf'], ['d_split_p2.pdf'], (...a) => released.push(a));
    const S2 = SP.pairSentences(ctx2.pairs[0]);
    const n2 = fileDone('d_split_p2.pdf');            // orphan-shaped: supplier only
    await land(n2, ctx2);
    const n1 = fileDone('d_split_p1.pdf', { ref: 'INV-7', date: '07-07-2026' });
    await land(n1, ctx2);
    check('an orphan successor that landed first → when the predecessor lands, BOTH are marked (the predecessor gets its sentence now)', notesOf(n2.db_id)[0] === S2.succ && notesOf(n1.db_id)[0] === S2.pred && released.length === 1);
  }

  console.log('\n§4 fail directions (Oracle C10): a successor that ERRORS leaves the predecessor held; an errored successor seen later → hold');
  {
    const ctx = ctxFor(['e_split_p1.pdf', 'e_split_p2.pdf'], ['e_split_p2.pdf'], () => { throw new Error('must not release'); });
    const S = SP.pairSentences(ctx.pairs[0]);
    const m1 = fileDone('e_split_p1.pdf', { ref: 'INV-1', date: '01-01-2026' });
    await land(m1, ctx);
    const bad = { type: 'file_done', success: false, original_filename: 'e_split_p2.pdf', error: 'boom' };
    await land(bad, ctx);
    check('PIN: the predecessor KEEPS its provisional note (inconclusive → fail toward Review)', notesOf(m1.db_id)[0] === S.pred && trust.isAutoFileEligible(db, doc(m1.db_id)).eligible === false);
    check('the failure was recorded in the pair context', ctx.landed.get('e_split_p2.pdf') && ctx.landed.get('e_split_p2.pdf').error === true);
    const ctx2 = ctxFor(['f_split_p1.pdf', 'f_split_p2.pdf'], ['f_split_p2.pdf'], () => { throw new Error('must not release'); });
    await land({ type: 'file_done', success: false, original_filename: 'f_split_p2.pdf', error: 'boom' }, ctx2);
    const f1 = fileDone('f_split_p1.pdf', { ref: 'INV-1', date: '01-01-2026' });
    await land(f1, ctx2);
    check('the successor errored BEFORE the predecessor landed → the predecessor is stamped (held)', notesOf(f1.db_id)[0] === SP.pairSentences(ctx2.pairs[0]).pred);
  }

  console.log('\n§5 OFF is byte-identical; a doc outside every pair is untouched; the legacy call is untouched');
  {
    learning.setSetting(db, 'segment_pair_hold', 'false');
    const released = [];
    const ctx = ctxFor(['g_split_p1.pdf', 'g_split_p2.pdf'], ['g_split_p2.pdf'], (...a) => released.push(a));
    const m1 = fileDone('g_split_p1.pdf', { ref: 'INV-29597', date: '23-11-2026' });
    const m2 = fileDone('g_split_p2.pdf', { ref: 'INV-29597' });
    await land(m1, ctx); await land(m2, ctx);
    check("OFF ('false'): nothing stamped, nothing released, both eligible as today", notesOf(m1.db_id).length === 0 && notesOf(m2.db_id).length === 0 && released.length === 0 && ctx.landed.size === 0 && trust.isAutoFileEligible(db, doc(m1.db_id)).eligible === true);
    learning.setSetting(db, 'segment_pair_hold', 'true');
    const m3 = fileDone('g_split_p3.pdf', { ref: 'INV-3' });
    await land(m3, ctx);
    check('ON: a segment that belongs to no pair is untouched (its own missing date holds it as today, no pair note)', notesOf(m3.db_id).length === 0);
    const m4 = fileDone('h_split_p2.pdf', { ref: 'INV-4' });
    await H.handleFileMessage(db, m4, FOLDER, null, null, false);
    check('the legacy 6-arg call (no opts) → untouched', notesOf(m4.db_id).length === 0);
  }

  console.log('\n§6 a mig-176-marked MULTI-page weak successor carries BOTH sentences; the 176 stamp is not duplicated');
  {
    const rw = [{ original: 'i.pdf', segments: ['i_split_p1.pdf', 'i_split_p2-3.pdf'], separators: 0, weak: ['i_split_p2-3.pdf'] }];
    const ctx = SP.buildPairContext(rw); ctx.onRelease = () => { throw new Error('must not release'); };
    const segHold = SP.segmentHoldPages(rw);
    const S = SP.pairSentences(ctx.pairs[0]);
    const m1 = fileDone('i_split_p1.pdf', { ref: 'INV-9', date: '09-09-2026' });
    await land(m1, ctx);
    const m2 = fileDone('i_split_p2-3.pdf', { ref: 'INV-9', pages: 2 });
    await land(m2, ctx, true, { segmentHold: segHold });
    const n = rowsOf(m2.db_id).find(r => r.field_key === 'invoice_number').validation_note;
    check('the successor\'s ref-role row carries the 176 sentence AND the pair sentence, once each', n.includes(SP.segmentHoldNote(2, 3)) && n.includes(S.succ) && n.split(SP.SEGMENT_HOLD_MARK).length === 2 && n.split(SP.SEGMENT_PAIR_MARK).length === 2, n);
    check("segmentHoldKind on that row → 'merged' (its Split copy is the right one); the predecessor holds its pair sentence", SP.segmentHoldKind(n) === 'merged' && notesOf(m1.db_id)[0] === S.pred);
    check('a second 176 stamp is still a no-op; a second pair stamp of the SAME sentence is a no-op', H._stampSegmentHold(db, m2.db_id, 1, { from: 2, to: 3 }).stamped === false && H._stampSegmentHold(db, m2.db_id, 1, null, S.succ).stamped === false);
  }

  console.log('\n§7 overlapping pairs (Oracle C3): p1|p2|p3 — (1,2) released, (2,3) held → p2 keeps the held pair\'s sentence');
  {
    const released = [];
    const ctx = ctxFor(['j_split_p1.pdf', 'j_split_p2.pdf', 'j_split_p3.pdf'], ['j_split_p2.pdf', 'j_split_p3.pdf'], (...a) => released.push(a));
    const A = SP.pairSentences(ctx.pairs[0]), B = SP.pairSentences(ctx.pairs[1]);
    const p1 = fileDone('j_split_p1.pdf', { ref: 'INV-1', date: '01-01-2026' });
    const p3 = fileDone('j_split_p3.pdf', { ref: 'INV-2' });                       // orphan-shaped relative to p2
    const p2 = fileDone('j_split_p2.pdf', { ref: 'INV-2', date: '02-02-2026' });   // complete → releases (1,2); pred of (2,3)
    await land(p1, ctx); await land(p3, ctx); await land(p2, ctx);
    check('(1,2) released: p1 clean; (2,3) held: p2 carries EXACTLY B.pred, p3 B.succ', notesOf(p1.db_id).length === 0 && notesOf(p2.db_id).length === 1 && notesOf(p2.db_id)[0] === B.pred && notesOf(p3.db_id)[0] === B.succ && released.length === 1 && released[0][0] === 'j_split_p1.pdf');
    // the C3 PIN proper: a page carrying two pair sentences loses only the released one
    const ctx2 = ctxFor(['k_split_p1.pdf', 'k_split_p2.pdf', 'k_split_p3.pdf'], ['k_split_p2.pdf', 'k_split_p3.pdf'], () => {});
    const A2 = SP.pairSentences(ctx2.pairs[0]), B2 = SP.pairSentences(ctx2.pairs[1]);
    const q2 = fileDone('k_split_p2.pdf', { ref: 'INV-5' });
    await land(q2, ctx2);   // provisional as (1,2)-succ AND (2,3)-pred
    const nn = notesOf(q2.db_id)[0];
    check('a middle page that landed first carries BOTH its pair sentences', nn.includes(A2.succ) && nn.includes(B2.pred));
    H._clearPairSentence(db, q2.db_id, A2.succ);
    check('PIN: clearing the released pair\'s sentence leaves the other pair\'s sentence — the doc stays held', notesOf(q2.db_id)[0] === B2.pred && trust.isAutoFileEligible(db, doc(q2.db_id)).eligible === false);
  }

  console.log('\n§8 the stub round-trip + watch parity (C1)');
  {
    const id = Number(documents.insert(db, { original_filename: 'stub.pdf', folder_path: FOLDER, status: 'needs_review', supplier_name: 'Acme Widgets', document_type_id: 1 }).lastInsertRowid);
    const sentence = SP.pairSentences(ctxFor(['l_split_p1.pdf', 'l_split_p2.pdf'], ['l_split_p2.pdf']).pairs[0]).pred;
    const st = H._stampSegmentHold(db, id, 1, null, sentence);
    check('no rows at all → a stub row carries the pair sentence and holds the doc', st.stub === true && rowsOf(id).length === 1 && rowsOf(id)[0].extraction_method === 'segment_hold' && trust.isAutoFileEligible(db, { ...doc(id), overall_confidence: 100 }).eligible === false);
    check('clearing it REMOVES the stub (no empty row left behind)', H._clearPairSentence(db, id, sentence) === 1 && rowsOf(id).length === 0);
    const released = [];
    const ctx = ctxFor(['m_split_p1.pdf', 'm_split_p2.pdf'], ['m_split_p2.pdf'], (...a) => released.push(a));
    const w1 = fileDone('m_split_p1.pdf', { ref: 'INV-1', date: '01-01-2026' });
    await land(w1, ctx, false);   // a WATCH landing: import-time held, autoFileRun=false
    const w2 = fileDone('m_split_p2.pdf', { ref: 'INV-2', date: '02-02-2026' });
    await land(w2, ctx, false);
    check('PIN (C1): a watch pair release clears the note but never auto-files (onRelease sees autoFileRun=false)', notesOf(w1.db_id).length === 0 && released.length === 1 && released[0][2] === false);
    check('_pairTriple reads the stored triple by the doc\'s own role keys', JSON.stringify(H._pairTriple(db, { docId: w2.db_id, typeId: 1 })) === JSON.stringify({ supplier: 'Acme Widgets', ref: 'INV-2', date: '02-02-2026' })
      && JSON.stringify(H._pairTriple(db, { docId: w2.db_id, typeId: null })) === JSON.stringify({ supplier: 'Acme Widgets', ref: '', date: '' }));
  }

  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('PIN CRASHED:', e); process.exit(1); });
