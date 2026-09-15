'use strict';
/**
 * test_intake_guard.js — the Quick File write-side safety (Oracle Q-C2 + Conditions C/D, 2026-09-15).
 *
 * A Quick-Filed doc (intake='direct', confirmed, typed) must NEVER re-enter Review / OCR / the write-side
 * learning path. This pins the BEHAVIOUR of every door with a REAL in-memory DB + a real typed row minted
 * by directIntakeService.submit, plus a control (a normal confirmed / needs_review doc):
 *   §1 the helper (isDirectIntake / guard / refuse, column-tolerant)
 *   §2 the structural belt (deconfirmDocument + requeueConfirmedDocsForScope): control requeues, intake skipped
 *   §3 reviewService.confirm: intake REFUSED before any write — saveCorrections spy stays 0, no learning rows
 *   §4 repairService.sendBackToReview: intake refused; control proceeds
 *   §5 Condition C: delete/restore never retracts/replants a typed doc; control round-trips
 *   §6 trade-off: an intake doc is refused at EVERY door and stays confirmed with intake='direct'
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_intake_guard.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const documents = require('../../database/modules/documents');
const intakeGuard = require('../lib/intakeGuard');
const repairService = require('./repairService');
const { createReviewService } = require('./reviewService');
const svc = require('./directIntakeService');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; return c; };
const get = (db, id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  const inv = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key, reading_mode, built_in) VALUES ('Filed Document','filed_document','reference_number','doc_date','none',0)").run().lastInsertRowid;
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('direct_intake_enabled','true')").run();
  return { db, inv };
}
const EDIT = { role: 'edit', username: 'chris' };
const intakeDeps = () => ({
  path, fs: { unlinkSync: () => {} },
  outputRoot: '/out', inboxDir: '/inbox',
  ensureWorkingCopy: (_fs, _p, _inbox, _src, id, name) => `/inbox/${id}${path.extname(name)}`,
  commitDocument: async ({ originalFilename }) => ({ success: true, filename: `Filed.${originalFilename}`, filePath: `/out/Acme/2026/September/Filed.${originalFilename}` }),
  normaliseDate: (s) => s,
  extractSearchText: async () => '',
  logAudit: () => {}, now: () => '2026-09-15T00:00:00Z',
});
// Mint a REAL typed row via the Quick File lane.
async function mintIntake(db, inv) {
  const r = await svc.submit(db, EDIT, { srcPath: 'C:/src/Lease.docx', ext: '.docx', size: 1024,
    documentTypeId: inv, party: 'Acme Ltd', date: '12-09-2026', title: 'Lease', reference: 'OL-1', notes: '' }, intakeDeps());
  return r.docId;
}
// A normal confirmed (scanned) doc of the SAME type, intake NULL.
function mkConfirmed(db, inv) {
  return Number(db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, document_type_id, stored_path, confirmed_at) VALUES ('scan.pdf','/in','confirmed','Beta Co',?, '/out/F.pdf', datetime('now'))").run(inv).lastInsertRowid);
}

(async () => {
console.log('§1 helper — isDirectIntake / guard / refuse');
{
  const { db, inv } = freshDb();
  const intakeId = await mintIntake(db, inv);
  const ctlId = mkConfirmed(db, inv);
  check('isDirectIntake true for a typed row', intakeGuard.isDirectIntake(db, intakeId) === true);
  check('isDirectIntake false for a scanned row', intakeGuard.isDirectIntake(db, ctlId) === false);
  check('isDirectIntake false for a missing id', intakeGuard.isDirectIntake(db, 999999) === false);
  const g = intakeGuard.guard(db, intakeId, 'confirm');
  check('guard(intake) refuses with the code + a plain sentence', g && g.ok === false && g.error === 'quick_file_not_reviewable' && /Quick Filed/.test(g.message));
  check('guard(control) returns null (proceed)', intakeGuard.guard(db, ctlId, 'confirm') === null);
  // column-tolerant: a documents table with NO intake column must not throw → false.
  const raw = new Database(':memory:');
  raw.prepare('CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT)').run();
  raw.prepare("INSERT INTO documents (id,status) VALUES (1,'confirmed')").run();
  check('isDirectIntake false when the intake column is absent (pre-mig-165)', intakeGuard.isDirectIntake(raw, 1) === false);
}

console.log('§2 belt — deconfirmDocument + requeueConfirmedDocsForScope');
{
  const { db, inv } = freshDb();
  const intakeId = await mintIntake(db, inv);
  const ctlId = mkConfirmed(db, inv);
  const r1 = documents.deconfirmDocument(db, ctlId);
  check('deconfirmDocument moves a real confirmed doc (changes:1, now needs_review)', r1.changes === 1 && get(db, ctlId).status === 'needs_review');
  const r2 = documents.deconfirmDocument(db, intakeId);
  check('deconfirmDocument REFUSES a typed doc (changes:0, still confirmed)', r2.changes === 0 && get(db, intakeId).status === 'confirmed');
  // requeue over a scope holding BOTH: a fresh control + the (still-confirmed) intake, same type.
  const ctl2 = mkConfirmed(db, inv);
  const rq = documents.requeueConfirmedDocsForScope(db, { document_type_slug: 'filed_document' });
  check('requeue moved the scanned doc but NOT the typed one (intake-scoped, not blanket)',
    get(db, ctl2).status === 'needs_review' && get(db, intakeId).status === 'confirmed' && rq.changes === 1);
}

console.log('§3 reviewService.confirm — a typed doc is refused BEFORE any learning write');
{
  const { db, inv } = freshDb();
  const intakeId = await mintIntake(db, inv);
  const calls = { saveCorrections: 0 };
  const rs = createReviewService({
    documents,
    learning: { getSetting: () => '/out', saveCorrections: () => { calls.saveCorrections++; } },
    doctypes: { getWithFields: () => ({ id: inv, name: 'Filed Document', ref_field_key: 'reference_number', date_field_key: 'doc_date' }) },
    filing: { normaliseDate: (s) => s, commitDocument: async () => ({ success: true, filename: 'F', filePath: '/out/F' }) },
    fs: { existsSync: () => true, unlinkSync: () => {} }, path,
  });
  const res = await rs.confirm(db, EDIT, { document_id: intakeId, allValues: { supplier_name: 'Hacked Ltd', reference_number: 'X' }, corrections: { reference_number: 'X' }, document_type_slug: 'filed_document' });
  check('confirm returns QUICK_FILE_NOT_REVIEWABLE', res && res.ok === false && res.code === 'QUICK_FILE_NOT_REVIEWABLE');
  check('the refusal carries the plain sentence', /Quick Filed/.test(res.error || ''));
  check('saveCorrections was NOT called (guard precedes the learning write)', calls.saveCorrections === 0);
  check('no corrections rows written for the typed doc', db.prepare('SELECT COUNT(*) n FROM corrections WHERE document_id = ?').get(intakeId).n === 0);
  check('no supplier_hints rows written for the typed doc', db.prepare('SELECT COUNT(*) n FROM supplier_hints').get().n === 0);
  check('the typed doc is untouched — still confirmed, supplier not overwritten', get(db, intakeId).status === 'confirmed' && get(db, intakeId).supplier_name === 'Acme Ltd');
}

console.log('§4 repairService.sendBackToReview — typed doc refused, control proceeds');
{
  const { db, inv } = freshDb();
  const intakeId = await mintIntake(db, inv);
  const ctlId = mkConfirmed(db, inv);
  const r = repairService.sendBackToReview(db, intakeId, { source: 'search' });
  check('sendBackToReview refuses a typed doc with the code', r && r.ok === false && r.error === 'quick_file_not_reviewable');
  check('the typed doc stays confirmed', get(db, intakeId).status === 'confirmed');
  const r2 = repairService.sendBackToReview(db, ctlId, { source: 'search' });
  check('sendBackToReview works on a real confirmed doc (now needs_review)', r2 && r2.ok === true && get(db, ctlId).status === 'needs_review');
}

console.log('§5 Condition C — delete/restore never retracts/replants a typed doc');
{
  const { db, inv } = freshDb();
  const intakeId = await mintIntake(db, inv);
  const ctlId = mkConfirmed(db, inv);
  const d1 = repairService.deleteToRecycleBin(db, intakeId);
  check('typed doc soft-deletes', d1.ok === true);
  check('no learning_retracted_at stamped on the typed doc (nothing was planted)', get(db, intakeId).learning_retracted_at == null);
  const r1 = repairService.restoreFromRecycleBin(db, intakeId);
  check('typed doc restores cleanly, no replant', r1.ok === true && r1.replanted == null && get(db, intakeId).status === 'confirmed');
  // control: a normal confirmed doc DOES stamp learning_retracted_at on delete (the retract branch ran).
  const d2 = repairService.deleteToRecycleBin(db, ctlId);
  check('control confirmed doc stamps learning_retracted_at on delete (retract branch ran)', d2.ok === true && get(db, ctlId).learning_retracted_at != null);
}

console.log('§6 trade-off — a typed doc is refused at EVERY door and stays confirmed');
{
  const { db, inv } = freshDb();
  const intakeId = await mintIntake(db, inv);
  const doors = [
    documents.deconfirmDocument(db, intakeId).changes === 0,
    repairService.sendBackToReview(db, intakeId, {}).ok === false,
    intakeGuard.guard(db, intakeId, 'reprocess') !== null,
    intakeGuard.guard(db, intakeId, 'confirm') !== null,
  ];
  check('every door refused (deconfirm/send-back/reprocess/confirm)', doors.every(Boolean));
  check('the typed doc is STILL confirmed with intake=direct', (() => { const d = get(db, intakeId); return d.status === 'confirmed' && d.intake === 'direct'; })());
}

console.log(fails === 0 ? '\nintake-guard: ALL PASS' : `\nintake-guard: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
})();
