#!/usr/bin/env node
'use strict';
/**
 * src/modules/processing/test_quiet_lane_ready_templated.js
 * ----------------------------------------------------------
 * Owner card 1 (Chris 15, built 2026-08-23) — THE READY ARM of the quiet lane. Once the seed-support
 * prune (Q2) makes the teach-time re-read work, the siblings BIND to the scope's template BEFORE any
 * confirm at overall 91–93 under the UNGRADUATED floor 100; the 'ready' crossing re-read only
 * TEMPLATE-LESS docs (the S3 boundary), so "✓ files by itself" stood over a pile that waited for File
 * All. The arm re-reads, at the READY crossing only, the scope's template-carrying held docs whose
 * stored overall confidence sits BELOW the scope's live floor. DARK behind
 * quiet_reread_on_ready_templated / QUIET_REREAD_ON_READY_TEMPLATED.
 *
 *   §1 only a 'ready' job consults the arm (teach / layout jobs: audit ready_arm empty)
 *   §2 population = the layout arm's rule (owned template · scope name · no S3-C5 note · held) AND
 *      overall_confidence < floor; a doc AT the floor is not re-read (it files through the sweep);
 *      positive control: lower its confidence → selected
 *   §3 preconditions: switch OFF · on-page OFF · unjudgeable name · no floor — each skips + audits
 *   §4 C3.3: a REQUIRED role field first-filled under via 'ready' is held "Read after learning —
 *      confirm once." unless corroborated (positive control stands)
 *   §5 source contract: the handler wires readyArm.{enabled,floor} off trust.scopeTrust; the switch
 *      reader honours env 1/0 and defaults OFF; Settings surfaces the toggle
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_quiet_lane_ready_templated.js
 */
process.env.QUIET_REREAD_DEBOUNCE_MS = '60';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const quietLane = require('./quietLane');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const handler = require('./handler');

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req] of [['supplier_name', 1], ['invoice_number', 1], ['invoice_date', 1], ['total_amount', 0]])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, 'text', ?, 1, 1)").run(k, k, req);
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (7, 'Acme Widgets Invoice', 'acme-widgets-invoice', 'invoice')").run();
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (7, 'supplier_name', 'Acme Widgets')").run();
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (8, 'Bolt Invoice', 'bolt-invoice', 'invoice')").run();
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (8, 'supplier_name', 'Bolt Fasteners')").run();
const SUP = 'Acme Widgets';
const mk = (supplier, { template = null, status = 'needs_review', note = null, rows = [], oc = 92 } = {}) => {
  const id = Number(documents.insert(db, { original_filename: `${supplier || 'none'}-${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status, supplier_name: supplier, document_type_id: 1, template_id: template, overall_confidence: oc }).lastInsertRowid);
  db.prepare('UPDATE documents SET overall_confidence = ? WHERE id = ?').run(oc, id);
  for (const r of rows) db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, corroboration) VALUES (?, ?, ?, ?, 90, ?, ?, ?)').run(id, r.key, r.value, r.value, r.method || 'keyword', r.note || null, r.corrob || null);
  if (note) db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note) VALUES (?, 'invoice_number', 'X', 'X', 90, 'keyword', ?)").run(id, note);
  return id;
};
const R1 = mk(SUP, { template: 7, oc: 92 });                    // the owner's case: bound, below the floor
const R2 = mk(SUP, { template: 7, oc: 100 });                   // AT the floor — files through the sweep, not re-read
const R3 = mk(SUP, { template: 7, oc: 92, note: "Read differently after learning — was 'A', now 'B'. Please check which is right." });   // seam 2
const R4 = mk('Bolt Fasteners', { template: 7, oc: 80 });       // another sender's claim
const R5 = mk(SUP, { template: 8, oc: 80 });                    // the scope's name on ANOTHER scope's template
const R6 = mk(SUP, { oc: 80 });                                 // template-less → arm (a) regardless
const R7 = mk(SUP, { template: 7, oc: 80, status: 'confirmed' });

let laneOn = true, readyOn = true, onPage = true, corrobOk = false, floor = 100;
const events = [], audits = [], staged = [];
let shardResolve = null, fakeResult = null;
const lane = quietLane.create({
  getDb: () => db,
  enabled: () => laneOn,
  isForegroundBusy: () => false,
  stageDocs: (d, chunk) => { staged.push(chunk.map(c => c.docId)); return { tmpNames: chunk.map(c => `rb_${c.docId}.pdf`), nameToDoc: Object.fromEntries(chunk.map(c => [`rb_${c.docId}.pdf`, { docId: c.docId, filename: c.filename, via: c.via || null, existing: d.prepare('SELECT * FROM extractions WHERE document_id = ?').all(c.docId) }])), cleanup: () => {} }; },
  runShard: ({ staged: st, onFileDone }) => new Promise(res => { shardResolve = res; if (fakeResult) for (const name of st.tmpNames) onFileDone({ ...fakeResult, original_filename: name, success: true }); }),
  applyResult: (d, docId, existing, msg) => {
    d.prepare('DELETE FROM extractions WHERE document_id = ?').run(docId);
    for (const [k, v] of Object.entries(msg.extractions || {})) d.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, corroboration) VALUES (?, ?, ?, ?, 90, ?, ?)').run(docId, k, v.value, v.value, v.method || 'template_mapping', v.corroboration || null);
    return { ok: true };
  },
  presence: { viewers: () => [] },
  extractionsFingerprint: () => 'fp',
  notify: (e) => events.push(e),
  logAudit: (_d, e) => audits.push(e),
  logger: null, setPriority: () => {}, taskkill: () => {}, markScopeActive: () => {}, onJobDone: () => {},
  findSiblings: () => [],
  kwSelect: () => null, kwSelectEnabled: () => false,
  scopeTemplateIds: (d, sup, slug) => require(path.join(ROOT, 'database', 'modules', 'scopeReadiness')).templateIds(d, sup, slug),
  layoutArm: { enabled: () => false, onPage: () => onPage, nameTokens: (n) => handler.nameArmTokens(n) },
  readyArm: { enabled: () => readyOn, floor: () => floor },
  corroborated: () => corrobOk,
});
const lastJobAudit = () => audits.filter(a => a.action === 'quiet_reprocess_job').slice(-1)[0];
const finishRun = async () => { shardResolve && shardResolve(); await sleep(80); };
const run = async (reason) => { staged.length = 0; lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason }); await sleep(150); const sel = (staged[0] || []).slice(); await finishRun(); return sel; };

(async () => {
  console.log('§1 only a ready job consults the arm');
  let sel = await run('teach');
  check('a teach job: the bound below-floor sibling is NOT selected; the template-less doc is (arm a)', !sel.includes(R1) && sel.includes(R6));
  check('…audit ready_arm empty', lastJobAudit().metadata.ready_arm === '');
  sel = await run('layout');
  check('a layout job with the layout arm OFF: not selected either', !sel.includes(R1) && lastJobAudit().metadata.ready_arm === '');

  console.log('§2 the ready arm — population + the floor');
  sel = await run('ready');
  check("the owner's case: bound at 92 under floor 100 → SELECTED", sel.includes(R1));
  check('a doc AT the floor (100) is NOT re-read — it files through the sweep', !sel.includes(R2));
  check('a doc already holding an S3-C5 note is NOT (seam 2)', !sel.includes(R3));
  check("another sender's claim on the scope's template is NOT", !sel.includes(R4));
  check("the scope's name on ANOTHER scope's template is NOT", !sel.includes(R5));
  check('filed docs never; template-less still via arm (a)', !sel.includes(R7) && sel.includes(R6));
  check('audit: reasons=ready, ready_arm=selected:1:floor=100', lastJobAudit().metadata.reasons === 'ready' && lastJobAudit().metadata.ready_arm === 'selected:1:floor=100');
  db.prepare('UPDATE documents SET overall_confidence = 95 WHERE id = ?').run(R2);
  sel = await run('ready');
  check('positive control: the same doc at 95 (< 100) IS selected', sel.includes(R2));
  db.prepare('UPDATE documents SET overall_confidence = 100 WHERE id = ?').run(R2);
  floor = 95;
  sel = await run('ready');
  check('a GRADUATED scope (floor 95): the 92 doc is still below → selected; the 100 doc is not', sel.includes(R1) && !sel.includes(R2) && /floor=95$/.test(lastJobAudit().metadata.ready_arm));
  floor = 100;

  console.log('§3 preconditions — each skip is audited and selects nothing extra');
  for (const [label, setup, expect] of [
    ['switch OFF', () => { readyOn = false; }, 'skipped:off'],
    ['template_identity_on_page OFF', () => { readyOn = true; onPage = false; }, 'skipped:on_page_off'],
    ['no floor (scopeTrust unavailable)', () => { onPage = true; floor = null; }, 'skipped:no_floor'],
  ]) {
    setup();
    sel = await run('ready');
    check(`${label}: bound docs NOT selected, template-less still is`, !sel.includes(R1) && sel.includes(R6));
    check(`…audit ready_arm=${expect}`, lastJobAudit().metadata.ready_arm === expect);
  }
  floor = 100;
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (9, 'DOCUMENT SOLUTIONS', 'document-solutions', 'invoice')").run();
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (9, 'supplier_name', 'DOCUMENT SOLUTIONS')").run();
  const D1 = mk('DOCUMENT SOLUTIONS', { template: 9, oc: 92 });
  staged.length = 0;
  lane.schedule(db, { supplier: 'DOCUMENT SOLUTIONS', typeSlug: 'invoice', reason: 'ready' });
  await sleep(150);
  check('an all-generic scope name ("DOCUMENT SOLUTIONS") skips the arm — the owner is told, not silently re-imposed', !(staged[0] || []).includes(D1));
  await finishRun();
  check('…audit ready_arm=skipped:unjudgeable_identity', lastJobAudit().metadata.ready_arm === 'skipped:unjudgeable_identity');

  console.log('§4 C3.3 under via ready — the first-fill hold, its own note');
  const F1 = mk(SUP, { template: 7, oc: 92, rows: [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_date', value: '01-08-2026' }] });   // ref EMPTY
  fakeResult = { extractions: { supplier_name: { value: SUP, method: 'template_fixed' }, invoice_number: { value: 'PO-7781', method: 'template_mapping' }, invoice_date: { value: '01-08-2026', method: 'template_mapping' } } };
  corrobOk = false;
  await run('ready');
  const f1ref = db.prepare("SELECT display_value, validation_note FROM extractions WHERE document_id = ? AND field_key = 'invoice_number'").get(F1);
  check('F1: a first-filled REQUIRED ref under via ready → held "Read after learning — confirm once."', f1ref && f1ref.display_value === 'PO-7781' && /Read after learning — confirm once\./.test(f1ref.validation_note || ''));
  check('…and NOT the layout arm\'s "new box" wording', !/new box/.test(f1ref.validation_note || ''));
  check('audit carries first_fill_ids', String(lastJobAudit().metadata.first_fill_ids).split(',').map(Number).includes(F1));
  const F2 = mk(SUP, { template: 7, oc: 92, rows: [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_date', value: '01-08-2026' }] });
  corrobOk = true;
  await run('ready');
  const f2ref = db.prepare("SELECT display_value, validation_note FROM extractions WHERE document_id = ? AND field_key = 'invoice_number'").get(F2);
  check('F2 (positive control): a page-corroborated first-fill stands with no note', f2ref && f2ref.display_value === 'PO-7781' && !(f2ref.validation_note || '').trim());
  corrobOk = false; fakeResult = null;

  console.log('§5 source contract');
  const ph = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
  const wiring = ph.slice(ph.indexOf('readyArm: {'), ph.indexOf('readyArm: {') + 500);
  check('the handler wires readyArm.enabled off _readyTemplatedEnabled and floor off trust.scopeTrust', /enabled: \(db\) => _readyTemplatedEnabled\(db\)/.test(wiring) && /scopeTrust\(db, supplier, slug\)/.test(wiring) && /t\.floor/.test(wiring));
  process.env.QUIET_REREAD_ON_READY_TEMPLATED = '0';
  check('env 0 → off', handler._readyTemplatedEnabled(db) === false);
  process.env.QUIET_REREAD_ON_READY_TEMPLATED = '1';
  check('env 1 → on', handler._readyTemplatedEnabled(db) === true);
  delete process.env.QUIET_REREAD_ON_READY_TEMPLATED;
  check('default (no setting) → OFF (DARK)', handler._readyTemplatedEnabled(db) === false);
  const sh = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'settings', 'index.html'), 'utf8');
  const sr = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'settings', 'renderer.js'), 'utf8');
  check('Settings surfaces the toggle and binds it to the setting', /id="quiet-reread-on-ready-templated-toggle"/.test(sh) && /\['quiet-reread-on-ready-templated-toggle', 'quiet_reread_on_ready_templated'\]/.test(sr));
  const ql = fs.readFileSync(path.join(__dirname, 'quietLane.js'), 'utf8');
  // 2026-08-26: the hold family gained the Learning Repair `repair` member (Oracle C5) — the C3.3 hold
  // line now reads `layout || ready || repair`; either form satisfies, the first two must stay.
  check('the ready arm fires only inside a job whose reasons carry ready, and the C3.3 hold covers via layout OR ready',
        /if \(job\.reasons && job\.reasons\.has\('ready'\)\) \{/.test(ql) && /if \(nd\.via === 'layout' \|\| nd\.via === 'ready'( \|\| nd\.via === 'repair')?\) \{/.test(ql));

  lane.shutdown();
  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
