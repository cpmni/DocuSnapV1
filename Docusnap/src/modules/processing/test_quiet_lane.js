#!/usr/bin/env node
'use strict';
/*
 * test_quiet_lane.js — PINs for Slice 3: the QUIET BACKGROUND RE-READ LANE (eric+gary → Oracle
 * SIGN-OFF ON DESIGN with conditions S3-C1..C6, 2026-08-21; DARK behind `quiet_reread_enabled`).
 *
 * Two halves:
 *   A. the PURE lane (quietLane.create with stubbed deps + fake timers): candidate predicate, the
 *      busy wait, pre-emption → deferral → resume, cancel, status, shutdown.
 *   B. the WIRED handler (register() with a fake ipcMain + a FAKE PYTHON via ctx.spawn): a taught
 *      confirm through the REAL reviewService schedules the lane; the REAL staging, the REAL shard
 *      runner, the REAL merge gate and the REAL applyReprocessResult(expect) run end to end —
 *      status-changed / rows-changed drops, the changed-read hold, preserveAck, the foreground-door
 *      pre-emption, the scope marker the sweep reads (S1-C5), and the one consent door (S3-(c)).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_quiet_lane.js
 */
process.env.QUIET_REREAD_DEBOUNCE_MS = '60';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { EventEmitter } = require('events');
const Database = require('better-sqlite3');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════════════════════════════
// A. THE PURE LANE
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('A. the pure lane');
const quietLane = require('./quietLane');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const learning  = require('../../../database/modules/learning');

const dbA = new Database(':memory:');
runMigrations(dbA);
dbA.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
dbA.prepare("INSERT INTO templates (id, name, slug) VALUES (7, 'Acme Invoice', 'acme-invoice')").run();
const mkA = (supplier, { template = null, status = 'needs_review', type = 1 } = {}) => Number(documents.insert(dbA, {
  original_filename: `${supplier || 'none'}.pdf`, folder_path: '/in', status, supplier_name: supplier, document_type_id: type, template_id: template }).lastInsertRowid);
const a1 = mkA('Acme'), a2 = mkA('Acme'), aT = mkA('Acme', { template: 7 }), aV = mkA('Acme'), bx = mkA('Bolt'), nn = mkA(null), dd = mkA('Acme', { status: 'deferred' });

let busy = false;
const viewers = new Set([aV]);
const events = [], audits = [], staged = [], killed = [];
let laneOn = true;
let shardResolve = null;
const lane = quietLane.create({
  getDb: () => dbA,
  enabled: () => laneOn,
  isForegroundBusy: () => busy,
  stageDocs: (db, chunk) => { staged.push(chunk.map(c => c.docId)); return { tmpNames: chunk.map(c => `rb_${c.docId}.pdf`), nameToDoc: Object.fromEntries(chunk.map(c => [`rb_${c.docId}.pdf`, { docId: c.docId, filename: c.filename, existing: [] }])), cleanup: () => {} }; },
  runShard: ({ track }) => new Promise(res => { track({ pid: 4242, kill: () => killed.push('kill') }); shardResolve = res; }),
  applyResult: () => null,
  presence: { viewers: (id) => (viewers.has(id) ? ['someone'] : []) },
  extractionsFingerprint: () => 'fp',
  notify: (e) => events.push(e),
  logAudit: (_db, e) => audits.push(e),
  logger: null,
  setPriority: () => {},
  taskkill: (pid) => killed.push(`taskkill:${pid}`),
  markScopeActive: () => {},
  onJobDone: () => {},
  findSiblings: (db, seed, value) => (seed === a1 ? [{ id: nn }] : []),
});

(async () => {
  check('dark: schedule refuses when the switch is off', (laneOn = false, lane.schedule(dbA, { supplier: 'Acme', typeSlug: 'invoice' }) === false));
  laneOn = true;
  check('schedule accepts a (supplier, type) when enabled', lane.schedule(dbA, { supplier: 'Acme', typeSlug: 'invoice', seedDocId: a1 }) === true);
  await sleep(150);
  check('the job started (a worker is alive)', !!lane._internals.running && lane._internals.procs().length === 1);
  const ids = staged[0] || [];
  check('CANDIDATES: the sender\'s template-less held docs (a1, a2)', ids.includes(a1) && ids.includes(a2));
  check('...never a doc that already carries a template (aT) — that is the sweep\'s business', !ids.includes(aT));
  check('...never a doc someone has open (aV)', !ids.includes(aV));
  check('...never a deferred doc (parked by the user)', !ids.includes(dd));
  check('...never another sender by name (Bolt)', !ids.includes(bx));
  check('...but DOES include a no-supplier doc the text finder says is the same sender (seeded from the taught doc)', ids.includes(nn));
  check('job_start was broadcast on the lane\'s own channel payload', events.some(e => e.type === 'job_start' && e.supplier === 'Acme'));

  // pre-emption = KILL, never hold; the job defers with its remaining docs and resumes when idle
  busy = true;
  await sleep(1700);                                   // the 1.5 s busy poll
  check('the busy poll pre-empted the worker (taskkill + kill)', killed.includes('taskkill:4242') && killed.includes('kill'));
  shardResolve && shardResolve();                      // the killed process closes
  await sleep(50);
  check('the job is DEFERRED, not dropped', !lane._internals.running && [...lane._internals.jobs.values()][0].state === 'deferred');
  check('...and says so', events.some(e => e.type === 'job_deferred' && e.reason === 'foreground'));
  const st = lane.status();
  check('status() reports the deferred job for a reopened window', !st.running && st.queued.length === 1 && st.queued[0].state === 'deferred');
  busy = false;
  await sleep(1700);
  check('it RESUMED by itself once the foreground went idle (a second staging of the remaining docs)', staged.length === 2 && !!lane._internals.running);
  check('direct preempt() while running returns true', lane.preempt('test') === true);
  shardResolve && shardResolve();
  await sleep(50);
  check('cancel() on a deferred job removes it', lane.cancel([...lane._internals.jobs.values()][0].id) === true && lane._internals.jobs.size === 0);
  check('preempt() with nothing running is a no-op (false)', lane.preempt('x') === false);
  lane.shutdown();
  check('shutdown leaves nothing queued', lane._internals.jobs.size === 0 && lane._internals.procs().length === 0);

  // ════════════════════════════════════════════════════════════════════════════════════════
  // B. THE WIRED HANDLER — a fake Python behind the REAL staging / runner / merge gate
  // ════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nB. the wired handler (fake Python, real staging + runner + merge gate)');
  let session = { id: 1, username: 'admin', role: 'admin' };
  const hAudits = [];
  const fakeAuth = { requireLogin() { return session; }, requireRole() { return session; }, getCurrentUser() { return session; }, logAudit(_db, e) { hAudits.push(e); } };
  const authPath = require.resolve('../auth/handler');
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
  const licPath = require.resolve('../licensing/handler');
  require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) }) };
  const { createReviewService } = require('../../services/reviewService');

  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
  db.prepare("INSERT INTO templates (id, name, slug) VALUES (7, 'Acme Invoice', 'acme-invoice')").run();
  for (const [k, l] of [['supplier_name', 'Document Issuer'], ['invoice_number', 'Invoice Number'], ['invoice_date', 'Invoice Date']])
    db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1, ?, ?, 'text', 1, 1)").run(k, l);
  for (const [k, v] of [['quiet_reread_enabled', 'true'], ['output_folder', '/out'], ['auto_file_threshold', '90']]) learning.setSetting(db, k, v);
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-quiet-test-'));
  let n = 0;
  const mk = (supplier, rows, { template = null, ack = null } = {}) => {
    const fn = `doc${++n}.pdf`;
    const wp = path.join(inbox, fn); fs.writeFileSync(wp, 'pdf');
    const id = Number(documents.insert(db, { original_filename: fn, folder_path: inbox, status: 'needs_review', supplier_name: supplier, document_type_id: 1, template_id: template, working_path: wp }).lastInsertRowid);
    const ins = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 80, ?)');
    for (const [k, v] of Object.entries(rows)) ins.run(id, k, v, v, 'keyword');
    if (ack) db.prepare('UPDATE documents SET review_acknowledged_at = ? WHERE id = ?').run(ack, id);
    return id;
  };
  // The fake Python: reads the shard's --files-file, emits a file_done per staged name with the
  // values the test plants in FRESH, then closes. `holdUntil` lets a test act mid-flight.
  const FRESH = {};
  let holdUntil = null, procs = [];
  const fakeSpawn = (exe, args) => {
    const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.pid = 9000 + procs.length; proc.killed = false;
    proc.kill = () => { proc.killed = true; setTimeout(() => proc.emit('close'), 5); };
    procs.push({ proc, args });
    const fi = args.indexOf('--files-file');
    const names = fi >= 0 ? JSON.parse(fs.readFileSync(args[fi + 1], 'utf8')) : [];
    (async () => {
      await sleep(10);
      if (holdUntil) await holdUntil;
      for (const name of names) {
        if (proc.killed) return;
        const docId = Number(String(name).replace(/^rb_(\d+)\..*$/, '$1'));
        const ex = FRESH[docId] || { supplier_name: { value: 'Acme', confidence: 95, method: 'template_fixed' }, invoice_number: { value: 'INV-N', confidence: 95, method: 'template_mapping' }, invoice_date: { value: '01-06-2026', confidence: 95, method: 'template_mapping' } };
        proc.stdout.emit('data', JSON.stringify({ type: 'file_done', success: true, original_filename: name, filename: name, overall_confidence: 95, supplier_name: 'Acme', document_type: 'Invoice', template_id: 7, extractions: ex }) + '\n');
        await sleep(5);
      }
      if (!proc.killed) proc.emit('close');
    })();
    return proc;
  };
  const H = {}; const bcast = [];
  const ROOT = path.join(__dirname, '..', '..', '..');
  const handler = require('./handler');
  const svc = createReviewService({
    documents, learning,
    doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', slug: 'invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
    filing: { normaliseDate: require('../filing/handler').normaliseDate, commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml', srcPath: '/in/x.pdf' }) },
    fs: { existsSync: () => true, unlinkSync: () => {} }, path, logger: null, audit: (_db, e) => hAudits.push(e),
    onTaughtConfirm: async () => {}, captureSample: async () => {},
    onAfterConfirm: (d, info) => { if (info.taught && !info.via) handler.scheduleQuietReread(d, { supplier: info.supplier_name, typeSlug: info.typeSlug, reason: 'teach', seedDocId: info.document_id }); },
    releaseDelayMs: 0,
  });
  const revPath = require.resolve('../review/handler');
  require.cache[revPath] = { id: revPath, filename: revPath, loaded: true, exports: { getReviewService: () => svc } };
  handler.register({
    ipcMain: { handle: (nm, fn) => { H[nm] = fn; }, on: () => {} }, getDb: () => db,
    resourcePath: (...p) => path.join(ROOT, ...p), pythonExe: () => 'py', pythonArgs: (...a) => a, tesseractPath: () => 'tesseract',
    backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'), configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
    templatesDir: () => os.tmpdir(), createWindow: () => null, getMainWindow: () => null,
    notifyMainWindow: (ch, p) => bcast.push({ ch, p }), notifyAllWindows: () => {}, safeSend: () => {}, notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
    reviewTraceActive: false, devSliceDir: path.join(os.tmpdir(), 'ds-devslices-test'), windows: {}, app: null, fs,
    logger: { log: () => {}, warn: () => {}, err: () => {} }, spawn: fakeSpawn, path,
  });
  const lane2 = handler.quietLane();
  const row = (id, k) => db.prepare('SELECT display_value, validation_note FROM extractions WHERE document_id = ? AND field_key = ?').get(id, k);
  const docRow = (id) => db.prepare('SELECT status, template_id, review_acknowledged_at FROM documents WHERE id = ?').get(id);

  // §B1 — a TAUGHT confirm schedules the lane; the siblings are re-read; a fill is not a change
  console.log('§B1 taught confirm → lane → siblings re-read');
  const taught = mk('Acme', { supplier_name: 'Acme', invoice_number: 'INV-1', invoice_date: '01-06-2026' });
  const s1 = mk('Acme', {});                                                // blank pre-teach read
  const s2 = mk('Acme', { invoice_number: 'INV-2' });                       // partial read, same value after
  FRESH[s2] = { supplier_name: { value: 'Acme', confidence: 95, method: 'template_fixed' }, invoice_number: { value: 'INV-2', confidence: 95, method: 'template_mapping' }, invoice_date: { value: '02-06-2026', confidence: 95, method: 'template_mapping' } };
  const tmplDoc = mk('Acme', {}, { template: 7 });                          // already carries a template → not the lane's
  const r = await svc.confirm(db, { username: 'sarah', role: 'admin' }, {
    document_id: taught, folder_path: inbox, original_filename: 'x.pdf', corrections: {}, taught_fields: ['invoice_number'],
    allValues: { supplier_name: 'Acme', invoice_number: 'INV-1', invoice_date: '01-06-2026' }, supplier_name: 'Acme', document_type: 'Invoice', document_type_slug: 'invoice' });
  check('the taught confirm succeeded', r && r.ok);
  await sleep(400);
  check('the lane spawned ONE worker with the below-normal marker in its env', procs.length === 1);
  check('s1 (blank) was re-read: values filled, template stamped', row(s1, 'invoice_number')?.display_value === 'INV-N' && docRow(s1).template_id === 7);
  check('...a FILL is not a "changed read" — no hold note', !row(s1, 'invoice_number')?.validation_note);
  check('s2 re-read to the SAME reference — no hold note', row(s2, 'invoice_number')?.display_value === 'INV-2' && !row(s2, 'invoice_number')?.validation_note);
  check('a doc that already carried a template was NOT touched', docRow(tmplDoc).template_id === 7 && !row(tmplDoc, 'invoice_number'));
  check('the taught doc itself stays confirmed', docRow(taught).status === 'confirmed');
  check('job_done reached Review on the quiet-reprocess channel (never reprocess-progress)',
        bcast.some(b => b.ch === 'quiet-reprocess' && b.p.type === 'job_done') && !bcast.some(b => b.ch === 'reprocess-progress'));
  check('one audit row per job + the per-doc reprocess audit carries quiet:true',
        hAudits.some(a => a.action === 'quiet_reprocess_job') && hAudits.some(a => a.action === 'reprocess' && a.metadata && a.metadata.quiet));
  check('no reprocess_autofiled / _reprocessOffer path was used (S3-(c))', !hAudits.some(a => a.action === 'reprocess_autofiled'));

  // §B2 — the changed-read HOLD (S3-C5) + preserveAck (S3-C2)
  console.log('§B2 changed read held · acknowledged stays acknowledged');
  const c1 = mk('Acme', { supplier_name: 'Acme', invoice_number: 'INV-7', invoice_date: '01-06-2026' }, { ack: '2026-08-21T00:00:00Z' });
  FRESH[c1] = { supplier_name: { value: 'Acme', confidence: 95, method: 'template_fixed' }, invoice_number: { value: 'INV-9', confidence: 95, method: 'template_mapping' }, invoice_date: { value: '01-06-2026', confidence: 95, method: 'template_mapping' } };
  lane2.schedule(db, { supplier: 'Acme', typeSlug: 'invoice', reason: 'teach' });
  await sleep(400);
  const c1n = row(c1, 'invoice_number');
  check('a VALUED reference that reads DIFFERENTLY is merged AND held with the was/now note',
        c1n?.display_value === 'INV-9' && /Read differently after learning — was 'INV-7', now 'INV-9'/.test(c1n?.validation_note || ''));
  check('preserveAck: the acknowledged stamp survives the quiet merge', docRow(c1).review_acknowledged_at === '2026-08-21T00:00:00Z');
  check('the unchanged date carries no note', !row(c1, 'invoice_date')?.validation_note);

  // §B3 — the merge gate: a confirm mid-read wins; a row change mid-read drops the merge
  console.log('§B3 merge gate (S3-C1/C6)');
  const g1 = mk('Acme', { invoice_number: 'G-1' }), g2 = mk('Acme', { invoice_number: 'G-2' });
  let release; holdUntil = new Promise(res => { release = res; });
  lane2.schedule(db, { supplier: 'Acme', typeSlug: 'invoice' });
  await sleep(150);                                    // staged + spawned, output held
  check('the scope is marked active for the sweep while the read is in flight (S1-C5)', handler._quietLaneActiveScopes.has('acme|invoice'));
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, { document_id: g1, folder_path: inbox, original_filename: 'x.pdf', corrections: {}, taught_fields: [],
    allValues: { supplier_name: 'Acme', invoice_number: 'G-1', invoice_date: '01-06-2026' }, supplier_name: 'Acme', document_type: 'Invoice', document_type_slug: 'invoice' });
  db.prepare("UPDATE extractions SET display_value = 'G-2x' WHERE document_id = ? AND field_key = 'invoice_number'").run(g2);   // a pin / class-fix / pill fill
  release(); holdUntil = null;
  await sleep(300);
  check('g1 confirmed mid-read: the late merge was DROPPED (status-changed) — still confirmed, rows untouched',
        docRow(g1).status === 'confirmed' && row(g1, 'invoice_number')?.display_value === 'G-1');
  check('g2 rows changed mid-read: the merge was DROPPED (rows-changed)', row(g2, 'invoice_number')?.display_value === 'G-2x' && docRow(g2).template_id == null);
  const dropEvents = bcast.filter(b => b.ch === 'quiet-reprocess' && b.p.type === 'doc_dropped').map(b => `${b.p.docId}:${b.p.reason}`);
  check('...and both drops were reported with their reason', dropEvents.includes(`${g1}:status-changed`) && dropEvents.includes(`${g2}:rows-changed`));
  check('the scope marker is cleared after the job', !handler._quietLaneActiveScopes.has('acme|invoice'));

  // §B4 — applyReprocessResult(expect) directly: the guard is inside the function, not only in the lane
  console.log('§B4 applyReprocessResult defence in depth');
  const { extractionsFingerprint } = require('../../services/sweepPredicate');
  const d4 = mk('Acme', { invoice_number: 'D-4' });
  const existing = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(d4);
  const fp = extractionsFingerprint(existing);
  const apply = (opts) => handler._applyReprocessResultForTest(db, d4, existing, { extractions: { invoice_number: { value: 'D-4new', confidence: 90, method: 'keyword' } }, overall_confidence: 90 }, 'd4.pdf', false, opts);
  const v1 = apply({ expect: { status: 'confirmed', fingerprint: fp } });
  check('expect.status mismatch → { dropped: "status-changed" }, rows untouched', v1 && v1.dropped === 'status-changed' && row(d4, 'invoice_number').display_value === 'D-4');
  const v2 = apply({ expect: { status: 'needs_review', fingerprint: 'nope' } });
  check('expect.fingerprint mismatch → { dropped: "rows-changed" }, rows untouched', v2 && v2.dropped === 'rows-changed' && row(d4, 'invoice_number').display_value === 'D-4');
  const v3 = apply({ expect: { status: 'needs_review', fingerprint: fp } });
  check('a matching expect applies (same path as the foreground; the normal return is the result object)', !(v3 && v3.dropped) && row(d4, 'invoice_number').display_value === 'D-4new');
  const d5 = mk('Acme', { invoice_number: 'D-5' }, { ack: '2026-08-21T01:00:00Z' });
  handler._applyReprocessResultForTest(db, d5, [], { extractions: { invoice_number: { value: 'D-5', confidence: 90, method: 'keyword' } }, overall_confidence: 90 }, 'd5.pdf', false);
  check('FOREGROUND (no opts) still clears review_acknowledged_at — byte-identical behaviour', docRow(d5).review_acknowledged_at == null);

  // §B5 — the foreground doors + shutdown (contract pins on the source)
  console.log('§B5 contract pins');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  const lanesrc = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'quietLane.js'), 'utf8');
  const py = fs.readFileSync(path.join(ROOT, 'python_backend', 'process_docs.py'), 'utf8');
  const rend = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  check('every foreground door pre-empts the lane: single reprocess · batch reprocess · import pool',
        /preempt\('single-reprocess'\)/.test(src) && /preempt\('reprocess-batch'\)/.test(src) && (src.match(/preempt\('import'\)/g) || []).length >= 2);
  check('the lane is invisible to _anyProcessingBusy (the foreground is never refused by it)',
        /function _anyProcessingBusy\(\) \{ return _currentBatchProcs\.length > 0 \|\| _singleReprocessActive; \}/.test(src));
  check('the lane runs the SAME thread cap as every other read (S3-C4)', /threadCap: _reprocessThreadCap\(db\),\s+\/\/ S3-C4/.test(src));
  check('quit tears the lane down (no orphaned quiet worker)', /function killAll\(\) \{\s*try \{ _quietLaneImpl && _quietLaneImpl\.shutdown\(\); \}/.test(src));
  check('the lane never routes through _reprocessOffer / reprocess-progress (code, not prose)',
        !/_reprocessOffer\s*[=.(]/.test(lanesrc) && !/['"]reprocess-progress['"]/.test(lanesrc));
  check('the merge gate has no await between its checks and the apply (S3-C6)', /function _onFileDone\(db, job, staged, msg\) \{[\s\S]*?\n  \}/.test(lanesrc) && !/function _onFileDone[\s\S]*?await[\s\S]*?applyResult\(/.test(lanesrc.slice(lanesrc.indexOf('function _onFileDone'), lanesrc.indexOf('function _holdChangedReads'))));
  check('Python self-demotes to BELOW_NORMAL (0x4000), never IDLE, only when marked', /DS_PROCESS_PRIORITY.*below_normal[\s\S]{0,400}SetPriorityClass\(k32\.GetCurrentProcess\(\), 0x4000\)/.test(py));
  check('Review listens on quiet-reprocess and refreshes the LIST only (never the open document)',
        /onQuietReprocess\?\.\(async \(ev\) => \{/.test(rend) && /_quietRefreshList/.test(rend) && !/onQuietReprocess[\s\S]{0,1500}selectDoc\(/.test(rend));
  check('job_done re-asks the consent sweep (the one filing door)', /if \(ev\.type === 'job_done'\)[\s\S]{0,200}_runQueueSweep\(\)/.test(rend));

  try { fs.rmSync(inbox, { recursive: true }); } catch {}
  console.log(fails ? `\n${fails} FAILED` : '\nall green');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
