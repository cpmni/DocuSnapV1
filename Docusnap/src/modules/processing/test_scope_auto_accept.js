#!/usr/bin/env node
'use strict';
/*
 * test_scope_auto_accept.js — PINs for Slice 1: the SCOPE-LOCAL auto-accept of the post-confirm
 * sweep offer (barry+gary → Oracle SIGN-OFF-WITH-CONDITIONS S1-C1..C6, 2026-08-21; DARK behind
 * `scope_sweep_auto_accept`).
 *
 * WHY IT EXISTS. The owner: "they must confirm 2 more and then REMEMBER to press Reprocess this
 * supplier". Chris r12: after the confirms the siblings became "one-click ready" — the consent bar
 * doing its job — but never filed. The Oracle ruled the human glance is not load-bearing for safety
 * (the accept files only what `isAutoFileEligible` passes on STORED rows — the predicate the import
 * path files with no click) but IS load-bearing against the 08-12 incident's SHAPE (queue-wide).
 * Hence: auto-accept ONLY the scope of the confirm that triggered it; every other sender stays a bar.
 *
 * Driven through the REAL processing handler (fake ipcMain/auth) and a REAL reviewService (stubbed
 * filing I/O), so the via stamp, the server-recorded offer, the fingerprint and the accept loop are
 * the shipped code, not a copy.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_scope_auto_accept.js
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

let session = { id: 1, username: 'admin', role: 'admin' };
const audits = [];
const fakeAuth = {
  requireLogin() { return session; },
  requireRole(...roles) { if (!session || !roles.includes(session.role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); return session; },
  getCurrentUser() { return session; },
  logAudit(_db, entry) { audits.push(entry); },
};
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const licPath = require.resolve('../licensing/handler');
const licStub = new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) });
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: licStub };

const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const learning  = require('../../../database/modules/learning');
const { createReviewService } = require('../../services/reviewService');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, l] of [['supplier_name', 'Document Issuer'], ['invoice_number', 'Invoice Number'], ['invoice_date', 'Invoice Date']])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1, ?, ?, 'text', 1, 1)").run(k, l);
// The arc's preconditions (S1-C2): every one checked server-side at accept time.
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

// A REAL reviewService with stubbed filing I/O, published where the handler looks for it.
const svc = createReviewService({
  documents, learning,
  doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', slug: 'invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
  filing: { normaliseDate: require('../filing/handler').normaliseDate,
            commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml', srcPath: '/in/x.pdf' }) },
  fs: { existsSync: () => true, unlinkSync: () => {} }, path, logger: null,
  audit: (_db, e) => audits.push(e),
  onAfterConfirm: (d, info) => require('./handler').scheduleScopeAutoAccept(d, { supplier: info.supplier_name, typeSlug: info.typeSlug, via: info.via }),
  releaseDelayMs: 0,
});
const revPath = require.resolve('../review/handler');
require.cache[revPath] = { id: revPath, filename: revPath, loaded: true, exports: { getReviewService: () => svc } };

const H = {};
const ROOT = path.join(__dirname, '..', '..', '..');
const broadcasts = [];
const handler = require('./handler');
handler.register({
  ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} },
  getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p), pythonExe: () => 'py', pythonArgs: (...a) => a,
  tesseractPath: () => 'tesseract', backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
  configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'), templatesDir: () => os.tmpdir(),
  createWindow: () => null, getMainWindow: () => null,
  notifyMainWindow: (ch, payload) => broadcasts.push({ ch, payload }), notifyAllWindows: () => {}, safeSend: () => {},
  notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
  reviewTraceActive: false, devSliceDir: path.join(os.tmpdir(), 'ds-devslices-test'),
  windows: {}, app: null, fs, logger: { log: () => {}, warn: (m) => console.log('    [warn]', m), err: (m) => console.log('    [err]', m) },
  spawn: () => { throw new Error('spawn must not run in this test'); }, path,
});
const humanConfirm = (id, supplier) => svc.confirm(db, { username: 'sarah', role: 'admin' }, {
  document_id: id, folder_path: '/in', original_filename: 'x.pdf', corrections: {}, taught_fields: [],
  allValues: { supplier_name: supplier, invoice_number: 'INV-1', invoice_date: '01-06-2026' },
  supplier_name: supplier, document_type: 'Invoice', document_type_slug: 'invoice' });

(async () => {
  // ── §1 S1-C1 SCOPE-LOCAL: a confirm on Acme files Acme's ready siblings and ZERO Bolt docs ──
  console.log('§1 scope-local (S1-C1) — the positive control for every absence pin below');
  const a0 = mkDoc('Acme'), a1 = mkDoc('Acme'), a2 = mkDoc('Acme');
  const b1 = mkDoc('Bolt'), b2 = mkDoc('Bolt');
  const before = db.prepare("SELECT COUNT(*) c FROM corrections").get().c;
  const r = await humanConfirm(a0, 'Acme');
  check('the human confirm itself succeeded', r && r.ok);
  check('…and is stamped as a HUMAN confirm (via NULL)', status(a0).status === 'confirmed' && status(a0).confirmed_via == null);
  await sleep(2600);                                           // server debounce 1.5 s + the pass
  check('Acme sibling 1 filed BY THE SERVER with the machine via', status(a1).status === 'confirmed' && status(a1).confirmed_via === 'scope_sweep');
  check('Acme sibling 2 likewise', status(a2).status === 'confirmed' && status(a2).confirmed_via === 'scope_sweep');
  check('Bolt doc 1 UNTOUCHED (another sender never rides a Pelican confirm)', status(b1).status === 'needs_review');
  check('Bolt doc 2 UNTOUCHED', status(b2).status === 'needs_review');
  const offered = audits.filter(a => a.action === 'scope_sweep_offered' && a.metadata && a.metadata.scope_local);
  const accepted = audits.filter(a => a.action === 'scope_sweep_accepted' && a.metadata && a.metadata.auto_accept);
  const autoRow = audits.filter(a => a.action === 'scope_sweep_auto_accepted');
  check('the automatic path records its OWN offer first (C8/C9 hold: no accept without an offer)', offered.length === 1 && String(offered[0].metadata.doc_ids).split(',').map(Number).sort().join() === [a1, a2].sort().join());
  check('…then the accept, flagged auto_accept, then the summary row', accepted.length === 1 && autoRow.length === 1 && String(autoRow[0].metadata.filed_ids).split(',').map(Number).sort().join() === [a1, a2].sort().join());
  const recent = JSON.parse(learning.getSetting(db, 'recent_auto_filed', '{}') || '{}');
  check('S1-C4 receipt: both filed ids land in recent_auto_filed as AUTOMATIC (not approved)',
        Array.isArray(recent.ids) && recent.ids.includes(a1) && recent.ids.includes(a2) && !(recent.approved || []).includes(a1));
  check('…and Review is told (scope-auto-filed + review-count-changed broadcasts)',
        broadcasts.some(b => b.ch === 'scope-auto-filed' && b.payload && b.payload.supplier === 'Acme' && b.payload.filed.length === 2)
        && broadcasts.some(b => b.ch === 'review-count-changed'));
  check('no corrections row was written by the machine filings', db.prepare("SELECT COUNT(*) c FROM corrections").get().c === before);

  // ── §2 S1-C3 NO CHAIN: a machine-via confirm never triggers a pass ──────────────────────
  console.log('§2 no chain (S1-C3) — §1 is the positive control that a human confirm DOES trigger');
  const b3 = mkDoc('Bolt');
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, {
    document_id: b3, folder_path: '/in', original_filename: 'x.pdf', corrections: {}, taught_fields: [],
    allValues: { supplier_name: 'Bolt', invoice_number: 'INV-1', invoice_date: '01-06-2026' },
    supplier_name: 'Bolt', document_type: 'Invoice', document_type_slug: 'invoice', bulk: true }, { via: 'scope_sweep' });
  await sleep(2600);
  check('a scope_sweep-via confirm on Bolt leaves Bolt\'s other docs in the queue', status(b1).status === 'needs_review' && status(b2).status === 'needs_review');

  // ── §3 S1-C2 PRECONDITIONS checked server-side at accept time ──────────────────────────
  console.log('§3 preconditions (S1-C2) — each missing switch refuses, the bar path is untouched');
  for (const [key, label] of [['autofile_gate_unify', 'gate-unify OFF (a NULL-via import would count as human — the self-licensing hole)'],
                              ['learning_exclude_machine_confirms', 'machine confirms NOT excluded from learning'],
                              ['scope_sweep_enabled', 'the sweep itself dark'],
                              ['scope_sweep_auto_accept', 'the auto-accept switch dark']]) {
    learning.setSetting(db, key, 'false');
    const c0 = mkDoc('Cobalt'), c1 = mkDoc('Cobalt');
    await humanConfirm(c0, 'Cobalt');
    await sleep(2200);
    check(`${label}: sibling stays in the queue`, status(c1).status === 'needs_review');
    learning.setSetting(db, key, 'true');
  }
  check('the consent-bar IPC still exists and is the same accept loop (one writer)', typeof H['sweep-scope-accept'] === 'function' && typeof H['sweep-queue-candidates'] === 'function');

  // ── §4 S1-C5 a quiet re-read in flight for the scope blocks the accept ──────────────────
  console.log('§4 quiet-lane seam (S1-C5)');
  handler._quietLaneActiveScopes.add('acme|invoice');
  const a3 = mkDoc('Acme'), a4 = mkDoc('Acme');
  await humanConfirm(a3, 'Acme');
  await sleep(2200);
  check('while acme|invoice has a quiet read in flight, its sibling is NOT filed', status(a4).status === 'needs_review');
  handler._quietLaneActiveScopes.delete('acme|invoice');
  const r4 = await H['sweep-scope-accept']({}, { supplier: 'Acme', typeSlug: 'invoice', accepts: [{ docId: a4, fingerprint: 'x' }] });
  check('…and after the lane clears, the consent-bar accept refuses only on its own terms (never-offered → dropped)', r4 && r4.ok && r4.dropped.some(d => d.docId === a4));
  handler._quietLaneActiveScopes.add('acme|invoice');
  const r5 = await H['sweep-scope-accept']({}, { supplier: 'Acme', typeSlug: 'invoice', accepts: [{ docId: a4, fingerprint: 'x' }] });
  check('the consent-bar accept also refuses a scope with a quiet read in flight', r5 && r5.ok === false && r5.reason === 'quiet-lane-active');
  handler._quietLaneActiveScopes.delete('acme|invoice');

  // ── §5 PUT BACK: the receipt's undo is server-verified and writes no correction ─────────
  console.log('§5 put back (S1-C4)');
  const corrBefore = db.prepare("SELECT COUNT(*) c FROM corrections").get().c;
  const u = await H['sweep-scope-undo']({}, { docIds: [a1, a2, a0] });
  check('both machine-filed docs return to the queue', status(a1).status === 'needs_review' && status(a2).status === 'needs_review');
  check('the HUMAN confirm in the same list is REFUSED (never mass-reverted)', status(a0).status === 'confirmed' && u.refused.includes(a0));
  check('put-back writes NO corrections row (scopeTrust\'s correction count is unchanged)', db.prepare("SELECT COUNT(*) c FROM corrections").get().c === corrBefore);
  check('rows survive the put-back (a later re-confirm replaces in place)', db.prepare('SELECT COUNT(*) c FROM extractions WHERE document_id = ?').get(a1).c === 3);

  // ── §7 F2b (Oracle C2b.1–C2b.3, 2026-08-22): ONE consent door after a sender reprocess ───────
  console.log('§7 after a foreground reprocess the scope-local pass runs INSIDE the completion, the bar offers the remainder');
  const r1 = mkDoc('Rex'), r2 = mkDoc('Rex'), r3 = mkDoc('Rex');
  handler._setReprocessStatusForTest({ running: false, pendingCompletion: true, docIds: [r1, r2, r3], done: 3, failed: 0, total: 3 });
  const c1 = await H['consume-reprocess-completion']();
  check('the completion filed the batch\'s eligible docs by itself (receipt path, machine via)',
        c1 && c1.autoFiled === 3 && [r1, r2, r3].every(id => status(id).status === 'confirmed' && status(id).confirmed_via === 'scope_sweep'));
  check('…and the consent offer is EMPTY (no bar over docs already filed)', !c1.offerIds && handler._reprocessOfferForTest() == null);
  const acc = await H['reprocess-autocommit-accept']();
  check('…so a stale accept files nothing twice (no-offer)', acc && acc.ok === false && acc.reason === 'no-offer');
  learning.setSetting(db, 'scope_sweep_auto_accept', 'false');
  const x4 = mkDoc('Rex'), x5 = mkDoc('Rex');
  handler._setReprocessStatusForTest({ running: false, pendingCompletion: true, docIds: [x4, x5], done: 2, failed: 0, total: 2 });
  const c2 = await H['consume-reprocess-completion']();
  check('auto-accept OFF: nothing files, the consent bar gets its offer exactly as before (byte-identical door)',
        !c2.autoFiled && Array.isArray(c2.offerIds) && c2.offerIds.length === 2 && status(x4).status === 'needs_review');
  learning.setSetting(db, 'scope_sweep_auto_accept', 'true');

  // ── §6 static contract: the renderer-facing seams ────────────────────────────────────────
  console.log('§6 contract pins');
  const src  = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  const rend = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  const rsvc = fs.readFileSync(path.join(ROOT, 'src', 'services', 'reviewService.js'), 'utf8');
  check('the queue-wide offer yields while an automatic pass is filing (no bar over docs about to file)', /_autoAcceptInflightProbe\(\)\) return \{ ok: false, reason: 'auto-accept-running' \}/.test(src));
  check('the trigger is an explicit !_via in reviewService (not a renderer timer — covers File-All and /v1)', /if \(!_via\) \{\s*try \{[\s\S]{0,400}?onAfterConfirm\(db,/.test(rsvc));
  check('the scheduler refuses a via (machine) trigger before any DB read', /function scheduleScopeAutoAccept\(db, \{ supplier, typeSlug, via \} = \{\}\) \{\s*if \(via\) return false;/.test(src));
  check('one cap, one writer: the automatic path calls the SAME _sweepAcceptCore as the consent bar', (src.match(/_sweepAcceptCore\(db, \{/g) || []).length === 3);   // the definition + the two callers
  check('the receipt bar says what happened in the operator\'s words and offers Put back', /filed by itself after your confirms/.test(rend) && /acb-putback/.test(rend));
  check('Review refreshes the LIST on scope-auto-filed, never the open document', /onScopeAutoFiled\?\.\(async \(\) => \{[\s\S]{0,200}_refreshQueueFromBroadcast\(\)/.test(rend));
  // F2a (Oracle C2a.1/C2a.2): the quiet lane is scheduled on a graduation MINT only — after the
  // `!res.templateId` early return (a skip never reaches it) and after the enrichment block.
  const revh = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'review', 'handler.js'), 'utf8');
  const gStart = revh.indexOf('async function _maybeGraduationTemplate');
  const gBody = revh.slice(gStart, revh.indexOf('function _writeTemplateFile'));
  check('F2a: the graduation hook schedules the quiet re-read with reason graduated + the confirmed doc as seed',
        /scheduleQuietReread\(db, \{[\s\S]{0,200}reason: 'graduated', seedDocId: document_id \}\)/.test(gBody));
  check('F2a: …AFTER the `!res.templateId` return (skip never schedules) and AFTER enrichment',
        gBody.indexOf('if (!res || !res.templateId) return;') < gBody.indexOf('generateSampleAngle') && gBody.indexOf('generateSampleAngle') < gBody.indexOf('scheduleQuietReread'));

  console.log(fails ? `\n${fails} FAILED` : '\nall green');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
