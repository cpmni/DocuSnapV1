#!/usr/bin/env node
'use strict';
/**
 * src/modules/processing/test_quiet_lane_first_fill_reliability.js
 * ----------------------------------------------------------------
 * Chris round 18 card A1 (2026-08-23; gary design → Oracle SEND BACK → rebuilt hold-at-merge /
 * release-at-finish). THE INCIDENT: doc 447's invoice_date was BLANK at import; the teach-time re-read
 * first-filled it 13-11-2026 (single-family mapping, nothing on the page agreed); four siblings of the
 * SAME job carried S3-C5 disagreements on the same box (the page agreed with the OLD value every time);
 * the ready crossing swept 447 with the wrong date. The hold that catches this class (C3.3) was scoped
 * to via layout/ready (r16 card 2) — the teach arm had no evidence gate at all.
 *
 *   §1 INCIDENT PIN — teach job: a blank-date sibling FIRST in merge order, two valued siblings whose
 *      re-read disagrees, a blank-date sibling LAST → BOTH blanks are held at finish; the note names the
 *      sender; isAutoFileEligible refuses ('flagged'); audit field_unreliable + reliability_held_ids
 *   §2 DS POSITIVE CONTROL — every sibling blank before, no disagreement → notes present during the job
 *      (hold-at-merge) and GONE when onJobDone fires (release-at-finish, ORDER pinned)
 *   §3 Nordwind control — all valued, all agree → no notes, nothing held
 *   §4 witnesses: a valued→empty LOSS counts; an engine taught-box YIELD note counts; per FIELD (a date
 *      witness does not hold a ref first-fill); a corroborated first-fill never holds
 *   §5 K=1 trade-off pin (ONE witness holds) — K is a named constant; the census decides otherwise
 *   §6 DURABILITY (the Oracle seam): the READY arm never selects a "confirm once" doc (positive control:
 *      the same doc un-noted IS selected); mergeReprocessRows carries a lane hold on an equal value and
 *      drops it on a different one
 *   §7 Q2: an S3-C5 disagreement writes corrected_to = was (never over a Stage-4.5 suggestion)
 *   §8 switch OFF byte-identical; env 1/0; default OFF; Settings toggle
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_quiet_lane_first_fill_reliability.js
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
const learning = require(path.join(ROOT, 'database', 'modules', 'learning'));
const trust = require(path.join(ROOT, 'database', 'modules', 'trust'));
const handler = require('./handler');

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req] of [['supplier_name', 1], ['invoice_number', 1], ['invoice_date', 1], ['total_amount', 0]])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, 'text', ?, 1, 1)").run(k, k, req);
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (7, 'Copperfield Invoice', 'copperfield-invoice', 'invoice')").run();
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (7, 'supplier_name', 'Copperfield Electrical')").run();
learning.setSetting(db, 'auto_file_threshold', '90');
const SUP = 'Copperfield Electrical';
const SINGLE = '{"winner_family":"mapping","agree":[],"disagree":[],"independent_agree":false}';
const mk = (supplier, { template = null, date = null, ref = 'INV-1', rows = null, oc = 94 } = {}) => {
  const id = Number(documents.insert(db, { original_filename: `${supplier.replace(/\s+/g, '')}-${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status: 'needs_review', supplier_name: supplier, document_type_id: 1, template_id: template }).lastInsertRowid);
  db.prepare('UPDATE documents SET overall_confidence = ? WHERE id = ?').run(oc, id);
  const rs = rows || [{ key: 'supplier_name', value: supplier, method: 'template_fixed' }, ...(ref != null ? [{ key: 'invoice_number', value: ref }] : []), ...(date ? [{ key: 'invoice_date', value: date }] : [])];
  for (const r of rs) db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, corroboration) VALUES (?, ?, ?, ?, 94, ?, ?, ?)').run(id, r.key, r.value, r.value, r.method || 'keyword', r.note || null, r.corrob || null);
  return id;
};
const ext = (id, key) => db.prepare('SELECT display_value, validation_note, corrected_to FROM extractions WHERE document_id = ? AND field_key = ?').get(id, key) || {};
const docRow = (id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);

let ffOn = true, corrobOk = false;
const events = [], audits = [], staged = [], jobDone = [];
let shardResolve = null, perDoc = {};
const lane = quietLane.create({
  getDb: () => db,
  enabled: () => true,
  isForegroundBusy: () => false,
  stageDocs: (d, chunk) => { staged.push(chunk.map(c => c.docId)); return { tmpNames: chunk.map(c => `rb_${c.docId}.pdf`), nameToDoc: Object.fromEntries(chunk.map(c => [`rb_${c.docId}.pdf`, { docId: c.docId, filename: c.filename, via: c.via || null, existing: d.prepare('SELECT * FROM extractions WHERE document_id = ?').all(c.docId) }])), cleanup: () => {} }; },
  runShard: ({ staged: st, onFileDone }) => new Promise(res => {
    shardResolve = res;
    for (const name of st.tmpNames) { const id = Number(name.replace(/\D/g, '')); const fr = perDoc[id]; if (fr) onFileDone({ ...fr, original_filename: name, success: true }); }
  }),
  applyResult: (d, docId, existing, msg) => {
    d.prepare('DELETE FROM extractions WHERE document_id = ?').run(docId);
    for (const [k, v] of Object.entries(msg.extractions || {})) d.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, corroboration) VALUES (?, ?, ?, ?, 94, ?, ?, ?)').run(docId, k, v.value, v.value, v.method || 'template_mapping', v.note || null, v.corroboration || SINGLE);
    d.prepare('UPDATE documents SET template_id = 7 WHERE id = ?').run(docId);
    return { ok: true };
  },
  presence: { viewers: () => [] },
  extractionsFingerprint: () => 'fp',
  notify: (e) => events.push(e),
  logAudit: (_d, e) => audits.push(e),
  logger: null, setPriority: () => {}, taskkill: () => {}, markScopeActive: () => {},
  onJobDone: (d, info) => {
    // the sweep's moment: record what the rows look like RIGHT NOW (order pin for §2)
    jobDone.push({ info, notes: d.prepare("SELECT document_id, field_key, validation_note FROM extractions WHERE validation_note IS NOT NULL").all() });
  },
  findSiblings: () => [],
  kwSelect: () => null, kwSelectEnabled: () => false,
  scopeTemplateIds: (d, sup, slug) => require(path.join(ROOT, 'database', 'modules', 'scopeReadiness')).templateIds(d, sup, slug),
  layoutArm: { enabled: () => false, onPage: () => true, nameTokens: (n) => handler.nameArmTokens(n) },
  readyArm: { enabled: () => true, floor: () => 100 },
  firstFillReliability: { enabled: () => ffOn, k: handler.FIRST_FILL_UNRELIABLE_K },
  corroborated: () => corrobOk,
});
const lastJobAudit = () => audits.filter(a => a.action === 'quiet_reprocess_job').slice(-1)[0];
const run = async (reason, supplier = SUP) => { staged.length = 0; lane.schedule(db, { supplier, typeSlug: 'invoice', reason }); await sleep(150); shardResolve && shardResolve(); await sleep(80); };
const fresh = (date, ref = 'INV-1', extra = {}) => ({ extractions: { supplier_name: { value: SUP, method: 'template_fixed' }, invoice_number: { value: ref }, invoice_date: { value: date }, ...extra } });

(async () => {
  console.log('§1 THE INCIDENT PIN (447 shape)');
  const blankFirst = mk(SUP, { date: null });                 // merged FIRST: held before any witness exists
  const v1 = mk(SUP, { date: '23-04-2026' });
  const v2 = mk(SUP, { date: '12-10-2026' });
  const same = mk(SUP, { date: '09-08-2026' });
  const blankLast = mk(SUP, { date: null });                  // merged LAST: the witnesses already exist
  perDoc = { [blankFirst]: fresh('13-11-2026'), [v1]: fresh('02-04-2026'), [v2]: fresh('02-10-2026'), [same]: fresh('09-08-2026'), [blankLast]: fresh('13-11-2026') };
  await run('teach');
  check('the witnesses: two S3-C5 disagreements on invoice_date', /Read differently after learning/.test(ext(v1, 'invoice_date').validation_note || '') && /Read differently after learning/.test(ext(v2, 'invoice_date').validation_note || ''));
  check('the blank-FIRST sibling is HELD at finish (hold-at-merge survived: the field proved unreliable)', ext(blankFirst, 'invoice_date').display_value === '13-11-2026' && /— confirm once\./.test(ext(blankFirst, 'invoice_date').validation_note || ''));
  check('the blank-LAST sibling is held too', /— confirm once\./.test(ext(blankLast, 'invoice_date').validation_note || ''));
  check('…the note names the sender and the box', /read it differently on another document from this sender — confirm once\./.test(ext(blankFirst, 'invoice_date').validation_note || ''));
  check('the agreeing sibling carries no note', !(ext(same, 'invoice_date').validation_note || '').trim());
  check("THE ONE predicate refuses the held first-fill ('flagged') — the sweep cannot file it", trust.isAutoFileEligible(db, docRow(blankFirst)).reason === 'flagged');
  const a1 = lastJobAudit().metadata;
  check('audit: field_unreliable=invoice_date:2, reliability_held_ids has both blanks', /invoice_date:2/.test(a1.field_unreliable) && a1.reliability_held_ids.split(',').map(Number).includes(blankFirst) && a1.reliability_held_ids.split(',').map(Number).includes(blankLast));
  check('audit: first_fill_ids includes the held docs', a1.first_fill_ids.split(',').map(Number).includes(blankFirst));
  check('the S3-C5 rows show the NEW value with the OLD as corrected_to (Q2: the Use/Keep buttons)', ext(v1, 'invoice_date').display_value === '02-04-2026' && ext(v1, 'invoice_date').corrected_to === '23-04-2026');

  console.log('\n§2 DS POSITIVE CONTROL — the hand-off stands (every sibling blank, no disagreement)');
  const DS = 'DOCUMENT SOLUTIONS';
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (8, 'DS', 'ds', 'invoice')").run();
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (8, 'supplier_name', ?)").run(DS);
  const d1 = mk(DS, { date: null }), d2 = mk(DS, { date: null }), d3 = mk(DS, { date: null });
  perDoc = { [d1]: { extractions: { supplier_name: { value: DS, method: 'template_fixed' }, invoice_number: { value: 'INV-1' }, invoice_date: { value: '05-05-2026' } } },
             [d2]: { extractions: { supplier_name: { value: DS, method: 'template_fixed' }, invoice_number: { value: 'INV-1' }, invoice_date: { value: '06-05-2026' } } },
             [d3]: { extractions: { supplier_name: { value: DS, method: 'template_fixed' }, invoice_number: { value: 'INV-1' }, invoice_date: { value: '07-05-2026' } } } };
  jobDone.length = 0;
  await run('teach', DS);
  check('no DS first-fill carries a note after the job (released at finish)', [d1, d2, d3].every(id => !(ext(id, 'invoice_date').validation_note || '').trim()));
  check('…and at the moment the sweep (onJobDone) fired, the DS rows were ALREADY clean (release BEFORE onJobDone — order pin)',
        jobDone.length === 1 && !jobDone[0].notes.some(n => [d1, d2, d3].includes(n.document_id) && /confirm once/.test(n.validation_note)));
  const _dsV = [d1, d2, d3].map(id => trust.isAutoFileEligible(db, docRow(id)));
  // (this hermetic fixture has no confirmed history, so the predicate's cold-start refusal is
  //  'unverifiable-value' — the point here is that NO hold note makes it 'flagged')
  check("the DS first-fills are NOT 'flagged' — the sweep's only reason left is the cold-start one (the hand-off)", _dsV.every(v => v.reason !== 'flagged'));
  check('audit: field_unreliable empty, reliability_released_ids has all three', lastJobAudit().metadata.field_unreliable === '' && [d1, d2, d3].every(id => lastJobAudit().metadata.reliability_released_ids.split(',').map(Number).includes(id)));

  console.log('\n§3 Nordwind control — all valued, all agree');
  const NW = 'Nordwind Refrigeration Ltd';
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (9, 'NW', 'nw', 'invoice')").run();
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (9, 'supplier_name', ?)").run(NW);
  const n1 = mk(NW, { date: '11-08-2025' }), n2 = mk(NW, { date: '13-02-2026' });
  perDoc = { [n1]: { extractions: { supplier_name: { value: NW, method: 'template_fixed' }, invoice_number: { value: 'INV-1' }, invoice_date: { value: '11-08-2025' } } },
             [n2]: { extractions: { supplier_name: { value: NW, method: 'template_fixed' }, invoice_number: { value: 'INV-1' }, invoice_date: { value: '13-02-2026' } } } };
  await run('teach', NW);
  check('no notes, nothing held, nothing to release', [n1, n2].every(id => !(ext(id, 'invoice_date').validation_note || '').trim()) && lastJobAudit().metadata.reliability_held_ids === '' && lastJobAudit().metadata.reliability_released_ids === '');

  console.log('\n§4 the witnesses');
  const L1 = mk(SUP, { date: '01-01-2026' }), L2 = mk(SUP, { date: null });
  perDoc = { [L1]: fresh(''), [L2]: fresh('02-02-2026') };   // L1: valued→EMPTY (a loss); L2 a first-fill
  await run('teach');
  check('a valued→empty LOSS counts as a witness → the first-fill is held', /confirm once/.test(ext(L2, 'invoice_date').validation_note || '') && /invoice_date:1/.test(lastJobAudit().metadata.field_unreliable));
  check('C3.6 re-pinned: the emptied row stays empty, the old value is NOT restored, no note', !(ext(L1, 'invoice_date').display_value || '').trim() && !(ext(L1, 'invoice_date').validation_note || '').trim());
  const Y1 = mk(SUP, { date: '03-03-2026' }), Y2 = mk(SUP, { date: null });
  perDoc = { [Y1]: fresh('03-03-2026', 'INV-1', { invoice_date: { value: '03-03-2026', note: 'Kept the read value “03-03-2026” — the taught date box read “L0/06/2026”, which isn\'t a valid calendar date. Please check.' } }), [Y2]: fresh('04-04-2026') };
  await run('teach');
  check('an engine taught-box YIELD note counts as a witness → the first-fill is held', /confirm once/.test(ext(Y2, 'invoice_date').validation_note || ''));
  const P1 = mk(SUP, { date: '05-05-2026', ref: 'INV-5' }), P2 = mk(SUP, { date: null, ref: 'INV-6' });
  perDoc = { [P1]: fresh('06-06-2026', 'INV-5'), [P2]: fresh('07-07-2026', 'INV-6') };
  db.prepare("UPDATE extractions SET display_value = '', raw_value = '' WHERE document_id = ? AND field_key = 'invoice_number'").run(P2);   // P2: ref blank too
  await run('teach');
  check('PER FIELD: a date witness holds the date first-fill but NOT the ref first-fill on the same doc', /confirm once/.test(ext(P2, 'invoice_date').validation_note || '') && !(ext(P2, 'invoice_number').validation_note || '').trim());
  const C1 = mk(SUP, { date: '08-08-2026' }), C2 = mk(SUP, { date: null });
  perDoc = { [C1]: fresh('09-09-2026'), [C2]: fresh('10-10-2026') };
  corrobOk = true;
  await run('teach');
  check('a CORROBORATED first-fill never holds, even on an unreliable field', !(ext(C2, 'invoice_date').validation_note || '').trim());
  corrobOk = false;

  console.log('\n§4b N4 — the identity field is never held by the reliability hold');
  const I1 = mk(SUP, { rows: [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_number', value: 'INV-1' }, { key: 'invoice_date', value: '01-01-2026' }] });
  const I2 = mk(SUP, { rows: [{ key: 'invoice_number', value: 'INV-2' }, { key: 'invoice_date', value: '02-02-2026' }] });   // issuer BLANK
  perDoc = { [I1]: { extractions: { supplier_name: { value: 'DOCUMENT', method: 'template_fixed' }, invoice_number: { value: 'INV-1' }, invoice_date: { value: '01-01-2026' } } },
             [I2]: { extractions: { supplier_name: { value: SUP, method: 'template_fixed' }, invoice_number: { value: 'INV-2' }, invoice_date: { value: '02-02-2026' } } } };
  await run('teach');
  check('an S3-C5 disagreement on supplier_name does NOT hold a sibling whose issuer was first-filled (identity has its own arbiters)', !(ext(I2, 'supplier_name').validation_note || '').includes('confirm once'));
  check('…the S3-C5 note on the disagreeing issuer itself still lands', /Read differently after learning/.test(ext(I1, 'supplier_name').validation_note || ''));

  console.log('\n§5 K=1 trade-off pin');
  check('FIRST_FILL_UNRELIABLE_K is 1 — ONE witness holds (a first-fill is single-witness by definition; raise K on the census, never on a guess)', handler.FIRST_FILL_UNRELIABLE_K === 1);
  const K1 = mk(SUP, { date: '11-11-2026' }), K2 = mk(SUP, { date: null });
  perDoc = { [K1]: fresh('12-12-2026'), [K2]: fresh('13-11-2026') };
  await run('teach');
  check('one disagreement → the first-fill IS held', /confirm once/.test(ext(K2, 'invoice_date').validation_note || ''));

  console.log('\n§6 DURABILITY — the Oracle seam');
  // a held first-fill below the floor: the READY arm must NOT select it
  db.prepare('UPDATE documents SET overall_confidence = 81 WHERE id = ?').run(K2);
  staged.length = 0; perDoc = {};
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'ready' }); await sleep(150);
  const sel = (staged[0] || []).slice(); shardResolve && shardResolve(); await sleep(80);
  check('the READY arm does NOT re-read a doc holding a "confirm once" note (its re-read would shed the hold)', !sel.includes(K2));
  db.prepare("UPDATE extractions SET validation_note = NULL WHERE document_id = ? AND field_key = 'invoice_date'").run(K2);
  staged.length = 0;
  lane.schedule(db, { supplier: SUP, typeSlug: 'invoice', reason: 'ready' }); await sleep(150);
  const sel2 = (staged[0] || []).slice(); shardResolve && shardResolve(); await sleep(80);
  check('positive control: the same doc WITHOUT the note IS selected', sel2.includes(K2));
  // mergeReprocessRows carries a lane hold on an equal value, drops it on a different one
  const merge = handler._mergeReprocessRows;
  const held = [{ field_key: 'invoice_date', display_value: '13-11-2026', raw_value: '13-11-2026', validation_note: 'The box that reads this field read it differently on another document from this sender — confirm once.', corrected_to: null }];
  const sameFresh = [{ field_key: 'invoice_date', display_value: '13-11-2026', raw_value: '13-11-2026', validation_note: null, corrected_to: null }];
  const diffFresh = [{ field_key: 'invoice_date', display_value: '03-11-2026', raw_value: '03-11-2026', validation_note: null, corrected_to: null }];
  const m1 = merge(held, sameFresh), m2 = merge(held, diffFresh);
  check('mergeReprocessRows: the SAME value re-read keeps the lane hold (a repeat misread is not a re-verification)', /confirm once/.test((m1.find(r => r.field_key === 'invoice_date') || {}).validation_note || ''));
  check('…a DIFFERENT fresh value outranks the hold and drops it', !((m2.find(r => r.field_key === 'invoice_date') || {}).validation_note || '').trim() && m2.find(r => r.field_key === 'invoice_date').display_value === '03-11-2026');
  const heldS3 = [{ field_key: 'invoice_date', display_value: '02-04-2026', raw_value: '02-04-2026', validation_note: "Read differently after learning — was '23-04-2026', now '02-04-2026'. Please check which is right.", corrected_to: '23-04-2026' }];
  const m3 = merge(heldS3, [{ field_key: 'invoice_date', display_value: '02-04-2026', raw_value: '02-04-2026', validation_note: null, corrected_to: null }]);
  check('…an S3-C5 hold survives the same way, corrected_to intact', /Read differently/.test(m3[0].validation_note || '') && m3[0].corrected_to === '23-04-2026');
  process.env.REPROCESS_CARRY_LANE_HOLD = '0';
  check('kill switch REPROCESS_CARRY_LANE_HOLD=0 → the old used_new (hold shed)', !((merge(held, sameFresh)[0] || {}).validation_note || '').trim());
  delete process.env.REPROCESS_CARRY_LANE_HOLD;

  console.log('\n§7 Q2 — corrected_to never overwrites a Stage-4.5 suggestion');
  const Q1 = mk(SUP, { date: '14-01-2026' });
  perDoc = { [Q1]: fresh('15-01-2026', 'INV-1', { invoice_date: { value: '15-01-2026' } }) };
  // simulate an engine suggestion on the fresh row: applyResult writes corrected_to only from msg — patch after
  const origApply = lane._internals && lane._internals.applyResult;
  await run('teach');
  check('an S3-C5 disagreement on a row WITHOUT a suggestion writes corrected_to = was', ext(Q1, 'invoice_date').corrected_to === '14-01-2026');
  db.prepare("UPDATE extractions SET corrected_to = '99-99-9999' WHERE document_id = ? AND field_key = 'invoice_date'").run(Q1);
  db.prepare("UPDATE extractions SET validation_note = NULL WHERE document_id = ?").run(Q1);
  const Q1rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(Q1);
  const chg = lane._internals.holdChangedReads(db, Q1, Q1rows.map(r => (r.field_key === 'invoice_date' ? { ...r, display_value: '14-01-2026' } : r)));
  check('…but never over an existing corrected_to (the Stage-4.5 suggestion wins)', chg.length === 1 && ext(Q1, 'invoice_date').corrected_to === '99-99-9999');

  console.log('\n§8 the switch');
  ffOn = false;
  const O1 = mk(SUP, { date: '16-01-2026' }), O2 = mk(SUP, { date: null });
  perDoc = { [O1]: fresh('17-01-2026'), [O2]: fresh('18-01-2026') };
  await run('teach');
  check('OFF: the first-fill is NOT held (byte-identical to before), the S3-C5 note still lands', !(ext(O2, 'invoice_date').validation_note || '').trim() && /Read differently/.test(ext(O1, 'invoice_date').validation_note || '') && lastJobAudit().metadata.field_unreliable === '');
  ffOn = true;
  process.env.QUIET_REREAD_FF_RELIABILITY = '0'; check('env 0 → off', handler._firstFillReliabilityEnabled(db) === false);
  process.env.QUIET_REREAD_FF_RELIABILITY = '1'; check('env 1 → on', handler._firstFillReliabilityEnabled(db) === true);
  delete process.env.QUIET_REREAD_FF_RELIABILITY;
  check('default (no setting) → OFF (DARK)', handler._firstFillReliabilityEnabled(db) === false);
  const sh = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'settings', 'index.html'), 'utf8');
  const sr = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'settings', 'renderer.js'), 'utf8');
  check('Settings surfaces the toggle', /id="quiet-reread-ff-reliability-toggle"/.test(sh) && /\['quiet-reread-ff-reliability-toggle', 'quiet_reread_first_fill_reliability_hold'\]/.test(sr));
  const ph = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
  check('the handler wires firstFillReliability off the switch + the named K', /firstFillReliability: \{ enabled: \(db\) => _firstFillReliabilityEnabled\(db\), k: FIRST_FILL_UNRELIABLE_K \}/.test(ph));

  lane.shutdown();
  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
