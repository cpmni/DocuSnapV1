#!/usr/bin/env node
'use strict';

/**
 * src/services/test_reviewservice.js
 * ----------------------------------
 * Phase 2 of the multi-user review work. reviewService is the transport-agnostic confirm/defer/
 * restore the desktop IPC and the /v1 client API both call. Uses a REAL in-memory DB (so the
 * atomic claim is exercised for real) with stubbed filing/learning/doctypes + collectors for the
 * injected hooks. Verifies: claim-before-file, ALREADY_FILED on a lost race, filing-failure
 * rollback, the re-file path, taught_fields gating of the template-promote hook, confirmed_by,
 * and the defer/restore CAS.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_reviewservice.js
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const documents = require('../../database/modules/documents');
const { createReviewService } = require('./reviewService');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
const get = (db, id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
const newDoc = (db, status = 'needs_review') =>
  Number(documents.insert(db, { original_filename: 'scan.pdf', folder_path: '/in', status }).lastInsertRowid);

const db = new Database(':memory:');
runMigrations(db);
// A real document_types row so the denormalised documents.document_type_id (=1) satisfies its FK.
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();

// ── Build a service with stubbed I/O + collectors ──────────────────────────────
let filingMode = 'ok';   // 'ok' | 'fail'
const calls = { audit: [], saveCorrections: 0, notifyCounts: 0, sourceMove: 0, taught: 0, captured: 0, commit: 0 };
const deps = {
  documents,
  learning: { getSetting: (d, key, def) => (key === 'issuer_near_match_confirm_guard' || key === 'review_group_by_letterhead' || key === 'type_split_confirm_gate')
                ? require('../../database/modules/learning').getSetting(d, key, def)   // honour the real DB row for the toggle tests
                : '/out',
    saveCorrections: (_db, _id, corr, _s, _slug, allValues) => { calls.saveCorrections++; calls.lastAllValues = allValues; calls.lastCorrections = corr; },
    // the issuer near-match gate (card, round 6) calls this — delegate to the real implementation so
    // the stub doesn't make the gate fail open on every confirm.
    findNearMatchIdentity: (d, v, o) => require('../../database/modules/learning').findNearMatchIdentity(d, v, o) },
  doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
  filing: {
    normaliseDate: require('../modules/filing/handler').normaliseDate,   // the real canonical normaliser
    commitDocument: async ({ allValues }) => {
      calls.commit++; calls.commitAllValues = allValues;
      return filingMode === 'fail'
        ? { success: false, error: 'disk full' }
        : { success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml', srcPath: '/in/scan.pdf' };
    } },
  fs: { existsSync: () => true, unlinkSync: () => {} },   // the fixture's docs HAVE a filable page (card 1 no-page guard reads this)
  path: require('path'),
  logger: null,
  audit: (_db, e) => calls.audit.push(e),
  onScheduleSourceMove: () => { calls.sourceMove++; },
  onTaughtConfirm: async () => { calls.taught++; },
  captureSample: async () => { calls.captured++; },
  notifyCounts: () => { calls.notifyCounts++; },
  releaseDelayMs: 0,
};
const svc = createReviewService(deps);
// Flush pending microtasks/detached work: the landmark-learning hooks (captureSample /
// onTaughtConfirm) are fire-and-forget after confirm() returns (Oracle B+), so a test that
// asserts they RAN must let the microtask queue drain first.
const flush = () => new Promise(r => setTimeout(r, 0));

const basePayload = (id, extra = {}) => ({
  document_id: id, folder_path: '/in', original_filename: 'scan.pdf',
  corrections: { invoice_number: { original_value: 'x', corrected_value: 'y' } },
  allValues: { supplier_name: 'Acme', invoice_number: 'INV-1', invoice_date: '01-01-2026' },
  supplier_name: 'Acme', document_type: 'Invoice', document_type_slug: 'invoice', taught_fields: [], ...extra,
});

(async () => {
  // ── First confirm of a needs_review doc ──────────────────────────────────────
  const d1 = newDoc(db);
  const r1 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(d1));
  check('first confirm ok', r1.ok === true && r1.success === true);
  check('  → returns the filed filename', r1.filename === 'F.pdf');
  check('  → status confirmed', get(db, d1).status === 'confirmed');
  check('  → confirmed_by_username = sarah', get(db, d1).confirmed_by_username === 'sarah');
  check('  → stored_path recorded after filing', get(db, d1).stored_path === '/out/F.pdf');
  check('  → search fields denormalised (supplier)', get(db, d1).supplier_name === 'Acme');
  check('  → learning.saveCorrections called', calls.saveCorrections === 1);
  check('  → review_confirmed audited with actor', calls.audit.some(e => e.action === 'review_confirmed' && e.actor_username === 'sarah'));
  check('  → notifyCounts + sourceMove fired', calls.notifyCounts === 1 && calls.sourceMove === 1);
  await flush();
  check('  → taught-confirm hook NOT fired (no taught_fields)', calls.taught === 0);

  // ── Taught confirm fires the template-promote hook (now DETACHED — flush first) ────
  const d2 = newDoc(db);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(d2, { taught_fields: ['invoice_number'] }));
  await flush();   // onTaughtConfirm is fire-and-forget after confirm returns (Oracle B+)
  check('taught confirm fires onTaughtConfirm (detached)', calls.taught === 1);

  // ── Central date normalisation: a client's typed date becomes canonical DD-MM-YYYY once ──
  const dNorm1 = newDoc(db);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(dNorm1, {
    allValues: { supplier_name: 'Acme', invoice_number: 'INV-9', invoice_date: 'Aug 03 2012' },
    corrections: { invoice_date: { original_value: '2012-08-03', corrected_value: 'Aug 03 2012' } },
  }));
  check('date normalised for filing (Aug 03 2012 → 03-08-2012)', calls.commitAllValues.invoice_date === '03-08-2012');
  check('date normalised for learning (saveCorrections allValues)', calls.lastAllValues.invoice_date === '03-08-2012');
  check('date normalised in the correction record too', calls.lastCorrections.invoice_date.corrected_value === '03-08-2012');
  const dNorm2 = newDoc(db);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(dNorm2, {
    allValues: { supplier_name: 'Acme', invoice_number: 'INV-10', invoice_date: 'whenever' },
  }));
  check('unparseable date left as typed, not dropped', calls.commitAllValues.invoice_date === 'whenever');

  // ── ALREADY_FILED: a doc claimed by someone else (confirmed, no stored yet) ───
  const d3 = newDoc(db);
  documents.update(db, d3, { status: 'confirmed', confirmed_by_username: 'sarah' });  // mid-claim by sarah
  const r3 = await svc.confirm(db, { username: 'bob', role: 'edit' }, basePayload(d3));
  check('lost race → ok:false, code ALREADY_FILED', r3.ok === false && r3.code === 'ALREADY_FILED');
  check('  → names the winner (sarah)', r3.confirmedBy === 'sarah');
  check('  → bob did NOT file (commit not called for d3)', get(db, d3).stored_path === null);

  // ── Re-file path: a DELIBERATE re-file ("Edit in Review", allowRefile:true) re-files ──────
  const d4 = newDoc(db);
  documents.update(db, d4, { status: 'confirmed', stored_path: '/out/OLD.pdf', stored_filename: 'OLD.pdf', confirmed_by_username: 'sarah' });
  const commitsBefore = calls.commit;
  const r4 = await svc.confirm(db, { username: 'bob', role: 'edit' }, basePayload(d4, { allowRefile: true }));
  check('deliberate re-file (allowRefile) of an already-filed doc succeeds', r4.ok === true);
  check('  → it actually re-filed (commit called)', calls.commit === commitsBefore + 1);
  check('  → confirmed_by updated to the re-filer (bob)', get(db, d4).confirmed_by_username === 'bob');

  // ── Re-file GUARD (2026-06-30 gap): a QUEUE confirm that raced into an already-filed doc (NO
  //    allowRefile intent) must LOSE cleanly (ALREADY_FILED), never silently overwrite reviewer #1 ─
  const d4b = newDoc(db);
  documents.update(db, d4b, { status: 'confirmed', stored_path: '/out/A.pdf', stored_filename: 'A.pdf', confirmed_by_username: 'sarah' });
  const commitsBeforeGuard = calls.commit;
  const r4b = await svc.confirm(db, { username: 'bob', role: 'edit' }, basePayload(d4b));  // no allowRefile → a queue confirm
  check('raced queue confirm on a filed doc → ALREADY_FILED (no silent overwrite)', r4b.ok === false && r4b.code === 'ALREADY_FILED');
  check('  → names the winner (sarah)', r4b.confirmedBy === 'sarah');
  check('  → bob did NOT re-file (commit NOT called)', calls.commit === commitsBeforeGuard);
  check('  → confirmed_by stays sarah (first reviewer preserved)', get(db, d4b).confirmed_by_username === 'sarah');
  check('  → stored_path unchanged (original filing intact)', get(db, d4b).stored_path === '/out/A.pdf');

  // ── Filing failure rolls a first-confirm back to the queue ────────────────────
  filingMode = 'fail';
  const d5 = newDoc(db);
  const r5 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(d5));
  check('filing failure → ok:false', r5.ok === false);
  check('  → doc rolled back to needs_review (not stranded confirmed)', get(db, d5).status === 'needs_review');
  check('  → confirmed_by cleared on rollback', get(db, d5).confirmed_by_username === null);
  filingMode = 'ok';

  // ── NO-PAGE GUARD (Chris round 5, card 1): a doc whose scanned page is gone must be REFUSED
  //    before the claim — never file an empty record, never present a working Confirm. Modelled by
  //    an fs where the source does not exist. ──────────────────────────────────────────────────
  const svcNoPage = createReviewService({ ...deps, fs: { existsSync: () => false, unlinkSync: () => {} } });
  const dGone = newDoc(db);
  const commitsBeforeGone = calls.commit;
  const rGone = await svcNoPage.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(dGone));
  check('no-page doc → ok:false, code NO_SOURCE_FILE', rGone.ok === false && rGone.code === 'NO_SOURCE_FILE');
  check('  → did NOT file (commit not called)', calls.commit === commitsBeforeGone);
  check('  → NOT claimed — stays needs_review (no status churn)', get(db, dGone).status === 'needs_review');

  // ── ISSUER NEAR-MATCH gate (Chris round 6): a typed issuer one/two chars off a company you already
  //    use is HELD before filing, with a Use/Keep choice; an acknowledge or the exact known name files.
  //    Seeded ON by migration 68, so the fresh migrated DB has it live. ────────────────────────────
  for (let i = 0; i < 3; i++) db.prepare(
    "INSERT INTO documents (original_filename, folder_path, status, supplier_name, document_type_id) VALUES ('k.pdf','/in','confirmed','Bramblewood Joinery Ltd',1)").run();
  const nmPayload = (id, extra = {}) => basePayload(id, {
    supplier_name: 'Drambiewood Joinery Ltd',
    allValues: { supplier_name: 'Drambiewood Joinery Ltd', invoice_number: 'INV-7', invoice_date: '01-01-2026' },
    corrections: {}, ...extra });
  const commitsBeforeNM = calls.commit;
  const dNM = newDoc(db);
  const rNM = await svc.confirm(db, { username: 'sarah', role: 'admin' }, nmPayload(dNM));
  check('near-miss issuer → ok:false, code ISSUER_NEAR_MATCH', rNM.ok === false && rNM.code === 'ISSUER_NEAR_MATCH');
  check('  → names the company you already use', rNM.nearMatch && rNM.nearMatch.existing === 'Bramblewood Joinery Ltd');
  check('  → did NOT file (held pre-claim)', calls.commit === commitsBeforeNM && get(db, dNM).status === 'needs_review');
  const rNMack = await svc.confirm(db, { username: 'sarah', role: 'admin' }, nmPayload(dNM, { acknowledgeIssuerNearMatch: true }));
  check('  → "Keep what I typed" (acknowledge) files', rNMack.ok === true && calls.commit === commitsBeforeNM + 1);
  const dExact = newDoc(db);
  const rExact = await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(dExact, {
    supplier_name: 'Bramblewood Joinery Ltd',
    allValues: { supplier_name: 'Bramblewood Joinery Ltd', invoice_number: 'INV-8', invoice_date: '01-01-2026' } }));
  check('the exact known name is NOT a near-match — it files straight through', rExact.ok === true);
  const dfNM = newDoc(db);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('issuer_near_match_confirm_guard','false')").run();
  const rOff = await svc.confirm(db, { username: 'sarah', role: 'admin' }, nmPayload(dfNM));
  check('the toggle can be turned OFF (near-miss then files without a hold)', rOff.ok === true);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('issuer_near_match_confirm_guard','true')").run();

  // ── LETTERHEAD-SUGGESTION hold (slice 3 of the garbled-issuer arc, 2026-08-22; Oracle C3.3):
  //    the Review list groups a garbled issuer under the company the letterhead reads, which hides
  //    the garble in the LIST but not in the FIELD — so confirming a value that is not the stored
  //    `suggested_supplier` while the identity note still stands is HELD with the same Use/Keep
  //    choice. Shed note (the "Keep … as the issuer" click clears it) → passes; equal value →
  //    passes; acknowledge → passes; setting OFF → byte-identical. ──────────────────────────────
  const seedGarble = (id, note) => db.prepare(
    `INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, suggested_supplier)
     VALUES (?, 'supplier_name', 'NOCUMENT', 'NOCUMENT', 70, 'template_mapping', ?, 'DOCUMENT SOLUTIONS')`).run(id, note);
  const garblePayload = (id, extra = {}) => basePayload(id, {
    supplier_name: 'NOCUMENT',
    allValues: { supplier_name: 'NOCUMENT', invoice_number: 'INV-9', invoice_date: '01-01-2026' },
    corrections: {}, ...extra });
  const NOTE = 'Letterhead may read “DOCUMENT SOLUTIONS” — detected “NOCUMENT”. Please confirm the issuer.';
  const dG0 = newDoc(db); seedGarble(dG0, NOTE);
  const commitsBeforeG = calls.commit;
  const rG0 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, garblePayload(dG0));
  check('letterhead hold OFF (setting unset): a noted garble files as before (byte-identical)', rG0.ok === true && calls.commit === commitsBeforeG + 1);
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('review_group_by_letterhead','true')").run();
  const dG1 = newDoc(db); seedGarble(dG1, NOTE);
  const rG1 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, garblePayload(dG1));
  check('letterhead hold ON: confirming "NOCUMENT" while the note stands → HELD, code ISSUER_NEAR_MATCH', rG1.ok === false && rG1.code === 'ISSUER_NEAR_MATCH');
  check('  → names the letterhead company, source letterhead', rG1.nearMatch && rG1.nearMatch.existing === 'DOCUMENT SOLUTIONS' && rG1.nearMatch.source === 'letterhead');
  check('  → did NOT file (held pre-claim)', calls.commit === commitsBeforeG + 1 && get(db, dG1).status === 'needs_review');
  check('  → audited as confirm_held_letterhead_suggestion', calls.audit.some(e => e.action === 'confirm_held_letterhead_suggestion' && e.document_id === dG1));
  const rG1use = await svc.confirm(db, { username: 'sarah', role: 'admin' }, garblePayload(dG1, {
    supplier_name: 'DOCUMENT SOLUTIONS', allValues: { supplier_name: 'DOCUMENT SOLUTIONS', invoice_number: 'INV-9', invoice_date: '01-01-2026' } }));
  check('  → "Use DOCUMENT SOLUTIONS" (value == suggestion) files', rG1use.ok === true && calls.commit === commitsBeforeG + 2);
  const dG2 = newDoc(db); seedGarble(dG2, NOTE);
  const rG2 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, garblePayload(dG2, { acknowledgeIssuerNearMatch: true }));
  check('  → acknowledge ("Keep") files', rG2.ok === true);
  const dG3 = newDoc(db); seedGarble(dG3, null);
  const rG3 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, garblePayload(dG3));
  check('  → note SHED (accept-issuer cleared it) → no hold, files (the gate keys on the NOTE, not the column)', rG3.ok === true);
  const dG4 = newDoc(db);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note)
              VALUES (?, 'supplier_name', 'NOCUMENT', 'NOCUMENT', 70, 'template_mapping', ?)`).run(dG4, NOTE);
  const rG4 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, garblePayload(dG4));
  check('  → note but NO suggestion (whole-token disagreement, slice 2 abstained) → no hold (byte-identical)', rG4.ok === true);
  db.prepare("DELETE FROM settings WHERE key='review_group_by_letterhead'").run();

  // ── TYPE-SPLIT ask (A3 of the type-split arc, 2026-08-22; Oracle S2-js-a): confirming a type the
  //    issuer has NEVER filed as, when its history (≥3 confirmed) is 100 % one other type, is HELD
  //    pre-claim with code TYPE_SPLIT (same payload shape as ISSUER_NEAR_MATCH). Ack files; bulk and
  //    machine vias never ask; re-file is NOT exempt; setting OFF → byte-identical. Default ON. ───────
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (7, 'Quote', 'quote', 0)").run();
  for (let i = 0; i < 3; i++) db.prepare(
    "INSERT INTO documents (original_filename, folder_path, status, supplier_name, document_type_id) VALUES ('q.pdf','/in','confirmed','Nordwind Refrigeration Ltd',7)").run();
  const tsPayload = (id, extra = {}) => basePayload(id, {
    supplier_name: 'Nordwind Refrigeration Ltd',
    allValues: { supplier_name: 'Nordwind Refrigeration Ltd', invoice_number: 'NRQ-2551', invoice_date: '01-01-2026' },
    corrections: {}, ...extra });
  const commitsBeforeTS = calls.commit;
  const dTS = newDoc(db);
  const rTS = await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTS));
  check('type-split: 3 quotes + an Invoice confirm → ok:false, code TYPE_SPLIT', rTS.ok === false && rTS.code === 'TYPE_SPLIT');
  check('  → names the established type + count and the typed type', rTS.typeSplit && rTS.typeSplit.established_slug === 'quote'
        && rTS.typeSplit.count === 3 && rTS.typeSplit.typed_slug === 'invoice');
  check('  → did NOT file (held pre-claim)', calls.commit === commitsBeforeTS && get(db, dTS).status === 'needs_review');
  check('  → audited as confirm_held_type_split', calls.audit.some(e => e.action === 'confirm_held_type_split' && e.document_id === dTS));
  const rTSack = await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTS, { acknowledgeTypeSplit: true }));
  check('  → "Keep <type>" (acknowledge) files', rTSack.ok === true && calls.commit === commitsBeforeTS + 1);
  const dTS2 = newDoc(db);
  const rTS2 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTS2));
  check('  → once the second type is confirmed the history is mixed → no further ask', rTS2.ok === true);
  // reset to a 100 %-one-type history for the remaining cases
  db.prepare("DELETE FROM documents WHERE id IN (?, ?)").run(dTS, dTS2);
  const dTSb = newDoc(db);
  const rTSb = await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTSb, { bulk: true }));
  check('  → bulk never asks (no affordance on that route)', rTSb.ok === true);
  db.prepare("DELETE FROM documents WHERE id = ?").run(dTSb);
  const dTSm = newDoc(db);
  const rTSm = await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTSm), { via: 'scope_sweep' });
  check('  → a machine via never asks', rTSm.ok === true);
  db.prepare("DELETE FROM documents WHERE id = ?").run(dTSm);
  const dTSq = newDoc(db);
  const rTSq = await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTSq, { document_type: 'Quote', document_type_slug: 'quote' }));
  check('  → the established type itself files straight through', rTSq.ok === true);
  const dTSr = newDoc(db);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTSr, { document_type: 'Quote', document_type_slug: 'quote' }));
  // the doctypes stub always answers with the Invoice type id — pin the two quote confirms to type 7 so the
  // history stays 100 % Quote (what the real getWithFields would have stored)
  db.prepare("UPDATE documents SET document_type_id = 7 WHERE id IN (?, ?)").run(dTSq, dTSr);
  const rTSr = await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTSr, { allowRefile: true }));
  check('  → a RE-FILE changing the type is NOT exempt (Edit in Review is where a type gets changed)', rTSr.ok === false && rTSr.code === 'TYPE_SPLIT');
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('type_split_confirm_gate','false')").run();
  const dTSoff = newDoc(db);
  const rTSoff = await svc.confirm(db, { username: 'sarah', role: 'admin' }, tsPayload(dTSoff));
  check('  → the setting can be turned OFF (files without a hold)', rTSoff.ok === true);
  db.prepare("DELETE FROM settings WHERE key='type_split_confirm_gate'").run();
  db.prepare("DELETE FROM documents WHERE supplier_name = 'Nordwind Refrigeration Ltd'").run();

  // ── defer / restore CAS ───────────────────────────────────────────────────────
  const d6 = newDoc(db);
  check('defer a needs_review doc ok', svc.defer(db, { username: 'sarah' }, d6).ok === true);
  check('  → status deferred', get(db, d6).status === 'deferred');
  check('defer again → NOT_REVIEWABLE', svc.defer(db, { username: 'sarah' }, d6).code === 'NOT_REVIEWABLE');
  check('restore the deferred doc ok', svc.restore(db, { username: 'sarah' }, d6).ok === true);
  check('restore again → NOT_DEFERRED', svc.restore(db, { username: 'sarah' }, d6).code === 'NOT_DEFERRED');

  // ── PIN (Oracle B+): the landmark-learning hooks are DETACHED, so confirm() must NOT block
  //    on them. If a future dev re-adds `await` around captureSample/onTaughtConfirm, the confirm
  //    IPC would hang and the Review UI would freeze between docs — this test catches that. Both
  //    hooks NEVER resolve here; confirm must still resolve promptly, and the doc must still file. ─
  db.prepare("INSERT INTO templates (id, name, slug) VALUES (77, 'T', 't')").run();  // so captureSample fires (tId set)
  const svcHang = createReviewService({
    ...deps,
    captureSample:   () => { calls.captured++; return new Promise(() => {}); },   // never resolves
    onTaughtConfirm: () => { calls.taught++;   return new Promise(() => {}); },   // never resolves
  });
  const dHang = newDoc(db);
  documents.update(db, dHang, { template_id: 77 });
  const capturedBefore = calls.captured;
  const raced = await Promise.race([
    svcHang.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(dHang, { taught_fields: ['invoice_number'] })),
    new Promise(res => setTimeout(() => res('TIMEOUT'), 300)),
  ]);
  check('confirm resolves WITHOUT awaiting the never-resolving landmark hook (not frozen)', raced !== 'TIMEOUT' && raced.ok === true);
  check('  → the doc still FILED despite the hung hook', get(db, dHang).status === 'confirmed');
  await flush();
  check('  → the detached captureSample WAS invoked (fire-and-forget, not silently skipped)', calls.captured === capturedBefore + 1);

  // ── PIN (eric coverage): a detached hook that REJECTS (not merely hangs) must be swallowed —
  //    no unhandledRejection escapes — and confirm must still return ok. Guarded by the inner
  //    try/catch (now warns) + the outer .catch(()=>{}); pinned so a refactor can't leak it. ─
  let sawUnhandled = false;
  const onUnhandled = () => { sawUnhandled = true; };
  process.on('unhandledRejection', onUnhandled);
  const svcReject = createReviewService({
    ...deps,
    captureSample:   () => Promise.reject(new Error('spawn failed')),
    onTaughtConfirm: () => Promise.reject(new Error('promote failed')),
  });
  const dRej = newDoc(db);
  documents.update(db, dRej, { template_id: 77 });
  const rRej = await svcReject.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(dRej, { taught_fields: ['invoice_number'] }));
  check('confirm ok despite a REJECTING detached hook', rRej.ok === true && get(db, dRej).status === 'confirmed');
  await flush(); await flush();   // let the detached rejections settle + any unhandledRejection emit
  check('  → no unhandledRejection escaped the detached learning block', sawUnhandled === false);
  process.removeListener('unhandledRejection', onUnhandled);

  // ── PREFIX-OUTLIER confirm gate (Slice 1) ──────────────────────────────────────
  // The extraction guard is inert on a first bulk import, so a cold-start confirm of an odd-one-out
  // reference is HELD here — PRE-CLAIM, flag-only. Drive the scope model + settings via the learning
  // stub (the service holds `learning` by reference). Real predicate: database/modules/prefix_outlier.
  const prefixOutlier = require('../../database/modules/prefix_outlier');
  const armedRec = () => prefixOutlier.buildScopeRec({ ...Object.fromEntries([...Array(12)].map((_, i) => ['DN-' + i, 1])), 'IN-1': 1, 'IN-2': 1 }); // DN dominant, IN a 2/14 stray
  let stubRec = armedRec();
  const settingVal = { prefix_outlier_confirm_guard_enabled: 'true' };
  deps.learning.getPrefixModelForScope = () => stubRec;
  deps.learning.getSetting = (_db, key, dflt) => (key === 'output_folder' ? '/out'
    : (key in settingVal ? settingVal[key] : (dflt !== undefined ? dflt : '/out')));

  const gatePayload = (id, extra = {}) => ({
    document_id: id, folder_path: '/in', original_filename: 'scan.pdf',
    corrections: {},   // ref NOT human-typed (a machine read)
    allValues: { supplier_name: 'Ridgeway', invoice_number: 'IN-14390', invoice_date: '01-01-2026' },
    supplier_name: 'Ridgeway', document_type: 'Invoice', document_type_slug: 'invoice', taught_fields: [], ...extra,
  });
  const seedExt = (id, val) => db.prepare(
    'INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?,?,?,?,?,?)')
    .run(id, 'invoice_number', val, val, 97, 'anchor_crop');
  const noteOf = (id) => String(db.prepare("SELECT validation_note FROM extractions WHERE document_id=? AND field_key='invoice_number'").get(id)?.validation_note || '');

  const gd1 = newDoc(db); seedExt(gd1, 'IN-14390');
  const commitBeforeGate = calls.commit;
  const gr1 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, gatePayload(gd1));
  check('outlier ref → ok:false, code PREFIX_OUTLIER', gr1.ok === false && gr1.code === 'PREFIX_OUTLIER');
  check('  → detail carries field/dominant/prefix', gr1.field === 'invoice_number' && gr1.dominant === 'DN' && gr1.prefix === 'IN');
  check('  → doc STILL needs_review (never claimed/filed)', get(db, gd1).status === 'needs_review' && get(db, gd1).stored_path === null);
  check('  → NOT filed (commit not called)', calls.commit === commitBeforeGate);
  check('  → validation_note written on the ref extraction', /IN.*DN/i.test(noteOf(gd1)));
  check('  → held audit written', calls.audit.some(e => e.action === 'confirm_held_prefix_outlier' && e.target_id === gd1));

  const gd2 = newDoc(db); seedExt(gd2, 'IN-14391');
  const gr2 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, gatePayload(gd2, { corrections: { invoice_number: { original_value: 'x', corrected_value: 'IN-14391' } } }));
  check('human-corrected outlier ref → EXEMPT (files)', gr2.ok === true && get(db, gd2).status === 'confirmed');

  const gd3 = newDoc(db); seedExt(gd3, 'IN-14392');
  const gr3 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, gatePayload(gd3, { acknowledgePrefixOutlier: ['invoice_number'] }));
  check('acknowledgePrefixOutlier ("Confirm anyway") → EXEMPT (files)', gr3.ok === true && get(db, gd3).status === 'confirmed');

  const gd4 = newDoc(db); seedExt(gd4, 'DN-777');
  const gr4 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, gatePayload(gd4, { allValues: { supplier_name: 'Ridgeway', invoice_number: 'DN-777', invoice_date: '01-01-2026' } }));
  check('dominant-prefix ref proceeds (no hold)', gr4.ok === true && get(db, gd4).status === 'confirmed');

  stubRec = null;   // disarmed scope
  const gd5 = newDoc(db); seedExt(gd5, 'IN-999');
  const gr5 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, gatePayload(gd5, { allValues: { supplier_name: 'Ridgeway', invoice_number: 'IN-999', invoice_date: '01-01-2026' } }));
  check('disarmed scope (no dominant) proceeds', gr5.ok === true && get(db, gd5).status === 'confirmed');
  stubRec = armedRec();

  settingVal.prefix_outlier_confirm_guard_enabled = 'false';
  const gd6 = newDoc(db); seedExt(gd6, 'IN-14396');
  const gr6 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, gatePayload(gd6));
  check('setting prefix_outlier_confirm_guard_enabled=false → gate off (files)', gr6.ok === true && get(db, gd6).status === 'confirmed');
  settingVal.prefix_outlier_confirm_guard_enabled = 'true';

  process.env.PREFIX_OUTLIER_CONFIRM_GUARD = '0';
  const gd7 = newDoc(db); seedExt(gd7, 'IN-14397');
  const gr7 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, gatePayload(gd7));
  check('env PREFIX_OUTLIER_CONFIRM_GUARD=0 → gate off (files)', gr7.ok === true && get(db, gd7).status === 'confirmed');
  delete process.env.PREFIX_OUTLIER_CONFIRM_GUARD;

  const gd8 = newDoc(db); seedExt(gd8, 'IN-14398');
  documents.update(db, gd8, { status: 'confirmed', stored_path: '/out/OLD8.pdf', stored_filename: 'OLD8.pdf', confirmed_by_username: 'sarah' });
  const gr8 = await svc.confirm(db, { username: 'sarah', role: 'admin' }, gatePayload(gd8, { allowRefile: true }));
  check('isRefile (allowRefile) SKIPS the gate (re-files)', gr8.ok === true);

  // ── HOLD-SIBLINGS release through the REAL confirm flow (Oracle blocking condition 2026-08-16) ──
  // Ordering bug a source-regex cannot catch: the release check runs SYNCHRONOUSLY inside confirm,
  // while the template re-write (onTaughtConfirm) is DETACHED — so before the taught-skip, a
  // genuine-change TEACH's own confirm released the very hold its teach created. Pinned end to end:
  // a taught confirm must NOT release; an ordinary agreeing sibling confirm must.
  console.log('\nhold-siblings release through confirm (taught never counts; a sibling does)');
  {
    const templates = require('../../database/modules/templates');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('template_identity_hold_siblings','true')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('teach_identity_near_match_keep','true')").run();
    const tplId = templates.create(db, { name: 'HoldT', document_type_slug: 'invoice',
      fields: [{ field_key: 'supplier_name', anchor_label: null, direction: 'right',
                 fixed_value: 'Old Company Ltd', is_variable: false }] });
    // The teach's promote step replaces the frozen identity with a DIFFERENT company → pending.
    templates.update(db, tplId, { fields: [{ field_key: 'supplier_name', anchor_label: null,
      direction: 'right', fixed_value: 'Quillstone Print & Packaging', is_variable: false }] });
    const pend = () => db.prepare('SELECT identity_unconfirmed AS u, identity_supported_count AS n FROM templates WHERE id = ?').get(tplId);
    check('genuine-change teach write marks the template pending', pend().u === 1);

    // The TEACH's own confirm (taught_fields non-empty, issuer = the new name) must NOT release.
    const td = newDoc(db);
    db.prepare('UPDATE documents SET template_id = ? WHERE id = ?').run(tplId, td);
    await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(td, {
      taught_fields: ['supplier_name'],
      allValues: { supplier_name: 'Quillstone Print & Packaging', invoice_number: 'INV-9', invoice_date: '01-01-2026' },
      supplier_name: 'Quillstone Print & Packaging' }));
    await flush();
    check('the TEACH\'s own confirm does NOT release the hold (the teach is the evidence being tested)',
          pend().u === 1 && pend().n === 0);

    // An ordinary (un-taught) sibling confirm naming the same issuer RELEASES it.
    const sd = newDoc(db);
    db.prepare('UPDATE documents SET template_id = ? WHERE id = ?').run(tplId, sd);
    await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(sd, {
      allValues: { supplier_name: 'Quillstone Print & Packaging', invoice_number: 'INV-10', invoice_date: '01-01-2026' },
      supplier_name: 'Quillstone Print & Packaging' }));
    await flush();
    check('one agreeing SIBLING confirm releases the hold', pend().u === 0 && pend().n === 1);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('template_identity_hold_siblings','false')").run();
  }

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails ? 1 : 0);
})();
