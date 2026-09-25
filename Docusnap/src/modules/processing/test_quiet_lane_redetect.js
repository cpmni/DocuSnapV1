#!/usr/bin/env node
'use strict';
/*
 * test_quiet_lane_redetect.js — PINs for the QUIET REDETECT job kind (2026-09-24; owner: "categorise everything
 * quickly, then confirms allow auto-file"; gary + eric design → Oracle SIGN-OFF-W/COND C1-C7, docs/oracle_log.md).
 *
 * Hermetic (model: test_quiet_lane.js §A): an in-memory migrated DB, every side effect injected. Pins:
 *   1. OFF (redetectEnabled false) → schedule({redetect:true}) is false, no job, no spawn; the scoped arms are unchanged.
 *   2. population: NULL-typed ✓ · Generic-typed ✓ · real-typed ✗ · templated ✗ · deferred ✗ · workflow-locked ✗ ·
 *      lane-noted ✗ · no page text ✗ · a doc being viewed ✗ · OCR cache unusable → SKIPPED and counted, never staged.
 *   3. every chunk runs with reextract:true; stageDocs sees quick:true + auditMeta.redetect.
 *   4. NO sweep scope is marked and NO onJobDone fan-out (Oracle decision 1).
 *   5. two schedules coalesce into one job; a schedule while running sets a rerun (one follow-on pass).
 *   6. a scoped job ticks BEFORE a waiting redetect.
 *   7. Oracle C1: under the switch a SCOPED job admits a Generic-typed doc of its sender; OFF it does not.
 *   8. A2: an override job is keyed by its type and re-reads the typed template-less held docs; Oracle C5: an override
 *      on an identity key holds that key's first-fill with the "— confirm once." family note.
 *   9. cap: at most REDETECT_CAP (400) docs per job; the remainder is counted (`capped`).
 *  10. ordering: docs whose detected_type_name names one of the job's types come first.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/processing/test_quiet_lane_redetect.js
 */
process.env.QUIET_REREAD_DEBOUNCE_MS = '40';
const path = require('path');
const Database = require('better-sqlite3');
const quietLane = require('./quietLane');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; return cond; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const db = new Database(':memory:');
quiet(() => runMigrations(db));
// types: 1 Invoice (real), 4 Quote (real, the "newly added" one), 9 General Document (the Generic placeholder)
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (4, 'Quote', 'quote', 0, 'quote_number', 'quote_date')").run();
db.prepare("INSERT OR IGNORE INTO document_types (id, name, slug, built_in) VALUES (9, 'General Document', 'general_document', 1)").run();
for (const [t, k, ty, r] of [[1, 'supplier_name', 'text', 1], [1, 'invoice_number', 'text', 1], [1, 'invoice_date', 'date', 1],
                             [4, 'supplier_name', 'text', 1], [4, 'quote_number', 'text', 1], [4, 'quote_date', 'date', 1]])
  db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, enabled) VALUES (?, ?, ?, ?, ?, 1)').run(t, k, k, ty, r);
db.prepare("INSERT INTO templates (id, name, slug) VALUES (7, 'Acme Invoice', 'acme-invoice')").run();
const GENERIC_ID = 9;

let nextName = 0;
const mk = ({ supplier = null, type = null, template = null, status = 'needs_review', text = 'QUOTATION Ref NRQ-1 Total 10.00', wf = null, detected = null } = {}) => {
  const id = Number(documents.insert(db, { original_filename: `d${++nextName}.pdf`, folder_path: '/in', status, supplier_name: supplier, document_type_id: type, template_id: template }).lastInsertRowid);
  db.prepare('UPDATE documents SET ocr_text = ?, workflow_status = ?, detected_type_name = ? WHERE id = ?').run(text, wf, detected, id);
  return id;
};
const note = (id, key, txt) => db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note) VALUES (?, ?, 'x', 'x', 50, 'keyword', ?)").run(id, key, txt);

// ── the harness ──────────────────────────────────────────────────────────────────────────────────────────
let redetectOn = true, laneOn = true, busy = false;
const usable = new Map();            // docId -> { usable, reason } (default usable)
const quickOpts = [];                // every quickUsable call's opts (the born-digital relaxation is asked for by the lane)
const viewers = new Set();
const events = [], audits = [], stagedCalls = [], shardCalls = [], scopeMarks = [], jobDone = [], receipts = [];
let applyHook = null;
const lane = quietLane.create({
  getDb: () => db,
  enabled: () => laneOn,
  isForegroundBusy: () => busy,
  redetectEnabled: () => redetectOn,
  quickUsable: (_db, id, opts) => { quickOpts.push(opts || null); return usable.get(id) || { usable: true, reason: 'ok' }; },
  genericTypeId: () => GENERIC_ID,
  isIdentityKey: (k) => k === 'supplier_name' || k === 'customer_name',
  stageDocs: (_db, chunk, opts) => {
    stagedCalls.push({ ids: chunk.map(c => c.docId), opts });
    return { tmpNames: chunk.map(c => `rb_${c.docId}.pdf`),
             nameToDoc: Object.fromEntries(chunk.map(c => [`rb_${c.docId}.pdf`, { docId: c.docId, filename: c.filename, existing: db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(c.docId), via: c.via }])),
             cleanup: () => {} };
  },
  runShard: ({ staged, reextract, onFileDone }) => {
    shardCalls.push({ n: staged.tmpNames.length, reextract: !!reextract });
    for (const tn of staged.tmpNames) onFileDone({ original_filename: tn, success: true, extractions: {} });
    return Promise.resolve();
  },
  applyResult: (_db, docId) => { if (applyHook) applyHook(docId); return null; },
  presence: { viewers: (id) => (viewers.has(id) ? ['someone'] : []) },
  extractionsFingerprint: () => 'fp',
  notify: (e) => events.push(e),
  logAudit: (_db, e) => audits.push(e),
  logger: null,
  setPriority: () => {},
  taskkill: () => {},
  markScopeActive: (key, on) => scopeMarks.push({ key, on }),
  onJobDone: (_db, info) => jobDone.push(info),
  recordEvent: (_db, ev) => receipts.push(ev),   // the activity-strip receipt (2026-09-25)
});
const stagedIds = () => stagedCalls.flatMap(s => s.ids);
const reset = () => { events.length = 0; audits.length = 0; stagedCalls.length = 0; shardCalls.length = 0; scopeMarks.length = 0; jobDone.length = 0; receipts.length = 0; };
const lastAudit = () => audits.filter(a => a.action === 'quiet_reprocess_job').slice(-1)[0];
const waitDone = async (ms = 1500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (events.some(e => e.type === 'job_done')) return true; await sleep(10); } return false; };

(async () => {
  console.log('1. OFF: the redetect kind is inert');
  {
    redetectOn = false;
    const d = mk({ type: null });
    check('schedule({redetect:true}) → false while the switch is OFF', lane.schedule(db, { redetect: true, typeSlug: 'quote' }) === false);
    await sleep(120);
    check('no job, no spawn, no event', stagedCalls.length === 0 && events.length === 0 && lane.status().running == null && lane.status().queued.length === 0);
    db.prepare('DELETE FROM documents WHERE id = ?').run(d);
    redetectOn = true;
  }

  console.log('\n2. population of the untyped job (`*|redetect`)');
  {
    reset();
    const dNull = mk({ type: null });
    const dGen  = mk({ type: GENERIC_ID });
    const dReal = mk({ type: 1 });                                   // a real type: never re-typed by the redetect
    const dTpl  = mk({ type: null, template: 7 });                   // carries a template: the sweep's business
    const dDef  = mk({ type: null, status: 'deferred' });            // parked by the user
    const dLock = mk({ type: null, wf: 'pending' });                 // in a workflow
    const dNoted = mk({ type: null }); note(dNoted, 'quote_number', 'Read from your new box — confirm once.');
    const dNoText = mk({ type: null, text: '' });
    const dView = mk({ type: null }); viewers.add(dView);
    const dNoCache = mk({ type: GENERIC_ID }); usable.set(dNoCache, { usable: false, reason: 'no-recipe-stamp' });
    check('schedule → true', lane.schedule(db, { redetect: true, typeSlug: 'quote', reason: 'type-added' }) === true);
    check('job is queued under the fixed key with kind redetect + quick', lane.status().queued.some(j => j.kind === 'redetect' && j.quick === true && j.typeSlugs.includes('quote')));
    check('the run finished', await waitDone());
    const ids = stagedIds();
    check('NULL-typed and Generic-typed held docs are re-read', ids.includes(dNull) && ids.includes(dGen), JSON.stringify(ids));
    check('a REAL-typed doc is NOT in the untyped population (pinned: never "re-type everything")', !ids.includes(dReal));
    check('templated / deferred / workflow-locked / no-text / viewed docs are excluded',
          ![dTpl, dDef, dLock, dNoText, dView].some(x => ids.includes(x)), JSON.stringify(ids));
    // Chris 2026-09-24 card 3: an UNTYPED doc carrying a "— confirm once." note (the engine's straighten note from
    // import) was never asked anything by the lane — it IS re-typed by the untyped job (7 of 98 were left behind).
    check('PIN: an untyped doc with a confirm-once note IS re-read by the untyped job', ids.includes(dNoted), JSON.stringify(ids));
    check('the job_done event names the doc that was left alone because it was open (card 1)',
          events.some(e => e.type === 'job_done' && Array.isArray(e.viewing) && e.viewing.includes(dView)), JSON.stringify(events.filter(e => e.type === 'job_done')));
    check('an OCR-cache-unusable doc is SKIPPED and counted, never staged (pinned: no background Full)',
          !ids.includes(dNoCache) && /no-cache:no-recipe-stamp/.test(String((lastAudit() || {}).metadata.skipped || '')), JSON.stringify((lastAudit() || {}).metadata));
    console.log('\n3. the imageless road + the staging flags');
    check('every shard ran with reextract:true', shardCalls.length > 0 && shardCalls.every(s => s.reextract === true));
    check('the population asked quickUsable with allowBornDigital:true for every doc (the text-layer relaxation is the lane\'s ask)',
          quickOpts.length > 0 && quickOpts.every(o => o && o.allowBornDigital === true), JSON.stringify(quickOpts.slice(0, 3)));
    check('stageDocs saw quick:true and auditMeta.redetect', stagedCalls.every(s => s.opts && s.opts.quick === true && s.opts.auditMeta && s.opts.auditMeta.redetect === true && s.opts.auditMeta.quiet === true));
    console.log('\n4. no sweep scope, no fan-out (Oracle decision 1)');
    check('markScopeActive never called for the redetect job', scopeMarks.length === 0, JSON.stringify(scopeMarks));
    check('onJobDone NOT called for the redetect job', jobDone.length === 0);
    // 2026-09-25 (Chris card 1, durable receipt): the redetect records ONE 'recognised' activity-strip event — the docs it
    // typed, the type slug(s) it ran for, never undoable. Nothing else in the lane touches the ledger.
    check('recordEvent called exactly once with kind recognised, the done ids and the type slugs (no undo)',
          receipts.length === 1 && receipts[0].kind === 'recognised' && receipts[0].undo === null
          && Array.isArray(receipts[0].typeSlugs) && receipts[0].typeSlugs.includes('quote')
          && receipts[0].ids.length === ids.length && ids.every(i => receipts[0].ids.includes(i)),
          JSON.stringify(receipts));
    check('audit row names the kind, the type slugs and quick', (lastAudit() || {}).metadata.kind === 'redetect' && /quote/.test((lastAudit() || {}).metadata.type_slugs) && (lastAudit() || {}).metadata.quick === 1);
    check('job_start / job_done events carry kind redetect', events.some(e => e.type === 'job_start' && e.kind === 'redetect' && e.quick === true) && events.some(e => e.type === 'job_done' && e.kind === 'redetect'));
    viewers.clear();
    for (const x of [dNull, dGen, dReal, dTpl, dDef, dLock, dNoted, dNoText, dView, dNoCache]) db.prepare('DELETE FROM documents WHERE id = ?').run(x);
  }

  console.log('\n5. coalescing + rerun');
  {
    reset();
    const a = mk({ type: null }), b = mk({ type: null });
    lane.schedule(db, { redetect: true, typeSlug: 'quote' });
    lane.schedule(db, { redetect: true, typeSlug: 'invoice' });
    check('two schedules → ONE queued job carrying both type slugs', lane.status().queued.length === 1 && lane.status().queued[0].typeSlugs.length === 2);
    // schedule again while it runs → one follow-on pass
    let sawRunning = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) { if (lane.status().running && lane.status().running.kind === 'redetect') { sawRunning = true; lane.schedule(db, { redetect: true, typeSlug: 'quote' }); break; } await sleep(2); }
    await sleep(400);
    const starts = events.filter(e => e.type === 'job_start' && e.kind === 'redetect').length;
    check('a schedule during the run yields exactly one follow-on pass (2 job_starts)', sawRunning ? starts === 2 : starts >= 1, `sawRunning=${sawRunning} starts=${starts}`);
    for (const x of [a, b]) db.prepare('DELETE FROM documents WHERE id = ?').run(x);
  }

  console.log('\n6. a scoped job ticks before a waiting redetect');
  {
    reset();
    busy = true;                                                     // hold both in the queue, then release together
    const s = mk({ supplier: 'Acme', type: 1 });
    const u = mk({ type: null });
    lane.schedule(db, { redetect: true, typeSlug: 'quote' });
    lane.schedule(db, { supplier: 'Acme', typeSlug: 'invoice', reason: 'teach' });
    await sleep(120);
    busy = false;
    await sleep(2200);
    const starts = events.filter(e => e.type === 'job_start');
    check('the scoped (teach) job started first, the redetect after it', starts.length >= 2 && starts[0].kind === 'scoped' && starts[1].kind === 'redetect', JSON.stringify(starts.map(e => e.kind)));
    for (const x of [s, u]) db.prepare('DELETE FROM documents WHERE id = ?').run(x);
  }

  console.log('\n7. Oracle C1: the SCOPED arms admit a Generic-typed doc of the sender under the switch');
  {
    reset();
    const g = mk({ supplier: 'Acme', type: GENERIC_ID });
    lane.schedule(db, { supplier: 'Acme', typeSlug: 'invoice', reason: 'teach' });
    check('ON: the Generic-typed Acme doc is re-read by the teach job', (await waitDone()) && stagedIds().includes(g), JSON.stringify(stagedIds()));
    reset(); redetectOn = false;
    lane.schedule(db, { supplier: 'Acme', typeSlug: 'invoice', reason: 'teach' });
    await sleep(300);
    check('OFF: the Generic-typed doc is NOT selected (byte-identical to before)', !stagedIds().includes(g), JSON.stringify(stagedIds()));
    redetectOn = true;
    db.prepare('DELETE FROM documents WHERE id = ?').run(g);
  }

  console.log('\n8. A2: an override job is keyed by its type; C5: an identity-key override holds that key\'s first-fill');
  {
    reset();
    const q1 = mk({ type: 4 });                                      // a typed, template-less held quote
    const inv = mk({ type: 1 });                                     // another type: not in the quote override's population
    const n0 = mk({ type: null });                                   // untyped: not in a TYPED override job
    const qNoted = mk({ type: 4 }); note(qNoted, 'quote_number', 'Read differently after learning — was X, now Y');   // already asked by the lane: the override job leaves it to the human
    applyHook = (docId) => { db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, 'supplier_name', 'Nordwind', 'Nordwind', 90, 'keyword_override')").run(docId); };
    check('schedule({redetect, typeSlug quote, overrideKey supplier_name}) → true', lane.schedule(db, { redetect: true, typeSlug: 'quote', overrideKey: 'supplier_name', reason: 'override' }) === true);
    check('the job key is <slug>|redetect', lane.status().queued.some(j => j.kind === 'redetect' && j.typeSlug === 'quote'));
    check('the run finished', await waitDone());
    const ids = stagedIds();
    check('the typed template-less quote is re-read; other types and untyped docs are not', ids.includes(q1) && !ids.includes(inv) && !ids.includes(n0), JSON.stringify(ids));
    check('a typed doc the lane already asked about (lane note) is NOT re-read by the override job (the A1 seam stays for typed docs)', !ids.includes(qNoted), JSON.stringify(ids));
    const rowNote = String((db.prepare("SELECT validation_note FROM extractions WHERE document_id = ? AND field_key = 'supplier_name'").get(q1) || {}).validation_note || '');
    check('C5: the identity first-fill carries the "— confirm once." family note', /Read from the label you added — confirm once\./.test(rowNote), rowNote);
    check('an override needs a type (no slug → refused)', lane.schedule(db, { redetect: true, overrideKey: 'supplier_name' }) === false);
    applyHook = null;
    for (const x of [q1, inv, n0, qNoted]) db.prepare('DELETE FROM documents WHERE id = ?').run(x);
  }

  console.log('\n9. the cap + 10. ordering by detected_type_name');
  {
    reset();
    const ids = [];
    for (let i = 0; i < 405; i++) ids.push(mk({ type: null, detected: i === 404 ? 'Quote' : null }));   // the LAST inserted doc names the new type
    lane.schedule(db, { redetect: true, typeSlug: 'quote' });
    check('the run finished', await waitDone(6000));
    const staged = stagedIds();
    check('at most 400 docs staged; 5 counted as capped', staged.length === 400 && (lastAudit() || {}).metadata.capped === 5, `staged=${staged.length} capped=${(lastAudit() || {}).metadata.capped}`);
    check('the doc whose detected_type_name names the new type is staged FIRST', staged[0] === ids[404], `first=${staged[0]} want=${ids[404]}`);
    check('the newest docs come before the oldest (the 5 oldest are the capped ones)', !staged.includes(ids[0]) && staged.includes(ids[400]));
    for (const x of ids) db.prepare('DELETE FROM documents WHERE id = ?').run(x);
  }

  lane.shutdown();
  console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
