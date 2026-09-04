'use strict';
/*
 * test_ref_resolver_autofile_hold.js — the RELOCATED single-glyph reference resolvers (leg-b RESOLVE_REF_NEAR_MISS,
 * leg-a RESOLVE_REF_POSITIONAL; Oracle SEND-BACK→SIGN-OFF-W/COND C1-C11, 2026-09-04 late) are REVIEW-BOUND by
 * THREE independent gates in trust.isAutoFileEligible, each asserted ALONE:
 *   1. the dedicated validation_note -> 'flagged';
 *   2. the DIFFERING corrected_to (a SUGGESTION: value = the raw read, corrected_to = the proposal) -> 'flagged'
 *      even with vacuous-ignore ON (it is not vacuous — it differs);
 *   3. the <=70 cap vs the 88 CRITICAL_FIELD_FLOOR -> 'weak-critical-field' with note AND corrected_to stripped.
 * Also pins: no method suffix reaches getFieldFormats' exclusion clauses (there is none to exclude — S3); no JS
 * clearer matches either note; the renderer's "auto-corrected" badge cannot render (corrected_to != value); and an
 * ACCEPTED suggestion legitimately writes a `corrections` row (S4 — the substrate confusion-precedence mines).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_ref_resolver_autofile_hold.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const learning = require('./learning');
const trust = require('./trust');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1,'Print Tracker','print_tracker',0,'reference_number','date')").run();
  for (const [k, t] of [['supplier_name', 'text'], ['reference_number', 'reference'], ['date', 'date']])
    db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1,?,?,?,1,1)').run(k, k, t);
  return db;
}
const NOTE = "Cross-check: read as '1625802868', but this sender has a confirmed reference '1G25802868' one OCR-confusable "
           + "character away (6→G; '1G25802868' confirmed 2 times before) — corrected against a confirmed reference; please confirm once before filing.";
const NOTE_A = "Cross-check: read as '762923124N3M2', but re-reading this reference under a different image setting agreed on "
             + "'752923124N3M2' — corrected after re-reading the reference; please confirm once before filing.";
const rowB = (over = {}) => ({ field_key: 'reference_number', display_value: '1625802868', raw_value: '1625802868',
                               confidence: 70, validation_note: NOTE, corrected_to: '1G25802868', was_corrected: 0,
                               extraction_method: 'anchor_crop_relocated', ...over });
const clean = (k, v, c = 96) => ({ field_key: k, display_value: v, raw_value: v, confidence: c, validation_note: null, corrected_to: null });
const docAt = (db, conf) => {
  const id = Number(db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence)
                                VALUES (1,'a.pdf','/in','needs_review','Print Tracker',?)`).run(conf).lastInsertRowid);
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
};
const OPTS = { gradOn: false, corrobAutoFile: false, vacuousCorrectedToIgnore: true };

console.log('1. THREE independent gates, each alone');
{
  const db = freshDb(); const doc = docAt(db, 100);
  const ex = (row) => [clean('supplier_name', 'Print Tracker'), row, clean('date', '01-09-2026')];
  const r1 = trust.isAutoFileEligible(db, doc, { ...OPTS, extractions: ex(rowB()) });
  check('gate 1+2 present: refused "flagged"', r1.eligible === false && r1.reason === 'flagged');
  const r2 = trust.isAutoFileEligible(db, doc, { ...OPTS, extractions: ex(rowB({ validation_note: null })) });
  check('note stripped, corrected_to DIFFERS from the value (a real suggestion): still "flagged" even with vacuous-ignore ON',
        r2.eligible === false && r2.reason === 'flagged');
  const r3 = trust.isAutoFileEligible(db, doc, { ...OPTS, extractions: ex(rowB({ validation_note: null, corrected_to: null })) });
  check('note AND corrected_to stripped, conf 70 < 88 on the ref role: "weak-critical-field:reference_number"',
        r3.eligible === false && r3.reason === 'weak-critical-field:reference_number');
  const r4 = trust.isAutoFileEligible(db, doc, { ...OPTS, extractions: ex(rowB({ validation_note: null, corrected_to: null, confidence: 95 })) });
  check('control: the same row at 95 with nothing else WOULD file (the fixture is otherwise eligible)', r4.eligible === true);
  db.close();
}

console.log('2. Provenance — no method suffix, so nothing to exclude; the badge cannot render; clearers do not match');
{
  const src = fs.readFileSync(path.join(REPO, 'database', 'modules', 'learning.js'), 'utf8');
  check('getFieldFormats has no ref_resolved / ref_positional exclusion clause (there is no marker — S3)', !/ref_resolved|ref_positional/.test(src));
  const r = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  check('the "auto-corrected" badge needs value === corrected_to — a suggestion (value != corrected_to) shows the Use/keep affordance instead',
        /isApplied\s*=\s*!!correctedTo\s*&&\s*val\s*===\s*correctedTo/.test(r));
  const cfs = fs.readFileSync(path.join(REPO, 'src', 'services', 'classFixService.js'), 'utf8');
  const marks = [...(/CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(cfs)[1]).matchAll(/['"](.+?)['"]/g)].map(m => m[1]);
  check('no CLEARABLE_NOTE_MARK is a substring of either note', marks.length === 4 && marks.every(m => !NOTE.includes(m) && !NOTE_A.includes(m)));
  check('neither note carries the renderer isApplied / _neitherOnPage triggers',
        !/one character differs|doesn't appear on this page as written/.test(NOTE + NOTE_A));
}

console.log('3. S4 — an ACCEPTED suggestion writes a corrections row (the substrate confusion-precedence mines)');
{
  const db = freshDb();
  const id = Number(db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence)
                                VALUES (1,'b.pdf','/in','confirmed','Print Tracker',70)`).run().lastInsertRowid);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, corrected_to, validation_note)
              VALUES (?, 'reference_number', '1625802868', '1625802868', 70, 'anchor_crop_relocated', '1G25802868', ?)`).run(id, NOTE);
  // "Use 1G25802868" in Review = the renderer records { original_value: the displayed raw read, corrected_value: the proposal }
  learning.saveCorrections(db, id, { reference_number: { original_value: '1625802868', corrected_value: '1G25802868' } },
                           'Print Tracker', 'print_tracker', { supplier_name: 'Print Tracker', reference_number: '1G25802868' }, []);
  const rows = db.prepare("SELECT original_value, corrected_value FROM corrections WHERE document_id = ? AND field_key = 'reference_number'").all(id);
  check('exactly one corrections row: 1625802868 -> 1G25802868', rows.length === 1 && rows[0].original_value === '1625802868' && rows[0].corrected_value === '1G25802868');
  const g = learning.getFieldConfusions(db).find(x => x.field_key === 'reference_number');
  const f = g && g.confusions.find(x => x.len === 10 && x.pos === 1 && x.from === '6' && x.to === 'G');
  check('…which the 2a reducer sees as a (10,1,6->G) fact (support 1)', !!f && f.support_docs === 1);
  db.close();
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} ok)`);
process.exit(fail ? 1 : 0);
