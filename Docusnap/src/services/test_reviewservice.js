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
  learning: { getSetting: () => '/out', saveCorrections: (_db, _id, corr, _s, _slug, allValues) => { calls.saveCorrections++; calls.lastAllValues = allValues; calls.lastCorrections = corr; } },
  doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
  filing: {
    normaliseDate: require('../modules/filing/handler').normaliseDate,   // the real canonical normaliser
    commitDocument: async ({ allValues }) => {
      calls.commit++; calls.commitAllValues = allValues;
      return filingMode === 'fail'
        ? { success: false, error: 'disk full' }
        : { success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml', srcPath: '/in/scan.pdf' };
    } },
  fs: { existsSync: () => false, unlinkSync: () => {} },
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

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails ? 1 : 0);
})();
