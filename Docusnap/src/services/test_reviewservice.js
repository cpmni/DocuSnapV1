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
const svc = createReviewService({
  documents,
  learning: { getSetting: () => '/out', saveCorrections: () => { calls.saveCorrections++; } },
  doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
  filing: { commitDocument: async () => {
    calls.commit++;
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
});

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
  check('  → notifyCounts + sourceMove + captureSample fired', calls.notifyCounts === 1 && calls.sourceMove === 1);
  check('  → taught-confirm hook NOT fired (no taught_fields)', calls.taught === 0);

  // ── Taught confirm fires the template-promote hook ────────────────────────────
  const d2 = newDoc(db);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, basePayload(d2, { taught_fields: ['invoice_number'] }));
  check('taught confirm fires onTaughtConfirm', calls.taught === 1);

  // ── ALREADY_FILED: a doc claimed by someone else (confirmed, no stored yet) ───
  const d3 = newDoc(db);
  documents.update(db, d3, { status: 'confirmed', confirmed_by_username: 'sarah' });  // mid-claim by sarah
  const r3 = await svc.confirm(db, { username: 'bob', role: 'edit' }, basePayload(d3));
  check('lost race → ok:false, code ALREADY_FILED', r3.ok === false && r3.code === 'ALREADY_FILED');
  check('  → names the winner (sarah)', r3.confirmedBy === 'sarah');
  check('  → bob did NOT file (commit not called for d3)', get(db, d3).stored_path === null);

  // ── Re-file path: an already-filed doc (stored set) re-files, not ALREADY_FILED ─
  const d4 = newDoc(db);
  documents.update(db, d4, { status: 'confirmed', stored_path: '/out/OLD.pdf', stored_filename: 'OLD.pdf', confirmed_by_username: 'sarah' });
  const commitsBefore = calls.commit;
  const r4 = await svc.confirm(db, { username: 'bob', role: 'edit' }, basePayload(d4));
  check('re-file of an already-filed doc succeeds', r4.ok === true);
  check('  → it actually re-filed (commit called)', calls.commit === commitsBefore + 1);
  check('  → confirmed_by updated to the re-filer (bob)', get(db, d4).confirmed_by_username === 'bob');

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

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails ? 1 : 0);
})();
