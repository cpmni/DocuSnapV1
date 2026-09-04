'use strict';
/*
 * test_confusion_autofile_hold.js — CONFUSION PRECEDENCE 2a is REVIEW-BOUND by TWO independent gates
 * (Oracle SIGN-OFF-W/COND 2026-09-04, gary G5 + O2/O9-G4):
 *   1. the dedicated validation_note -> trust.isAutoFileEligible refuses 'flagged' at every floor;
 *   2. the <=70 cap vs the 88 CRITICAL_FIELD_FLOOR -> 'weak-critical-field:<ref>' even with the note gone.
 * The corrected_to half of the gate is NOT relied on: 2a writes NO corrected_to (O2 — the renderer's green
 * "auto-corrected" badge and the reprocess/batch-audit readers treat corrected_to/was_corrected as a HUMAN act).
 * Also pins: OFF => no format group carries `confusions`/`confusion_literals` (payload byte-identical);
 * `+confusion_resolved` is deliberately NOT a getFieldFormats exclusion marker (gary G4: the arc self-disarms —
 * an accepted pre-fill writes no row and its value enters value_counts); the note's MARK matches none of the
 * JS note-clearers; a 2a row can never render the "auto-corrected" badge (isApplied keys on corrected_to).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_confusion_autofile_hold.js
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
const NOTE = "Read as 'RFWO112233'; corrected to 'RFW0112233' because you made the same O→0 correction on 3 documents "
           + "from this sender — corrected from this sender's past corrections. This exact value has not been seen "
           + "before — please check it against the page before filing.";
const row2a = (over = {}) => ({ field_key: 'reference_number', display_value: 'RFW0112233', raw_value: 'RFWO112233',
                                confidence: 70, validation_note: NOTE, corrected_to: null, was_corrected: 0,
                                extraction_method: 'template_mapping+confusion_resolved', ...over });
const clean = (k, v, c = 96) => ({ field_key: k, display_value: v, raw_value: v, confidence: c, validation_note: null, corrected_to: null });

console.log('1. GATE 1 — the note holds the document at EVERY floor');
{
  const db = freshDb();
  const id = Number(db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence)
                                VALUES (1,'a.pdf','/in','needs_review','Print Tracker',100)`).run().lastInsertRowid);
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  const ex = [clean('supplier_name', 'Print Tracker'), row2a(), clean('date', '01-09-2026')];
  const r = trust.isAutoFileEligible(db, doc, { extractions: ex, gradOn: false, corrobAutoFile: false });
  check('overall 100, threshold 100: refused with reason "flagged" (the note)', r.eligible === false && r.reason === 'flagged');
  db.close();
}

console.log('2. GATE 2 — strip the note: the <=70 cap alone still refuses via the 88 critical floor');
{
  const db = freshDb();
  const id = Number(db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence)
                                VALUES (1,'b.pdf','/in','needs_review','Print Tracker',100)`).run().lastInsertRowid);
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  const ex = [clean('supplier_name', 'Print Tracker'), row2a({ validation_note: null }), clean('date', '01-09-2026')];
  const r = trust.isAutoFileEligible(db, doc, { extractions: ex, gradOn: false, corrobAutoFile: false, vacuousCorrectedToIgnore: true });
  check('note gone, no corrected_to, conf 70 < 88: refused "weak-critical-field:reference_number"',
        r.eligible === false && r.reason === 'weak-critical-field:reference_number');
  const ex2 = [clean('supplier_name', 'Print Tracker'), row2a({ validation_note: null, confidence: 95 }), clean('date', '01-09-2026')];
  const r2 = trust.isAutoFileEligible(db, doc, { extractions: ex2, gradOn: false, corrobAutoFile: false, vacuousCorrectedToIgnore: true });
  check('control: the same row at 95 with no note WOULD file — so the cap is a real, independent gate',
        r2.eligible === true);
  db.close();
}

console.log('3. PAYLOAD — OFF: no format group carries confusions / confusion_literals');
{
  const db = freshDb();
  // three confirmed docs + a correction each so a supplier group exists AND a fact exists
  for (let i = 0; i < 3; i++) {
    const id = Number(db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence, confirmed_at)
                                  VALUES (1,?,'/in','confirmed','Print Tracker',90,datetime('now'))`).run(`c${i}.pdf`).lastInsertRowid);
    const v = ['RFH0738865', 'RFC0508317', 'RFQ0111222'][i];
    db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, 'reference_number', ?, ?, 90, 'template_mapping')`).run(id, v.replace('0', 'O'), v);
    db.prepare(`INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?, 'reference_number', ?, ?, 'Print Tracker', 'print_tracker')`).run(id, v.replace('0', 'O'), v);
  }
  const handler = require(path.join(REPO, 'src', 'modules', 'processing', 'handler'));
  const cfg = () => path.join(REPO, 'config', 'keyword_patterns.json');
  const readFormats = (env) => {
    const saved = process.env.CONFUSION_PRECEDENCE;
    if (env === undefined) delete process.env.CONFUSION_PRECEDENCE; else process.env.CONFUSION_PRECEDENCE = env;
    const out = handler.buildTrainingArgs(db, cfg, null);
    const i = out.args.indexOf('--formats-file');
    const groups = JSON.parse(fs.readFileSync(out.args[i + 1], 'utf8'));
    for (const f of out.tempFiles || []) { try { fs.unlinkSync(f); } catch {} }
    if (saved === undefined) delete process.env.CONFUSION_PRECEDENCE; else process.env.CONFUSION_PRECEDENCE = saved;
    return groups;
  };
  const off = readFormats(undefined);
  check('OFF (setting unset, env unset): no group carries confusions or confusion_literals',
        off.length > 0 && off.every(g => !('confusions' in g) && !('confusion_literals' in g)));
  const on = readFormats('1');
  const g = on.find(x => x.supplier_name === 'Print Tracker' && x.field_key === 'reference_number');
  check('ON (env=1): the supplier group carries the fact + the literal union (never the "" twin)',
        !!g && Array.isArray(g.confusions) && g.confusions.length === 1 && Array.isArray(g.confusion_literals)
        && g.confusion_literals.includes('RFH0738865')
        && !on.some(x => (x.supplier_name || '') === '' && ('confusions' in x)));
  const explicitOff = readFormats('0');
  check('env=0 (explicit OFF arm) beats the setting: no confusions', explicitOff.every(x => !('confusions' in x)));
  db.close();
}

console.log('4. LEARNING — "+confusion_resolved" is deliberately NOT a getFieldFormats exclusion marker (gary G4)');
{
  const src = fs.readFileSync(path.join(REPO, 'database', 'modules', 'learning.js'), 'utf8');
  const i = src.indexOf('function getFieldFormats(');
  const body = src.slice(i, src.indexOf('function getFieldConfusions('));
  check('no "+confusion_resolved" clause in getFieldFormats — the arc self-disarms (accept writes no row; the '
        + 'confirmed value enters value_counts and the next identical read sits inside the ball, so 2a refuses)',
        !/confusion_resolved/.test(body));
}

console.log('5. RENDERER / CLEARERS — no green badge, no sweep');
{
  const r = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  check('the "auto-corrected" badge keys on a NON-EMPTY corrected_to equal to the value — a 2a row (corrected_to null) can never render it',
        /isApplied\s*=\s*!!correctedTo\s*&&\s*val\s*===\s*correctedTo/.test(r));
  const cfs = fs.readFileSync(path.join(REPO, 'src', 'services', 'classFixService.js'), 'utf8');
  const blk = /CLEARABLE_NOTE_MARKS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(cfs)[1];
  const marks = [...blk.matchAll(/['"](.+?)['"]/g)].map(m => m[1]);
  check('parsed the JS clearable marks', marks.length === 4);
  check('no CLEARABLE_NOTE_MARK is a substring of the 2a note', marks.every(m => !NOTE.includes(m)));
  check('the 2a note is not an isBrandingFlag match', !/page branding reads|confirm the correct company/i.test(NOTE));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} ok)`);
process.exit(fail ? 1 : 0);
