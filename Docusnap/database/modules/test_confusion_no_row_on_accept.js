'use strict';
/*
 * test_confusion_no_row_on_accept.js — the A4 invariant of CONFUSION PRECEDENCE 2a (Oracle SIGN-OFF-W/COND
 * 2026-09-04): "an accepted arc pre-fill writes NO corrections row".
 *
 * Oracle SEAM 1 made the method-based reducer exclusion UNIMPLEMENTABLE (corrections has no method column;
 * the extractions.extraction_method join survives a human override, so it would tag a genuine counter-edit
 * as arc-backed and drop the self-heal). What actually keeps the fact table free of the arc's OWN output is
 * the Review renderer's dirty-check: a field is recorded in `corrections` ONLY when the input differs from
 * `data-original` (= the displayed, already-corrected value), and reviewService passes that object to
 * learning.saveCorrections verbatim. So: accept unedited => no row => support never counts a self-vote; a
 * human EDIT back to the original read writes the OPPOSITE fact => counter => the fact dies (self-heal).
 *
 * Three legs, all live-parsed / executed — a future "helpful" refactor that records every displayed value
 * as a correction would break the loop, and this file is what catches it.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_confusion_no_row_on_accept.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const learning = require('./learning');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. RENDERER — a correction is recorded only when the input DIFFERS from data-original (source pin)');
{
  const src = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  check('the field input carries data-original = the DISPLAYED value (the pre-filled correction, not the raw read)',
        /data-original="\$\{escHtml\(val\)\}"/.test(src));
  const i = src.indexOf("const orig = input.dataset.original;");
  const blk = i >= 0 ? src.slice(i, i + 400) : '';
  check('the input handler records corrections[key] ONLY inside `if (input.value !== orig)`',
        /if \(input\.value !== orig\) \{\s*corrections\[key\] = \{ original_value: orig, corrected_value: input\.value \};/.test(blk));
  check('…and DELETES the entry when the value is put back equal (no stale row on a round-trip edit)',
        /\} else \{\s*delete corrections\[key\];/.test(blk));
}

console.log('\n2. SERVICE — saveCorrections with an empty corrections object writes NO corrections row');
{
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1,'Print Tracker','print_tracker',0,'reference_number','date')").run();
  for (const [k, t] of [['supplier_name', 'text'], ['reference_number', 'reference'], ['date', 'date']])
    db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1,?,?,?,1,1)').run(k, k, t);
  const id = Number(db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence)
                                VALUES (1, 'a.pdf', '/in', 'confirmed', 'Print Tracker', 70)`).run().lastInsertRowid);
  // the arc's pre-fill row: display_value == corrected_to (the 2a shape), raw_value = the OCR read
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, was_corrected, corrected_to, validation_note)
              VALUES (?, 'reference_number', 'RFWO112233', 'RFW0112233', 70, 'template_mapping+confusion_resolved', 1, 'RFW0112233', 'note')`).run(id);
  const before = db.prepare('SELECT COUNT(*) c FROM corrections').get().c;
  learning.saveCorrections(db, id, {}, 'Print Tracker', 'print_tracker',
                           { supplier_name: 'Print Tracker', reference_number: 'RFW0112233' }, []);
  const after = db.prepare('SELECT COUNT(*) c FROM corrections').get().c;
  check('accept-unedited (corrections = {}) leaves the corrections table untouched', before === 0 && after === 0);
  check('…so the reducer sees NO fact from an accepted pre-fill', learning.getFieldConfusions(db).length === 0);
  // the self-heal: the human puts the ORIGINAL read back -> the OPPOSITE fact lands
  learning.saveCorrections(db, id, { reference_number: { original_value: 'RFW0112233', corrected_value: 'RFWO112233' } },
                           'Print Tracker', 'print_tracker', { supplier_name: 'Print Tracker', reference_number: 'RFWO112233' }, []);
  const g = learning.getFieldConfusions(db).find(x => x.field_key === 'reference_number');
  const rev = g && g.confusions.find(f => f.len === 10 && f.pos === 3 && f.from === '0' && f.to === 'O');
  check('a human edit BACK to the read writes the opposite (0->O) fact — the counter that kills the O->0 fact',
        !!rev && rev.support_docs === 1);
  db.close();
}

console.log('\n3. REDUCER — a no-op row (original == corrected) can never become a fact even if one were written');
{
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1,'Print Tracker','print_tracker',0)").run();
  const id = Number(db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence)
                                VALUES (1, 'b.pdf', '/in', 'confirmed', 'Print Tracker', 70)`).run().lastInsertRowid);
  db.prepare(`INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type)
              VALUES (?, 'reference_number', 'RFW0112233', 'RFW0112233', 'Print Tracker', 'print_tracker')`).run(id);
  check('original == corrected -> no fact', learning.getFieldConfusions(db).every(x => !(x.confusions || []).length));
  db.close();
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} ok)`);
process.exit(fail ? 1 : 0);
