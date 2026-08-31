#!/usr/bin/env node
'use strict';
/**
 * src/modules/processing/test_quiet_lane_layout.js
 * -------------------------------------------------
 * Q3 of the Chris round-14 queue — THE LAYOUT ARM of the quiet lane (card 6: a ⊕ box on a Pelican
 * sibling re-read nothing until "Reprocess 17" was pressed). gary → Oracle SIGN-OFF-W/COND
 * C3.1–C3.7, 2026-08-22 (docs/oracle_log.md). DARK behind quiet_reread_on_layout /
 * QUIET_REREAD_ON_LAYOUT.
 *
 *   C3.1 preconditions: switch ON + template_identity_on_page ON; population = held docs carrying
 *        one of the scope's templates AND the scope's name, minus S3-C5-noted docs (positive
 *        control: the same doc without the note IS selected); reasons is a Set
 *   C3.2 an all-generic scope name (unjudgeable → _identity_refuses abstains) skips the arm
 *   C3.3 a REQUIRED role field first-filled in a 'layout' job is held with a note unless the read
 *        is page-corroborated
 *   C3.4 a 'layout' write during a running job unions the reasons; the rerun recomputes with it
 *   C3.5 the triggers: an authoritative anchor write that CHANGED something / a mapping write that
 *        changed something; never a plain confirm; never an identical re-save
 *   C3.6 valued → EMPTY merges (held missing-required), the old value is NOT restored
 *   OFF byte-identical · the JS name-token mirror equals the Python generic set
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_quiet_lane_layout.js
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
const mk = (supplier, { template = null, status = 'needs_review', note = null, rows = [] } = {}) => {
  const id = Number(documents.insert(db, { original_filename: `${supplier || 'none'}-${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status, supplier_name: supplier, document_type_id: 1, template_id: template }).lastInsertRowid);
  for (const r of rows) db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, corroboration) VALUES (?, ?, ?, ?, 90, ?, ?, ?)').run(id, r.key, r.value, r.value, r.method || 'keyword', r.note || null, r.corrob || null);
  if (note) db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note) VALUES (?, 'invoice_number', 'X', 'X', 90, 'keyword', ?)").run(id, note);
  return id;
};
const L1 = mk(SUP, { template: 7 });                                              // the target: template-carrying, named, clean
const L2 = mk(SUP, { template: 7, note: "Read differently after learning — was 'A', now 'B'. Please check which is right." });   // seam 2: already asked
const L3 = mk('Bolt Fasteners', { template: 7 });                                 // another sender's claim on the scope's template
const L4 = mk(SUP, { template: 8 });                                              // the scope's name on ANOTHER scope's template
const L5 = mk(SUP);                                                               // template-less, named → arm (a) (union)
const L6 = mk(SUP, { template: 7, status: 'confirmed' });                         // filed — never
const L7 = mk(SUP, { template: 7, status: 'deferred' });                          // parked — never

let laneOn = true, layoutOn = true, onPage = true, corrobOk = false;
const events = [], audits = [], staged = [];
let shardResolve = null, fakeResult = null;
const lane = quietLane.create({
  getDb: () => db,
  enabled: () => laneOn,
  isForegroundBusy: () => false,
  stageDocs: (d, chunk) => { staged.push(chunk.map(c => c.docId)); return { tmpNames: chunk.map(c => `rb_${c.docId}.pdf`), nameToDoc: Object.fromEntries(chunk.map(c => [`rb_${c.docId}.pdf`, { docId: c.docId, filename: c.filename, via: c.via || null, existing: d.prepare('SELECT * FROM extractions WHERE document_id = ?').all(c.docId) }])), cleanup: () => {} }; },
  runShard: ({ staged: st, onFileDone }) => new Promise(res => { shardResolve = res; if (fakeResult) for (const name of st.tmpNames) onFileDone({ ...fakeResult, original_filename: name, success: true }); }),
  applyResult: (d, docId, existing, msg) => {
    // simulate the merge: replace the rows with the fresh read
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
  layoutArm: { enabled: () => layoutOn, onPage: () => onPage, nameTokens: (n) => handler.nameArmTokens(n) },
  corroborated: () => corrobOk,
});
const lastJobAudit = () => audits.filter(a => a.action === 'quiet_reprocess_job').slice(-1)[0];
const finishRun = async () => { shardResolve && shardResolve(); await sleep(80); };

(async () => {
  console.log('§1 a plain teach job never consults the layout arm');
  staged.length = 0;
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'teach' });
  await sleep(150);
  check('teach job selected the template-less named doc only (arm a)', (staged[0] || []).join() === String(L5));
  await finishRun();
  check('audit: reasons=teach, layout_arm empty', lastJobAudit().metadata.reasons === 'teach' && lastJobAudit().metadata.layout_arm === '');

  console.log('§2 the layout arm (C3.1) — population');
  staged.length = 0;
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'layout' });
  await sleep(150);
  const sel = staged[0] || [];
  check('the clean template-carrying named sibling IS selected', sel.includes(L1));
  // P3 (Chris r19 N3, Oracle 2026-08-23 W/COND): the LAYOUT arm re-reads NOTED docs too — a new box is new
  // evidence and the note was about the previous box (the corrected re-teach re-read nothing). The READY
  // arm keeps the exclusion (test_quiet_lane_ready_templated.js); REPROCESS_CARRY_LANE_HOLD=0 falls back.
  check('P3: a doc holding an S3-C5 "Read differently" note IS selected by the LAYOUT arm (a new box re-tests it)', sel.includes(L2));
  check("another sender's claim on the scope's template is NOT", !sel.includes(L3));
  check("the scope's name on ANOTHER scope's template is NOT", !sel.includes(L4));
  check('filed / deferred docs never', !sel.includes(L6) && !sel.includes(L7));
  check('union with arm (a): the template-less named doc is still there', sel.includes(L5));
  await finishRun();
  check('audit: reasons=layout, layout_arm=selected:2 (L1 + the noted L2)', lastJobAudit().metadata.reasons === 'layout' && lastJobAudit().metadata.layout_arm === 'selected:2');
  // the carry kill-switch: the layout arm falls back to EXCLUDING noted docs (a same-value re-read would
  // shed the hold without the carry) — the original seam-2 rule
  process.env.REPROCESS_CARRY_LANE_HOLD = '0';
  staged.length = 0;
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'layout' });
  await sleep(150);
  check('REPROCESS_CARRY_LANE_HOLD=0 → the noted doc is NOT selected (seam-2 fallback), the clean one still is', !(staged[0] || []).includes(L2) && (staged[0] || []).includes(L1));
  await finishRun();
  delete process.env.REPROCESS_CARRY_LANE_HOLD;

  console.log('§3 preconditions (C3.1 / C3.2) — each skip is audited and selects nothing extra');
  for (const [label, setup, expect] of [
    ['switch OFF', () => { layoutOn = false; }, 'skipped:off'],
    ['template_identity_on_page OFF', () => { layoutOn = true; onPage = false; }, 'skipped:on_page_off'],
  ]) {
    setup(); staged.length = 0;
    lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'layout' });
    await sleep(150);
    check(`${label}: template-carrying docs NOT selected, arm audited ${expect}`, !(staged[0] || []).includes(L1) && (staged[0] || []).includes(L5));
    await finishRun();
    check(`…audit layout_arm=${expect}`, lastJobAudit().metadata.layout_arm === expect);
  }
  layoutOn = true; onPage = true;
  // unjudgeable identity: an all-generic scope name
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (9, 'DOCUMENT SOLUTIONS', 'document-solutions', 'invoice')").run();
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (9, 'supplier_name', 'DOCUMENT SOLUTIONS')").run();
  const D1 = mk('DOCUMENT SOLUTIONS', { template: 9 });
  staged.length = 0;
  lane.schedule(db, { supplier: 'DOCUMENT SOLUTIONS', typeSlug: 'invoice', reason: 'layout' });
  await sleep(150);
  check('an all-generic scope name ("DOCUMENT SOLUTIONS") skips the arm (C3.2)', !(staged[0] || []).includes(D1));
  await finishRun();
  check('…audit layout_arm=skipped:unjudgeable_identity', lastJobAudit().metadata.layout_arm === 'skipped:unjudgeable_identity');
  check('nameArmTokens: "Acme Widgets" → 2 tokens (judgeable), "DOCUMENT SOLUTIONS" → 0, "Sterling Ltd" → 1 (NOT judgeable)',
        handler.nameArmTokens('Acme Widgets').size === 2 && handler.nameArmTokens('DOCUMENT SOLUTIONS').size === 0 && handler.nameArmTokens('Sterling Ltd').size === 1);
  const py = fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'template_matcher.py'), 'utf8');
  const m = /_GENERIC_NAME_TOKENS = frozenset\(\{([\s\S]*?)\}\)/.exec(py);
  const pyset = new Set((m ? m[1] : '').match(/"([a-z]+)"/g).map(x => x.replace(/"/g, '')));
  check(`MIRROR PAIR: the JS generic set equals template_matcher._GENERIC_NAME_TOKENS (${pyset.size} tokens)`,
        pyset.size > 0 && pyset.size === handler.NAME_ARM_GENERIC.size && [...pyset].every(t => handler.NAME_ARM_GENERIC.has(t)));

  console.log('§4 C3.4 — a layout write during a running job unions the reasons; the rerun recomputes');
  staged.length = 0;
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'teach' });
  await sleep(150);
  check('the running job is a teach job (template-carrying NOT selected)', !(staged[0] || []).includes(L1));
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'layout' });   // lands mid-run
  const running = [...lane._internals.jobs.values()][0];
  check('the running job now carries both reasons', running && running.reasons.has('teach') && running.reasons.has('layout') && running.rerun === true);
  await finishRun();                                   // first pass ends → rerun scheduled with the union
  await sleep(150);
  check('the rerun selected the template-carrying sibling (recomputed with the union)', (staged[1] || []).includes(L1));
  await finishRun();
  check('audit of the rerun: reasons=teach+layout', /teach\+layout|layout\+teach/.test(lastJobAudit().metadata.reasons));

  console.log('§5 C3.3 — first-fill hold (fail toward review) and C3.6 valued→empty');
  const F1 = mk(SUP, { template: 7, rows: [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_date', value: '01-08-2026' }] });   // ref EMPTY
  const F2 = mk(SUP, { template: 7, rows: [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_number', value: 'INV-9', method: 'keyword' }, { key: 'invoice_date', value: '01-08-2026' }] });
  fakeResult = { extractions: { supplier_name: { value: SUP, method: 'template_fixed' }, invoice_number: { value: 'PO-7781', method: 'template_mapping' }, invoice_date: { value: '01-08-2026', method: 'template_mapping' } } };
  corrobOk = false; staged.length = 0;
  // only F1/F2 + the earlier fixtures are candidates; restrict by viewing: nothing else changes
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'layout' });
  await sleep(150);
  await finishRun();
  const f1ref = db.prepare("SELECT display_value, validation_note FROM extractions WHERE document_id = ? AND field_key = 'invoice_number'").get(F1);
  check('F1: the new box FIRST-FILLED the empty ref → held with the note (not corroborated)', f1ref && f1ref.display_value === 'PO-7781' && /Read from your new box — confirm once/.test(f1ref.validation_note || ''));
  const f2ref = db.prepare("SELECT display_value, validation_note FROM extractions WHERE document_id = ? AND field_key = 'invoice_number'").get(F2);
  check('F2: a VALUED ref read differently → the S3-C5 note (unchanged behaviour), not the first-fill note', f2ref && /Read differently after learning/.test(f2ref.validation_note || '') && !/confirm once/.test(f2ref.validation_note || ''));
  check('audit carries first_fill_ids', String(lastJobAudit().metadata.first_fill_ids).split(',').map(Number).includes(F1));
  // positive control: a corroborated first-fill stands
  const F3 = mk(SUP, { template: 7, rows: [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_date', value: '01-08-2026' }] });
  corrobOk = true;
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'layout' });
  await sleep(150); await finishRun();
  const f3ref = db.prepare("SELECT display_value, validation_note FROM extractions WHERE document_id = ? AND field_key = 'invoice_number'").get(F3);
  check('F3 (positive control): a page-corroborated first-fill stands with no note', f3ref && f3ref.display_value === 'PO-7781' && !(f3ref.validation_note || '').trim());
  corrobOk = false;
  // C3.6: valued → EMPTY merges; the old value is NOT restored
  const F4 = mk(SUP, { template: 7, rows: [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_number', value: 'INV-44' }, { key: 'invoice_date', value: '01-08-2026' }] });
  fakeResult = { extractions: { supplier_name: { value: SUP, method: 'template_fixed' }, invoice_number: { value: '', method: 'template_mapping' }, invoice_date: { value: '01-08-2026', method: 'template_mapping' } } };
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'layout' });
  await sleep(150); await finishRun();
  const f4ref = db.prepare("SELECT display_value, validation_note FROM extractions WHERE document_id = ? AND field_key = 'invoice_number'").get(F4);
  check('C3.6: F4 valued→EMPTY merged as EMPTY (held missing-required), the old INV-44 NOT restored, no note', f4ref && !(f4ref.display_value || '').trim() && !(f4ref.validation_note || '').trim());
  // Chris round 16 card 2: the hold is SCOPED to docs the layout ARM selected. A template-LESS doc
  // re-read by the teach arms in a job that also carries 'layout' (the wizard's mapping saves + its
  // taught confirm coalesce) is Slice 3's signed path — its first-fills must NOT be held.
  const F5 = mk(SUP, { rows: [{ key: 'supplier_name', value: SUP, method: 'letterhead_prefill' }] });   // template-less, arm (a)
  fakeResult = { extractions: { supplier_name: { value: SUP, method: 'template_fixed' }, invoice_number: { value: 'PO-7781', method: 'template_mapping' }, invoice_date: { value: '01-08-2026', method: 'template_mapping' } } };
  corrobOk = false;
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'teach' });
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'layout' });   // the wizard's mapping save lands in the same debounce
  await sleep(150); await finishRun();
  const f5ref = db.prepare("SELECT display_value, validation_note FROM extractions WHERE document_id = ? AND field_key = 'invoice_number'").get(F5);
  check('Chris r16 card 2: a template-LESS doc (teach arm) in a teach+layout job is first-filled WITHOUT the "confirm once" hold', f5ref && f5ref.display_value === 'PO-7781' && !/confirm once/.test(f5ref.validation_note || ''));
  check("…the job carried both reasons (the coalesced wizard case)", /teach\+layout|layout\+teach/.test(lastJobAudit().metadata.reasons));
  fakeResult = null;

  console.log('§6 the triggers (C3.5) + the switch — source contract');
  const ph = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
  const th = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'templates', 'handler.js'), 'utf8');
  const rh = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'review', 'handler.js'), 'utf8');
  const anchor = ph.slice(ph.indexOf("ipcMain.handle('save-field-anchor'"), ph.indexOf("ipcMain.handle('save-field-rule'"));
  check('save-field-anchor schedules a layout re-read ONLY for an authoritative write that CHANGED the row (snapshot before/after)',
        /data\.authoritative && data\.supplier_name && data\.document_type && _before !== null && _authSnap\(\) !== _before/.test(anchor) && /reason: 'layout'/.test(anchor));
  const mapping = th.slice(th.indexOf("ipcMain.handle('save-template-mapping'"), th.indexOf("ipcMain.handle('set-template-mapping-enabled'"));
  check('save-template-mapping schedules a layout re-read only when the mapping changed (snapshot before/after)', /_mapBefore !== null && _mapSnap\(\) !== _mapBefore/.test(mapping) && /reason: 'layout'/.test(mapping));
  check('a plain confirm never schedules a layout reason', !/reason: 'layout'/.test(rh));
  check('the lane reads the switch + on-page + name tokens through its deps (handler wiring)', /layoutArm: \{/.test(ph) && /template_identity_on_page/.test(ph.slice(ph.indexOf('layoutArm: {'), ph.indexOf('layoutArm: {') + 600)) && /corroborated: \(rec\) => require\('\.\.\/\.\.\/\.\.\/database\/modules\/trust'\)\._corrobLicensed\(rec\)/.test(ph));
  process.env.QUIET_REREAD_ON_LAYOUT = '0';
  check('env 0 → off', handler._layoutRereadEnabled(db) === false);
  process.env.QUIET_REREAD_ON_LAYOUT = '1';
  check('env 1 → on', handler._layoutRereadEnabled(db) === true);
  delete process.env.QUIET_REREAD_ON_LAYOUT;
  // mig 93 seeds quiet_reread_on_layout ON; state the OFF arm explicitly so the reflection pins the
  // switch's OFF semantics (env unset → the setting decides), not the seed.
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('quiet_reread_on_layout', 'false')").run();
  check('default (no setting) → OFF (DARK)', handler._layoutRereadEnabled(db) === false);
  const eng = fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'engine.py'), 'utf8');
  check('SEAM-1 pin comment rewritten: names the vetted doors, no longer claims one call site', /REWRITTEN 2026-08-22, Oracle Q3 C3\.1/.test(eng) && !/has EXACTLY ONE call site\n/.test(eng.slice(eng.indexOf('SEAM-1 PIN'), eng.indexOf('SEAM-1 PIN') + 2500)));
  check('the on-page guard is still the engine\'s decline path (sticky_binding_declined)', /sticky_binding_declined/.test(eng));

  lane.shutdown();
  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
