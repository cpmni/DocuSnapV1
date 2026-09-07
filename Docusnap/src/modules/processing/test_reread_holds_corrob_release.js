#!/usr/bin/env node
'use strict';
/*
 * src/modules/processing/test_reread_holds_corrob_release.js — REREAD_HOLD_CORROB_RELEASE (2026-09-07, gary →
 * Oracle SIGN-OFF-W/COND C13-C17). The S3-C5 "Read differently after learning" hold never consulted the fresh
 * row's corroboration record. With the DARK switch ON, a fresh read that is LICENSED (≥2 independent page
 * families) WITH a keyword (page-text) witness, over an OLD record that was NOT itself licensed, on a
 * non-identity field, stands: no note, no put-back offer, a carried sentence stripped, a carried baseline
 * corrected_to cleared. Pinned trade-offs: T1 mapping-only agree → holds · T2 any disagree → holds · T3 the
 * old record licensed → holds · T4 identity never · T5 only the S3-C5 baseline corrected_to is cleared and an
 * unrelated note sentence survives · OFF = today byte-for-byte · E1 replay (a mapping disagree = inert).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/processing/test_reread_holds_corrob_release.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };

const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const doctypes = require(path.join(ROOT, 'database', 'modules', 'document_types'));
const trust = require(path.join(ROOT, 'database', 'modules', 'trust'));
const holdsMod = require('./rereadHolds');

const db = new Database(':memory:');
runMigrations(db);
const tid = Number(doctypes.addType(db, { name: 'Release Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }).lastInsertRowid);
let order = 10;
for (const [k, type] of [['supplier_name', 'text'], ['invoice_number', 'reference'], ['invoice_date', 'date']]) { doctypes.addField(db, { document_type_id: tid, key: k, label: k, type, required: 0, sort_order: order }); order += 10; }
doctypes.ensureStructuralRoles(db, tid);
const SUP = 'Ironbridge Fabrication';
const ins = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, corrected_to, corroboration) VALUES (?, ?, ?, ?, 90, ?, ?, ?, ?)');
const mkDoc = () => Number(documents.insert(db, { original_filename: `inv-${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status: 'needs_review', supplier_name: SUP, document_type_id: tid }).lastInsertRowid);
const setRows = (id, rows) => { db.prepare('DELETE FROM extractions WHERE document_id = ?').run(id); for (const r of rows) ins.run(id, r.key, r.value, r.value, r.method || 'template_mapping', r.note || null, r.ct || null, r.rec ? JSON.stringify(r.rec) : null); };
const snapshot = (id) => db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(id);
const ext = (id, key) => db.prepare('SELECT display_value, validation_note, corrected_to FROM extractions WHERE document_id = ? AND field_key = ?').get(id, key) || {};
const LICENSED_KW = { winner_family: 'crop', agree: ['keyword', 'mapping'], disagree: [], independent_agree: true };
const LICENSED_NO_KW = { winner_family: 'crop', agree: ['mapping'], disagree: [], independent_agree: true };
const DISAGREE = { winner_family: 'crop', agree: ['keyword'], disagree: [{ family: 'mapping', value: '5/03/2026' }], independent_agree: true };
const S3C5 = (was, now) => `Read differently after learning — was '${was}', now '${now}'. Please check which is right.`;

const mkHolds = (on) => holdsMod.create({
  corroborated: (rec) => trust._corrobLicensed(rec),
  changedReadLicensed: (rec) => trust._corrobLicensedKeyword(rec),
  corrobReleaseEnabled: () => on,
  k: 1,
});
const base = (id) => [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_number', value: 'INV-80458' }, { key: 'invoice_date', value: '09-03-2026' }];
const fresh = (id, rec, extra = {}) => [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_number', value: 'INV-80458' }, { key: 'invoice_date', value: '25-03-2026', method: 'anchor_crop', rec, ...extra }];

console.log('§0 the keyword tightening of the ONE licence');
check('licensed + keyword witness → true', trust._corrobLicensedKeyword(LICENSED_KW) === true);
check('licensed WITHOUT a keyword family → false (two box crops share the clip)', trust._corrobLicensedKeyword(LICENSED_NO_KW) === false);
check('a disagree entry → false (the licence itself refuses)', trust._corrobLicensedKeyword(DISAGREE) === false);
check('keyword as the WINNER counts', trust._corrobLicensedKeyword({ winner_family: 'keyword', agree: ['crop'], disagree: [], independent_agree: true }) === true);
check('null / junk → false', trust._corrobLicensedKeyword(null) === false && trust._corrobLicensedKeyword('{oops') === false);

console.log('§1 switch OFF = today: the hold + the put-back offer');
{
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d); setRows(d, fresh(d, LICENSED_KW));
  const ch = mkHolds(false).holdChangedReads(db, d, ex);
  const r = ext(d, 'invoice_date');
  check('held with the S3-C5 sentence', ch.length === 1 && !ch[0].released && (r.validation_note || '').includes(S3C5('09-03-2026', '25-03-2026')));
  check("corrected_to offers the baseline '09-03-2026'", r.corrected_to === '09-03-2026');
}

console.log('§2 switch ON: a licensed keyword-witnessed fresh read over an unlicensed old record is RELEASED');
{
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d); setRows(d, fresh(d, LICENSED_KW));
  const ch = mkHolds(true).holdChangedReads(db, d, ex);
  const r = ext(d, 'invoice_date');
  check('no note, no corrected_to', !r.validation_note && !r.corrected_to);
  check('the changed entry is still reported (reliability witness) with released:true', ch.length === 1 && ch[0].released === true && ch[0].key === 'invoice_date');
}

console.log('§3 pinned trade-offs');
{
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d); setRows(d, fresh(d, LICENSED_NO_KW));
  mkHolds(true).holdChangedReads(db, d, ex);
  check('T1: agree [mapping] only (no keyword) → STILL HOLDS', (ext(d, 'invoice_date').validation_note || '').includes('Read differently after learning'));
}
{
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d); setRows(d, fresh(d, DISAGREE));
  mkHolds(true).holdChangedReads(db, d, ex);
  check("T2 / E1 replay: a mapping disagree ('5/03/2026') → STILL HOLDS (B alone is inert on E1)", (ext(d, 'invoice_date').validation_note || '').includes('Read differently after learning'));
}
{
  const d = mkDoc();
  setRows(d, [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_number', value: 'INV-80458' }, { key: 'invoice_date', value: '09-03-2026', rec: LICENSED_KW }]);
  const ex = snapshot(d); setRows(d, fresh(d, LICENSED_KW));
  mkHolds(true).holdChangedReads(db, d, ex);
  check('T3 (C14): the OLD record was itself licensed → two licensed reads disagree across time → HOLDS', (ext(d, 'invoice_date').validation_note || '').includes('Read differently after learning'));
}
{
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d);
  setRows(d, [{ key: 'supplier_name', value: 'Ironbridge Fabrications', method: 'anchor_crop', rec: LICENSED_KW }, { key: 'invoice_number', value: 'INV-80458' }, { key: 'invoice_date', value: '09-03-2026' }]);
  mkHolds(true).holdChangedReads(db, d, ex);
  check('T4: the IDENTITY is never released', (ext(d, 'supplier_name').validation_note || '').includes('Read differently after learning'));
}
{
  // a carried hold from an earlier merge: the sentence + the baseline corrected_to ride the fresh row
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d);
  setRows(d, fresh(d, LICENSED_KW, { note: `Some other writer's sentence. ${S3C5('09-03-2026', '25-03-2026')}`, ct: '09-03-2026' }));
  mkHolds(true).holdChangedReads(db, d, ex);
  const r = ext(d, 'invoice_date');
  check("T5: the carried S3-C5 sentence is stripped, the unrelated sentence survives", r.validation_note === "Some other writer's sentence.");
  check('T5: the carried BASELINE corrected_to is cleared', !r.corrected_to);
}
{
  // another writer's suggestion (e.g. a pad-window flag) is NOT the baseline → untouched
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d);
  setRows(d, fresh(d, LICENSED_KW, { ct: '26-03-2026' }));
  mkHolds(true).holdChangedReads(db, d, ex);
  check("C15: a corrected_to that is NOT the S3-C5 baseline stays ('26-03-2026')", ext(d, 'invoice_date').corrected_to === '26-03-2026');
}
{
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d); setRows(d, fresh(d, null));
  mkHolds(true).holdChangedReads(db, d, ex);
  check('no record on the fresh row → fail-closed → HOLDS', (ext(d, 'invoice_date').validation_note || '').includes('Read differently after learning'));
}
{
  const d = mkDoc(); setRows(d, base(d)); const ex = snapshot(d); setRows(d, fresh(d, LICENSED_KW));
  const ch = holdsMod.create({ corroborated: (rec) => trust._corrobLicensed(rec), k: 1 }).holdChangedReads(db, d, ex);   // deps absent (an old caller)
  check('a create() without the new deps behaves as today (holds)', ch.length === 1 && !ch[0].released && (ext(d, 'invoice_date').validation_note || '').includes('Read differently after learning'));
}

console.log('§4 holdFirstFills is untouched by the switch');
{
  const d = mkDoc(); setRows(d, [{ key: 'supplier_name', value: SUP, method: 'template_fixed' }, { key: 'invoice_number', value: '' }, { key: 'invoice_date', value: '' }]); const ex = snapshot(d);
  setRows(d, fresh(d, LICENSED_NO_KW));
  const ff = mkHolds(true).holdFirstFills(db, d, ex, holdsMod.NOTES.manual);
  check('a first-fill with a plain licensed record (no keyword needed there) still stands as before', !ff.some(h => h.key === 'invoice_date'));
}

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
