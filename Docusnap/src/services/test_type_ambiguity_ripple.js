'use strict';
/*
 * test_type_ambiguity_ripple.js — A6 of the type-split arc (2026-08-22; gary → Oracle SIGN-OFF-W/COND S1,
 * build LAST). The CONFIRM-ONCE RIPPLE: after a human confirms a document that carried the Fix A note
 * ("this letterhead is used for several document types"), the sender's other HELD documents on the
 * SAME template + SAME type that still carry that exact note are enqueued on the quiet lane as a
 * 'typesplit' job — never a stored-row note shed (a reprocess would re-plant it). The processing
 * handler's JS PRE-CHECK refuses (audit-skip) unless the A2 waiver is ON and every other-type template
 * the sender owns is unsupported (<2 confirmed docs).
 *
 * Pins:
 *   lane arm — selects only same-template + same-type + exact-note held docs; a PO-typed sibling on the
 *     same letterhead is never enqueued; a doc without the note is not; a filed/deferred/locked doc is
 *     not; arm OFF → skipped:off; no extraction row is mutated by selection.
 *   reviewService → after-hook carries typeSplitNoted (positive + negative control) and the post-confirm
 *     template id; a machine via never fires.
 *   scheduler pre-check — waiver OFF → audit 'waiver_off', no job; a SUPPORTED rival → audit
 *     'rival_supported:<slug>', no job; unsupported → the lane job is scheduled with the template id.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_type_ambiguity_ripple.js
 */
process.env.QUIET_REREAD_DEBOUNCE_MS = '60';   // the lane coalesces bursts over 8 s in production
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const quietLane = require(path.join(ROOT, 'src', 'modules', 'processing', 'quietLane'));
const { createReviewService } = require('./reviewService');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const NOTE = 'This letterhead is used for several document types and the type could not be confirmed on this scan — please check the document type is correct before filing.';

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (7, 'Quote', 'quote', 0, 'quote_number', 'quote_date')").run();
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (3, 'Purchase Order', 'purchase_order', 1, 'po_number', 'po_date')").run();
for (const [t, k] of [[7, 'supplier_name'], [7, 'quote_number'], [7, 'quote_date'], [3, 'supplier_name'], [3, 'po_number'], [3, 'po_date']])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (?, ?, ?, 'text', 1, 1, 1)").run(t, k, k);
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (10, 'Nordwind Refrigeration Ltd', 'nordwind', 'quote')").run();
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (10, 'supplier_name', 'Nordwind Refrigeration Ltd')").run();
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (12, '1 Refrigeration Ltd', 'rival', 'purchase_order')").run();
const SUP = 'Nordwind Refrigeration Ltd';
const mk = ({ template = 10, typeId = 7, status = 'needs_review', note = NOTE, supplier = SUP, wf = null } = {}) => {
  const id = Number(documents.insert(db, { original_filename: `q${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status, supplier_name: supplier, document_type_id: typeId, template_id: template }).lastInsertRowid);
  db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note) VALUES (?, 'supplier_name', ?, ?, 98, 'logo', ?)").run(id, supplier, supplier, note);
  db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, 'quote_number', 'NRQ-1', 'NRQ-1', 97, 'template_mapping')").run(id);
  if (wf) db.prepare('UPDATE documents SET workflow_status = ? WHERE id = ?').run(wf, id);
  return id;
};
const S1 = mk();                                              // the sibling: same template, same type, noted
const S2 = mk();                                              // another
const S3 = mk({ note: null });                                // same template/type but NOT noted → never
const S4 = mk({ template: 12, typeId: 3 });                   // a PO-typed sibling on the rival template → never re-typed
const S5 = mk({ status: 'confirmed' });                       // filed → never
const S6 = mk({ status: 'deferred' });                        // parked → never
const S7 = mk({ wf: 'pending' });                             // workflow-locked → never
const S8 = mk({ template: 10, typeId: 3 });                   // same template, OTHER type id → never (the arm is type-scoped)

let rippleOn = true;
const audits = [], staged = [];
let shardResolve = null;
const lane = quietLane.create({
  getDb: () => db, enabled: () => true, isForegroundBusy: () => false,
  stageDocs: (d, chunk) => { staged.push(chunk.map(c => c.docId)); return { tmpNames: chunk.map(c => `rb_${c.docId}.pdf`), nameToDoc: Object.fromEntries(chunk.map(c => [`rb_${c.docId}.pdf`, { docId: c.docId, filename: c.filename, via: c.via || null, existing: [] }])), cleanup: () => {} }; },
  runShard: () => new Promise(res => { shardResolve = res; }),
  applyResult: () => ({ ok: true }),
  presence: { viewers: () => [] }, extractionsFingerprint: () => 'fp',
  notify: () => {}, logAudit: (_d, e) => audits.push(e),
  logger: null, setPriority: () => {}, taskkill: () => {}, markScopeActive: () => {}, onJobDone: () => {},
  findSiblings: () => [], kwSelect: () => null, kwSelectEnabled: () => false, scopeTemplateIds: () => new Set(),
  layoutArm: { enabled: () => false, onPage: () => false, nameTokens: () => new Set() }, corroborated: () => false,
  typeSplitArm: { enabled: () => rippleOn },
});
const lastJobAudit = () => audits.filter(a => a.action === 'quiet_reprocess_job').slice(-1)[0];

(async () => {
  console.log('§1 the lane arm — population');
  const before = db.prepare('SELECT COUNT(*) n FROM extractions').get().n;
  lane.schedule(db, { supplier: SUP, typeSlug: 'quote', reason: 'typesplit', seedDocId: S1, typeSplitTemplateId: 10 });
  await sleep(150);
  const sel = (staged[0] || []).slice().sort((a, b) => a - b);
  check('selects exactly the same-template, same-type, still-noted held siblings (S1, S2)', sel.join() === [S1, S2].join(), sel.join());
  check('…never the un-noted sibling, the PO-typed rival-template doc, a filed/deferred/locked doc, or the other-type doc on the same template',
        ![S3, S4, S5, S6, S7, S8].some(x => sel.includes(x)));
  check('selection mutates no extraction row', db.prepare('SELECT COUNT(*) n FROM extractions').get().n === before);
  shardResolve && shardResolve(); await sleep(80);
  check("audit: reasons=typesplit, type_split_arm selected:2", lastJobAudit() && lastJobAudit().metadata.reasons === 'typesplit' && lastJobAudit().metadata.type_split_arm === 'selected:2',
        JSON.stringify(lastJobAudit() && lastJobAudit().metadata));

  console.log('\n§2 the arm OFF / no template id');
  rippleOn = false; staged.length = 0;
  lane.schedule(db, { supplier: SUP, typeSlug: 'quote', reason: 'typesplit', seedDocId: S1, typeSplitTemplateId: 10 });
  await sleep(150);
  check('arm OFF → nothing staged, audited skipped:off', (staged.length === 0 || (staged[0] || []).length === 0));
  shardResolve && shardResolve(); await sleep(80);
  check('…audit says skipped:off', lastJobAudit() && lastJobAudit().metadata.type_split_arm === 'skipped:off');
  rippleOn = true;

  console.log('\n§3 reviewService → the after-hook carries typeSplitNoted + the post-confirm template');
  const hooks = [];
  const deps = {
    documents, learning: { getSetting: () => '/out', saveCorrections: () => {}, findNearMatchIdentity: () => ({ near: false }) },
    doctypes: { getWithFields: () => ({ id: 7, name: 'Quote', slug: 'quote', ref_field_key: 'quote_number', date_field_key: 'quote_date' }) },
    typeSplit: { checkTypeSplit: () => ({ split: false }) },
    filing: { normaliseDate: (v) => v, commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/m.xml', srcPath: '/in/scan.pdf' }) },
    fs: { existsSync: () => true, unlinkSync: () => {} }, path, logger: null, audit: () => {},
    onAfterConfirm: (_d, info) => hooks.push(info),
  };
  const svc = createReviewService(deps);
  const payload = (id) => ({ document_id: id, folder_path: '/in', original_filename: 'q.pdf', corrections: {},
    allValues: { supplier_name: SUP, quote_number: 'NRQ-1', quote_date: '01-01-2026' }, supplier_name: SUP, document_type: 'Quote', document_type_slug: 'quote', taught_fields: [] });
  const N1 = mk();                                             // noted
  const r1 = await svc.confirm(db, { username: 'chris', role: 'admin' }, payload(N1));
  check('a human confirm of a NOTED doc files', r1.ok === true, JSON.stringify(r1));
  const h1 = hooks.slice(-1)[0];
  check('…the after-hook carries typeSplitNoted=true and the template id (10)', h1 && h1.typeSplitNoted === true && h1.templateId === 10, JSON.stringify(h1));
  const N2 = mk({ note: null });                               // NOT noted — negative control
  await svc.confirm(db, { username: 'chris', role: 'admin' }, payload(N2));
  check('NEGATIVE CONTROL: an un-noted doc → typeSplitNoted=false', hooks.slice(-1)[0].typeSplitNoted === false);
  const N3 = mk();
  const hooksBefore = hooks.length;
  await svc.confirm(db, { username: 'chris', role: 'admin' }, payload(N3), { via: 'scope_sweep' });
  check('a machine via never reaches the after-hook', hooks.length === hooksBefore);

  console.log('\n§4 the scheduler pre-check (processing/handler.scheduleTypeSplitReread)');
  const ph = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler'));
  const fakeAuth = { requireLogin() { return { username: 'a', role: 'admin' }; }, requireRole() { return { username: 'a', role: 'admin' }; }, getCurrentUser() { return { username: 'a', role: 'admin' }; }, hasRole() { return true; }, logAudit(_d, e) { audits.push(e); } };
  const authPath = require.resolve(path.join(ROOT, 'src', 'modules', 'auth', 'handler'));
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
  const licPath = require.resolve(path.join(ROOT, 'src', 'modules', 'licensing', 'handler'));
  require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: new Proxy({}, { get: () => () => null }) };
  const H = {};
  ph.register({ ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} }, getDb: () => db, resourcePath: (...p) => path.join(ROOT, ...p),
    pythonExe: () => 'py', pythonArgs: (s, ...a) => [s, ...a], tesseractPath: () => '', backendScript: () => '', configPath: () => '',
    templatesDir: () => require('os').tmpdir(), createWindow: () => null, getMainWindow: () => null, notifyMainWindow: () => {}, notifyAllWindows: () => {},
    safeSend: () => {}, notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {}, reviewTraceActive: false,
    devSliceDir: require('os').tmpdir(), windows: {}, app: null, fs: require('fs'), logger: null, spawn: () => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } }), path });
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('quiet_reread_enabled', 'true')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('type_ambiguity_ripple', 'true')").run();
  const skipAudit = () => audits.filter(a => a.action === 'type_split_ripple_skipped').slice(-1)[0];
  let r = ph.scheduleTypeSplitReread(db, { supplier: SUP, typeSlug: 'quote', templateId: 10, seedDocId: S1 });
  check("waiver OFF → no job, audited 'waiver_off'", r === false && skipAudit() && /waiver_off/.test(skipAudit().details));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('type_ambiguity_unsupported_waiver', 'true')").run();
  // make the rival SUPPORTED: two confirmed docs on template 12 naming the sender
  const c1 = mk({ template: 12, typeId: 3, status: 'confirmed', note: null }), c2 = mk({ template: 12, typeId: 3, status: 'confirmed', note: null });
  r = ph.scheduleTypeSplitReread(db, { supplier: SUP, typeSlug: 'quote', templateId: 10, seedDocId: S1 });
  check("a SUPPORTED rival (2 confirmed) → no job, audited 'rival_supported:purchase_order'", r === false && /rival_supported:purchase_order/.test(skipAudit().details), skipAudit() && skipAudit().details);
  db.prepare('DELETE FROM documents WHERE id IN (?, ?)').run(c1, c2);
  r = ph.scheduleTypeSplitReread(db, { supplier: SUP, typeSlug: 'quote', templateId: 10, seedDocId: S1 });
  check('rival unsupported (0 confirmed) + waiver ON → the lane job is scheduled', r === true);
  check('a machine via never schedules', ph.scheduleTypeSplitReread(db, { supplier: SUP, typeSlug: 'quote', templateId: 10, seedDocId: S1, via: 'scope_sweep' }) === false);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('type_ambiguity_ripple', 'false')").run();
  check('ripple setting OFF → never schedules', ph.scheduleTypeSplitReread(db, { supplier: SUP, typeSlug: 'quote', templateId: 10, seedDocId: S1 }) === false);

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
