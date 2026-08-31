'use strict';
/*
 * test_review_events_doors.js — B1 of the activity-strip arc (2026-08-22; barry + eric → Oracle
 * SIGN-OFF-W/COND C1/C5/C7). The four DOORS that feed the review activity ledger, through the REAL
 * processing handler (fake ipcMain, stubbed filing), plus the event-id-addressed IPC.
 *
 * Pins (a positive control per door):
 *   • scope auto-accept (human confirm → the server files the sender's ready siblings) → ONE `self_filed`
 *     event per accept call with the filed ids, sweep-undoable, broadcast as `review-event`;
 *   • the HUMAN "File N" (`sweep-scope-accept`) → ONE `approved` event (the door the old tile never saw);
 *   • the class fix → a `class_fix` event with its batchId (via reviewService's recordReviewEvent dep);
 *   • the legacy `sweep-scope-undo` → a `put_back` event;
 *   • `get-review-events` returns counts + bySender, never an id list (C5);
 *   • `get-review-event-docs(eventId)` resolves ids SERVER-side;
 *   • `review-event-undo(eventId)`: chunked sweep undo with honest {undone, refused}; a non-sweep row is
 *     refused; an unknown event / a non-undoable kind is refused; an undo records a `put_back`.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_review_events_doors.js
 */
process.env.REVIEW_EVENTS_BURST_GAP_MS = '500';   // the ledger merges bursts over 60 s in production
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const learning  = require('../../../database/modules/learning');
const { createReviewService } = require('../../services/reviewService');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; return cond; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, l] of [['supplier_name', 'Document Issuer'], ['invoice_number', 'Invoice Number'], ['invoice_date', 'Invoice Date']])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1, ?, ?, 'text', 1, 1)").run(k, l);
for (const [k, v] of [['auto_file_threshold', '90'], ['scope_sweep_enabled', 'true'], ['scope_sweep_auto_accept', 'true'],
                      ['learning_exclude_machine_confirms', 'true'], ['autofile_gate_unify', 'true'], ['output_folder', '/out']])
  learning.setSetting(db, k, v);

let nextRef = 100;
function mkDoc(supplier, { conf = 100, status = 'needs_review' } = {}) {
  const id = Number(documents.insert(db, { original_filename: `${supplier}-${nextRef}.pdf`, folder_path: '/in', status,
    supplier_name: supplier, document_type_id: 1, overall_confidence: conf }).lastInsertRowid);
  const ins = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(id, 'supplier_name', supplier, supplier, 95, 'template_fixed');
  ins.run(id, 'invoice_number', `INV-${nextRef}`, `INV-${nextRef}`, 98, 'template_mapping');
  ins.run(id, 'invoice_date', '01-06-2026', '01-06-2026', 98, 'template_mapping');
  nextRef++;
  return id;
}
const status = (id) => db.prepare('SELECT status, confirmed_via FROM documents WHERE id = ?').get(id);
const audits = [];
const svc = createReviewService({
  documents, learning,
  doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', slug: 'invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
  filing: { normaliseDate: require('../filing/handler').normaliseDate,
            commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml', srcPath: '/in/x.pdf' }) },
  fs: { existsSync: () => true, unlinkSync: () => {} }, path, logger: null,
  audit: (_db, e) => audits.push(e),
  onAfterConfirm: (d, info) => require('./handler').scheduleScopeAutoAccept(d, { supplier: info.supplier_name, typeSlug: info.typeSlug, via: info.via }),
  recordReviewEvent: (d, ev) => require('./handler').recordReviewEvent(d, ev),
  releaseDelayMs: 0,
});
const revPath = require.resolve('../review/handler');
require.cache[revPath] = { id: revPath, filename: revPath, loaded: true, exports: { getReviewService: () => svc } };
const fakeAuth = { requireLogin() { return { username: 'sarah', role: 'admin' }; }, requireRole() { return { username: 'sarah', role: 'admin' }; }, getCurrentUser() { return { username: 'sarah', role: 'admin' }; }, hasRole() { return true; }, logAudit(_d, e) { audits.push(e); } };
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const licPath = require.resolve('../licensing/handler');
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) }) };

const H = {};
const ROOT = path.join(__dirname, '..', '..', '..');
const broadcasts = [], allWin = [];
const handler = require('./handler');
handler.register({
  ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} },
  getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p), pythonExe: () => 'py', pythonArgs: (...a) => a,
  tesseractPath: () => 'tesseract', backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
  configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'), templatesDir: () => os.tmpdir(),
  createWindow: () => null, getMainWindow: () => null,
  notifyMainWindow: (ch, payload) => broadcasts.push({ ch, payload }), notifyAllWindows: (ch, payload) => allWin.push({ ch, payload }), safeSend: () => {},
  notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
  reviewTraceActive: false, devSliceDir: path.join(os.tmpdir(), 'ds-devslices-test'),
  windows: {}, app: null, fs, logger: { log: () => {}, warn: (m) => console.log('    [warn]', m), err: (m) => console.log('    [err]', m) },
  spawn: () => { throw new Error('spawn must not run in this test'); }, path,
});
const humanConfirm = (id, supplier) => svc.confirm(db, { username: 'sarah', role: 'admin' }, {
  document_id: id, folder_path: '/in', original_filename: 'x.pdf', corrections: {}, taught_fields: [],
  allValues: { supplier_name: supplier, invoice_number: 'INV-1', invoice_date: '01-06-2026' },
  supplier_name: supplier, document_type: 'Invoice', document_type_slug: 'invoice' });
const events = () => H['get-review-events']({});

(async () => {
  console.log('§1 door: the scope auto-accept → ONE self_filed event (the positive control)');
  const a0 = mkDoc('Acme'), a1 = mkDoc('Acme'), a2 = mkDoc('Acme');
  await humanConfirm(a0, 'Acme');
  await sleep(2600);
  check('the siblings filed by the server', status(a1).confirmed_via === 'scope_sweep' && status(a2).confirmed_via === 'scope_sweep');
  let evs = events();
  check('one self_filed event, count 2, keyed on the sender, sweep-undoable', evs.length === 1 && evs[0].kind === 'self_filed' && evs[0].count === 2
        && evs[0].scope.supplier === 'Acme' && evs[0].undo && evs[0].undo.type === 'sweep' && evs[0].undoable === true, JSON.stringify(evs));
  check('…the public event carries bySender and NO id list (C5)', evs[0].bySender && evs[0].bySender.Acme === 2 && !('ids' in evs[0]));
  check('…broadcast to every window as review-event', allWin.some(b => b.ch === 'review-event' && b.payload && b.payload.kind === 'self_filed'));
  const docsR = H['get-review-event-docs']({}, { eventId: evs[0].id });
  check('get-review-event-docs resolves the ids SERVER-side', docsR.ok && docsR.docs.map(d => d.id).sort().join() === [a1, a2].sort().join());

  console.log('\n§2 door: the HUMAN "File N" (sweep-scope-accept) → ONE approved event');
  await sleep(700);    // past the (test-shortened) burst gap so the next receipt is its own event   // past the burst gap so the next receipt is its own event
  const c1 = mkDoc('Bolt'), c2 = mkDoc('Bolt'), c3 = mkDoc('Bolt');
  // the real sequence: the server computes + remembers the OFFER (Oracle C8), the click sends back what it offered
  const offer = await H['sweep-scope-candidates']({}, { supplier: 'Bolt', typeSlug: 'invoice' });
  const accepts = (offer && offer.candidates ? offer.candidates : []).map(c => ({ docId: c.docId, fingerprint: c.fingerprint }));
  check("the server offered Bolt's 3 ready docs", accepts.length === 3, JSON.stringify(offer).slice(0, 300));
  const r2 = await H['sweep-scope-accept']({}, { supplier: 'Bolt', typeSlug: 'invoice', accepts, untickedIds: [] });
  check('the human accept filed 3', r2 && r2.ok && r2.filed.length === 3, JSON.stringify(r2));
  evs = events();
  check('newest event: approved (the click), count 3, Bolt, sweep-undoable', evs[0].kind === 'approved' && evs[0].approved === true && evs[0].count === 3 && evs[0].scope.supplier === 'Bolt' && evs[0].undo.type === 'sweep');

  console.log('\n§3 undo by EVENT (C7): chunked, honest, records a put_back');
  // make one of the three NOT a sweep row (a human re-file) so the undo must refuse it honestly
  db.prepare("UPDATE documents SET confirmed_via = NULL WHERE id = ?").run(c3);
  const u = await H['review-event-undo']({}, { eventId: evs[0].id });
  check('undo: 2 undone, 1 refused (not a scope_sweep row)', u.ok && u.undone.sort().join() === [c1, c2].sort().join() && u.refused.join() === String(c3), JSON.stringify(u));
  check('…the two are back in review', status(c1).status === 'needs_review' && status(c2).status === 'needs_review' && status(c3).status === 'confirmed');
  evs = events();
  check('…the undo is itself a receipt (put_back, count 2)', evs[0].kind === 'put_back' && evs[0].count === 2);
  check('unknown event id → refused', !(await H['review-event-undo']({}, { eventId: 999999 })).ok);
  // Chris round 17 card 7: the undone event stops offering Put back; a second press is refused honestly
  const undoneEv = evs.find(e => e.kind === 'approved' && e.scope.supplier === 'Bolt');
  check('the undo returned the updated event with undo gone', u.event && u.event.id === undoneEv.id && u.event.undo === null && u.event.undoable === false);
  check('…and the ledger no longer offers Put back on it', events().find(e => e.id === undoneEv.id).undoable === false);
  const again = await H['review-event-undo']({}, { eventId: undoneEv.id });
  check("a second press → { reason: 'already-put-back' }, nothing touched", !again.ok && again.reason === 'already-put-back' && again.undone.length === 0
        && status(c1).status === 'needs_review' && status(c3).status === 'confirmed');
  check('an auto_filed (100 %) event is never undoable', (() => { require('./handler').recordReviewEvent(db, { kind: 'auto_filed', ids: [a0], scope: { supplier: 'Acme', typeSlug: 'invoice' }, undo: null }); return events()[0].undoable === false; })());
  const r3 = await H['review-event-undo']({}, { eventId: events()[0].id });
  check('…and its undo is refused server-side', !r3.ok && r3.reason === 'not-undoable');

  console.log('\n§4 door: the legacy sweep-scope-undo records a put_back too');
  await sleep(700);    // past the (test-shortened) burst gap so the next receipt is its own event
  const d1 = mkDoc('Crane'), d2 = mkDoc('Crane');
  const offer2 = await H['sweep-scope-candidates']({}, { supplier: 'Crane', typeSlug: 'invoice' });
  const acc2 = (offer2 && offer2.candidates ? offer2.candidates : []).map(c => ({ docId: c.docId, fingerprint: c.fingerprint }));
  const ra = await H['sweep-scope-accept']({}, { supplier: 'Crane', typeSlug: 'invoice', accepts: acc2, untickedIds: [] });
  check('Crane filed by the human click', ra && ra.ok && ra.filed.length === 2, JSON.stringify(ra));
  const lu = H['sweep-scope-undo']({}, { docIds: [d1] });
  check('legacy undo put one back', lu.ok && lu.undone.join() === String(d1), JSON.stringify(lu));
  check('…recorded as put_back', events()[0].kind === 'put_back' && events()[0].count === 1);

  console.log('\n§5 door: the class fix → class_fix with its batchId (through reviewService)');
  const cfDocs = [mkDoc('Pelican'), mkDoc('Pelican')];
  require('./handler').recordReviewEvent(db, { kind: 'class_fix', ids: cfDocs, scope: { supplier: 'Pelican', typeSlug: 'invoice' }, undo: { type: 'classfix', batchId: 'cf1' } });
  check('class_fix event keeps the batch handle and is undoable', events()[0].kind === 'class_fix' && events()[0].undo.batchId === 'cf1' && events()[0].undoable === true);
  const cu = await H['review-event-undo']({}, { eventId: events()[0].id });
  check('…an expired batch is refused honestly (in-memory batches die with the process)', !cu.ok && cu.reason === 'expired');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'reviewService.js'), 'utf8');
  check('source: reviewService records class_fix from the applyForConfirm result with its batchId',
        /recordReviewEvent\(db, \{ kind: 'class_fix', ids: _classFix\.docs\.map\(d => d\.id\)/.test(src) && /undo: \{ type: 'classfix', batchId: _classFix\.batchId \}/.test(src));

  console.log('\n§6 the renderer never sends ids');
  const pre = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  check('preload: undo/see-them take an EVENT id only', /undoReviewEvent:\s*\(eventId\)\s*=> ipcRenderer\.invoke\('review-event-undo', \{ eventId \}\)/.test(pre)
        && /getReviewEventDocs:\s*\(eventId\)\s*=> ipcRenderer\.invoke\('get-review-event-docs', \{ eventId \}\)/.test(pre));
  check('seen marks up to an event id', H['review-events-seen']({}, { uptoId: events()[0].id }).ok && events().every(e => e.seen === true));

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
