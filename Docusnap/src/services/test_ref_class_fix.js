'use strict';
/*
 * test_ref_class_fix.js — PINs for the human-licensed class correction.
 * (reggie + gary design → Oracle SIGN-OFF-WITH-CONDITIONS, 8 blocking, 2026-08-19.
 *  DARK behind `ref_class_fix_enabled` / REF_CLASS_FIX.)
 *
 * WHY IT EXISTS. Round 9 left 15 of 40 Pelican invoice numbers reading P1/ or PL/ where the page
 * prints PI/ — all caught, none misfiled, but 15 typed corrections, and correcting one did nothing
 * for the next. The owner's instruction: "after ONE click to confirm, the system updates the other
 * documents automatically… there is no need for a second dialog."
 *
 * FIVE OF THESE PINS WERE WRITTEN TO FAIL against the design as first drafted — that is how Oracle
 * distinguished a real condition from a restatement. They are marked (WAS RED).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/services/test_ref_class_fix.js
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const REPO = path.resolve(__dirname, '..', '..');

const rcf = require('./refClassFix');
const cfs = require('./classFixService');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

// ── 1. deriveClassFix / applyClassFix — the narrow rule ─────────────────────────────────────────
console.log('the narrow rule: one confusable glyph, inside the code prefix, suffix untouched');

const R = rcf.deriveClassFix('P1/26/3130', 'PI/26/3130');
check('the exhibit is licensed: P1/26/3130 → PI/26/3130', !!R && R.fromHead === 'P1' && R.toHead === 'PI');
check('head length is measured on the CORRECTED value — the whole class depends on it '
      + '(P1 has no extractable prefix; PI does, and measuring the wrong side kills every case)',
      R.headLen === 2 && rcf.codePrefixLen('P1/26/3130') === 0 && rcf.codePrefixLen('PI/26/3130') === 2);

check('the SAME substitution reaches a sibling with a different suffix',
      rcf.applyClassFix('P1/26/9999', R) === 'PI/26/9999');
check('THE NARROW RULE: correcting a P1 does NOT license rewriting a PL '
      + '(each wrong form needs its own human licence — measured cost: two corrections, not twelve)',
      rcf.applyClassFix('PL/26/9999', R) === null);
check('a different sender-shaped value is untouched', rcf.applyClassFix('QQ/26/9999', R) === null);
check('idempotent — a value already correct is left alone (so a double-run is harmless)',
      rcf.applyClassFix('PI/26/9999', R) === null);

check('THE NEGATIVE CONTROL from the round-9 corpus: P1L/26/3152 is two glyphs wrong, so no '
      + 'single-substitution rule may ever touch it', rcf.applyClassFix('P1L/26/3152', R) === null);
check('...and it cannot be licensed as a rule either',
      rcf.deriveClassFix('P1L/26/3152', 'PI/26/3152') === null);

check('refuse: two characters changed', rcf.deriveClassFix('P1/26/3130', 'PI/26/3131') === null);
check('refuse: a non-confusable pair (X↔I)', rcf.deriveClassFix('PX/26/3130', 'PI/26/3130') === null);
check('refuse: the change is in the SUFFIX, not the code prefix',
      rcf.deriveClassFix('PI/26/3130', 'PI/26/3l30') === null);
check('refuse: different lengths (a re-key, not a class fix)',
      rcf.deriveClassFix('PI/26/313', 'PI/26/3130') === null);
check('refuse: the corrected value has no code prefix at all (a name, or a digit-leading serial)',
      rcf.deriveClassFix('l2345', 'i2345') === null);
check('refuse: a case change is a different edit and gets no licence here',
      rcf.deriveClassFix('pi/26/3130', 'PI/26/3130') === null);
check('the separators stay out of every class (a printed separator is structure — standing rule)',
      !rcf.sameClass('/', '\\') && !rcf.sameClass('-', '/'));
check('a sibling whose suffix would change the head\'s length is refused by the round trip',
      rcf.applyClassFix('P1X/26/1', rcf.deriveClassFix('P1/26/3130', 'PI/26/3130')) === null);

// ── 2. cross-language: the confusable table and the page witness ────────────────────────────────
console.log('\ncross-language pins (a widening on one side alone must go red)');
const engSrc = fs.readFileSync(path.join(REPO, 'python_backend', 'extraction', 'engine.py'), 'utf8');
const pyTable = (() => {
  const m = /_PREFIX_CONFUSE_CLASSES = \(([\s\S]*?)\n\)/.exec(engSrc);
  return m ? Array.from(m[1].matchAll(/frozenset\("([^"]*)"\)/g)).map(x => x[1]) : [];
})();
check('the Python table was located', pyTable.length === 9);
check('the JS confusable table is byte-identical to the engine\'s',
      JSON.stringify(pyTable.map(s => s.split('').sort().join('')))
      === JSON.stringify(rcf.CONFUSE_CLASSES.map(s => Array.from(s).sort().join(''))));

check('pageCarriesSepless sees a same-line 2-token join (the retokenisation it exists for)',
      rcf.pageCarriesSepless('Invoice No: PI/26 /3130\nTotal 12', 'PI/26/3130'));
check('...but never a CROSS-LINE join (manufactured adjacency)',
      !rcf.pageCarriesSepless('Invoice No: PI/26\n/3130 Total', 'PI/26/3130'));
check('THE CIRCULARITY PIN: a page carrying only the MISREAD does not witness the correction — '
      + 'this is leg 1 of page-match v2 and must never become leg 2, or the misread witnesses '
      + 'its own correction', !rcf.pageCarriesSepless('Invoice No: P1/26/3130', 'PI/26/3130'));
check('short values are not judged (the same >=4 bar as the Python side)',
      !rcf.pageCarriesSepless('ref PI1 here', 'PI1'));

// ── 3. the shared both-forms predicate, over the shared corpus ──────────────────────────────────
console.log('\nboth-forms established — the SAME question, asked by two callers (WAS RED: the two '
            + 'sides were not over the same keys)');
const corpus = JSON.parse(fs.readFileSync(
  path.join(REPO, 'python_backend', 'tests', 'both_forms_corpus.json'), 'utf8'));
for (const c of corpus.cases) {
  check(`${c.name} -> ${c.expected}`, rcf.bothFormsEstablished(c.counts, c.head) === c.expected);
}
check('the fixture still carries the mixed-case row (without it a case-sensitive divergence greens)',
      corpus.cases.some(c => c.name.startsWith('mixed_case_head')));
check('the fixture still carries the separator-variant row',
      corpus.cases.some(c => c.name.startsWith('separator_variant')));
check('the separator variant is counted by VALUE, not by key spelling: three differently-punctuated '
      + 'SB rows are four sightings, not two',
      rcf.bothFormsEstablished({ 'SB ORD 7 4238': 2, 'SB-ORD74239': 1, 'SBORD74240': 1 }, 'SB'));

// ── 4. the write path, against a real migrated database ─────────────────────────────────────────
console.log('\nthe write path (a real DB, real migrations, real trust/learning readers)');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const db = new Database(':memory:');
runMigrations(db);          // runs the SQL schema AND the JS migrations, including 74's seed
db.prepare("INSERT OR IGNORE INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) "
           + "VALUES (1,'Invoice','invoice',1,'invoice_number','invoice_date')").run();
for (const [k, t] of [['supplier_name', 'text'], ['invoice_number', 'reference_code'], ['invoice_date', 'date']])
  db.prepare('INSERT OR IGNORE INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1,?,?,?,1,1)').run(k, k, t);
// The audit sink is an ARRAY, not the audit_log table: this pin is about WHAT the trail records,
// and coupling it to that table's evolving schema would make it fail for unrelated reasons.
const auditRows = [];

const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const trust    = require(path.join(REPO, 'database', 'modules', 'trust.js'));

const typeId = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get().id;
const mkDoc = (id, sup, ref, opts = {}) => {
  db.prepare(`INSERT INTO documents (id, document_type_id, original_filename, folder_path, stored_filename,
              status, supplier_name, overall_confidence, ocr_text, workflow_status)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, typeId, `doc${id}.pdf`, '/in', `doc${id}.pdf`, opts.status || 'needs_review', sup, 92,
         opts.page || '', opts.workflow || null);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence,
              extraction_method, validation_note, corrected_to)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, 'invoice_number', ref, ref, 84, opts.method || 'template_mapping',
         opts.note || null, opts.correctedTo || null);
};

const SUP = 'Pelican Office Interiors';
mkDoc(1, SUP, 'P1/26/3130');                                                    // the one corrected
mkDoc(2, SUP, 'P1/26/9001', { page: 'Invoice No: PI/26/9001\n' });              // witnessed
mkDoc(3, SUP, 'P1/26/9002', { note: "'P1/26/9002' doesn't appear on this page as written — please check the reference before filing.",
                              page: 'Invoice No: PI/26/9002\n' });              // witnessed + clearable note
mkDoc(4, SUP, 'P1/26/9003', { note: 'This value looks unlike the shape this sender usually uses.' });  // note NOT clearable
mkDoc(5, SUP, 'PL/26/9004');                                                    // the other wrong form
mkDoc(6, SUP, 'P1/26/9005', { status: 'confirmed' });                           // already filed
mkDoc(7, 'Someone Else', 'P1/26/9006');                                         // another sender
mkDoc(8, SUP, 'P1/26/9007', { workflow: 'pending' });                           // workflow-locked

const dtInfo = require(path.join(REPO, 'database', 'modules', 'document_types.js'))
  .getWithFields(db, 'invoice');
const args = () => ({
  documentId: 1, supplierName: SUP, typeSlug: 'invoice', dtInfo, actorName: 'tester',
  learning, audit: (_d, e) => auditRows.push(e),
  corrections: { invoice_number: { original_value: 'P1/26/3130', corrected_value: 'PI/26/3130' } },
});
const valOf = id => db.prepare("SELECT display_value FROM extractions WHERE document_id=? AND field_key='invoice_number'").get(id).display_value;
const rowOf = id => db.prepare("SELECT * FROM extractions WHERE document_id=? AND field_key='invoice_number'").get(id);

cfs._reset();
process.env.REF_CLASS_FIX = '0';
check('OFF: nothing is read and nothing is written', cfs.applyForConfirm(db, args()) === null
      && valOf(2) === 'P1/26/9001');

process.env.REF_CLASS_FIX = '1';
cfs._reset();
const res = cfs.applyForConfirm(db, args());
check('the batch reaches exactly the byte-matching QUEUED siblings of this sender',
      !!res && res.docs.map(d => d.id).join(',') === '2,3,4');
check('the OTHER wrong form (PL) is untouched — the narrow rule, end to end', valOf(5) === 'PL/26/9004');
check('an already-FILED document is never touched', valOf(6) === 'P1/26/9005');
check('another sender is never touched', valOf(7) === 'P1/26/9006');
check('a workflow-locked document is never touched', valOf(8) === 'P1/26/9007');
check('the source document is never rewritten by its own correction', valOf(1) === 'P1/26/3130');
check('values were written', valOf(2) === 'PI/26/9001' && valOf(3) === 'PI/26/9002' && valOf(4) === 'PI/26/9003');

console.log('\nC1 — the badge is the METHOD MARKER, never corrected_to (WAS RED)');
check('the marker is on every touched row', [2, 3, 4].every(id => rowOf(id).extraction_method.endsWith('+prefix_class_fix')));
check('raw_value is UNTOUCHED — the forensic original and the undo source',
      rowOf(2).raw_value === 'P1/26/9001');
check('corrected_to is NOT written: trust.js counts a non-empty corrected_to as flagged unless a '
      + 'USER-VISIBLE toggle is on, so the feature would hold its own documents shut',
      [2, 3, 4].every(id => !rowOf(id).corrected_to));
check('was_corrected stays 0 — a human never opened these documents',
      [2, 3, 4].every(id => !rowOf(id).was_corrected));
// Exercise the COUNTING RULE trust applies, not the whole gate: a full isAutoFileEligible call on
// a fixture document short-circuits on an earlier reason ('no-type') and would pass whatever the
// columns said — vacuous. This runs the exact SQL from trust.js's vacuousIgnore=false branch, which
// is the branch a user can reach by turning one visible setting off.
db.prepare("UPDATE settings SET value='false' WHERE key='vacuous_corrected_to_ignore'").run();
const flaggedCount = id => db.prepare(
  "SELECT COUNT(*) c FROM extractions WHERE document_id = ? AND ((validation_note IS NOT NULL AND "
  + "TRIM(validation_note) <> '') OR (corrected_to IS NOT NULL AND TRIM(corrected_to) <> ''))").get(id).c;
check('with `vacuous_corrected_to_ignore` OFF — a real, user-visible setting — a propagated sibling '
      + 'is STILL not counted as flagged. Writing corrected_to would have made every fixed document '
      + 'permanently ineligible the moment somebody turned that switch off',
      flaggedCount(2) === 0);
check('...and the one that legitimately kept a note is still counted, so the check above is not '
      + 'passing because nothing counts', flaggedCount(4) === 1);

console.log('\nC4 — Tier 2: the value travels; the blocking note only lifts where the page agrees');
check('a witnessed document with a CLEARABLE note that names the old value has it cleared',
      rowOf(3).validation_note === null);
check('a witnessed document whose note is NOT in the enumerated classes keeps a note that still '
      + 'holds — "the value is on the page" does not answer a shape warning',
      !!rowOf(4).validation_note && rowOf(4).validation_note.includes('PI/26/9003'));
check('a document with no note gains none', rowOf(2).validation_note === null);
check('the clearable set is hoisted and matches its Python write sites',
      cfs.CLEARABLE_NOTE_MARKS.every(m => engSrc.includes(m)
        || fs.readFileSync(path.join(REPO, 'python_backend', 'extraction', 'template_mapper.py'), 'utf8').includes(m)));

console.log('\nC8 + undo');
const aud = auditRows.filter(r => r.action === 'class_fix_applied');
check('the consent trail exists, naming the scope, the substitution and every document',
      aud.length === 1 && aud[0].metadata.doc_ids === '2,3,4'
      && aud[0].metadata.from === 'P1' && aud[0].metadata.to === 'PI'
      && aud[0].metadata.scope === 'Pelican Office Interiors|invoice');
db.prepare("UPDATE documents SET status='confirmed' WHERE id=4").run();   // filed between fix and undo
db.prepare("UPDATE extractions SET display_value='typed by hand' WHERE document_id=3").run();
const un = cfs.undoBatch(db, res.batchId, { audit: () => {} });
check('undo restores only what still carries the marker AND still holds what we wrote',
      un.ok && un.restored === 1 && un.skipped === 2 && valOf(2) === 'P1/26/9001');
check('...a document FILED in the meantime is refused (reverting would desync it from the '
      + 'filename and XML already on disk)', valOf(4) === 'PI/26/9003');
check('...and an operator edit since is left alone', valOf(3) === 'typed by hand');
check('a batch cannot be undone twice', cfs.undoBatch(db, res.batchId, {}).ok === false);

console.log('\nC2 — a class-fixed row is not evidence for the class fix (WAS RED without the carve-out)');
db.prepare("UPDATE settings SET value='true' WHERE key='format_corrections_dedupe'").run();
const grpFor = () => (learning.getFieldFormats(db) || []).find(x =>
  x.field_key === 'invoice_number' && String(x.supplier_name).toLowerCase().includes('pelican'));
const countFor = v => { const g = grpFor(); return g ? (g.value_counts || {})[v] || 0 : 0; };
// A learned-format group is only EMITTED once it has >=3 contributing documents, so a count of 0
// proves nothing until the group exists. (My first draft of this pin asserted the count with two
// documents present and greened against an absent group — the vacuous-pin trap, caught here.)
for (const [i, v] of [[40, 'PI/26/7001'], [41, 'PI/26/7002'], [42, 'PI/26/7003']])
  mkDoc(i, SUP, v, { status: 'confirmed' });
check('precondition: the learned-format group EXISTS and is counting (so a 0 below means excluded, '
      + 'not absent)', !!grpFor() && countFor('PI/26/7001') === 1);
db.prepare("UPDATE documents SET status='confirmed' WHERE id=2").run();
db.prepare("UPDATE extractions SET display_value='PI/26/9001', extraction_method='template_mapping+prefix_class_fix' WHERE document_id=2").run();
check('a confirmed class-fixed row is NOT counted — assert the COUNT, not string absence '
      + '(one click must not manufacture 25 votes for its own premise: the B7 loop)',
      countFor('PI/26/9001') === 0);
db.prepare('INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?,?,?,?,?,?)')
  .run(2, 'invoice_number', 'PI/26/9001', 'PI/26/9001', SUP, 'invoice');
check('...but a HUMAN correction re-admits it. updateExtractionValue never rewrites the method, so '
      + 'without this the row would be excluded for the life of the install — fighting the very '
      + 'feature that exists to get approved values INTO the corpus', countFor('PI/26/9001') === 1);

console.log('\nC6 — the ask fires only when both forms are established, once, and is remembered');
cfs._reset();
db.prepare("UPDATE documents SET status='needs_review' WHERE id IN (2,3,4)").run();
db.prepare("DELETE FROM corrections WHERE document_id=2").run();
db.prepare("UPDATE extractions SET display_value='P1/26/9001', extraction_method='template_mapping' WHERE document_id=2").run();
db.prepare("UPDATE extractions SET display_value='P1/26/9002' WHERE document_id=3").run();
db.prepare("UPDATE extractions SET display_value='P1/26/9003' WHERE document_id=4").run();
// three confirmed P1 rows in-scope = the owner's mature-install shape
for (const [i, v] of [[20, 'P1261792'], [21, 'P1263711'], [22, 'P1264000']]) {
  mkDoc(i, SUP, v, { status: 'confirmed' });
}
for (const [i, v] of [[30, 'PI/25/8496'], [31, 'PI/26/1001'], [32, 'PI/26/1002'],
                      [33, 'PI/26/1003'], [34, 'PI/26/1004']]) mkDoc(i, SUP, v, { status: 'confirmed' });
const asked = cfs.applyForConfirm(db, args());
check('both forms established → ASK, naming the documents and their current values, writing nothing',
      !!asked && asked.ask === true && asked.candidates.length === 3 && valOf(2) === 'P1/26/9001');
check('answering NO writes nothing and is remembered',
      cfs.resolveAsk(db, { ...args(), askKey: asked.askKey, yes: false }) === null
      && valOf(2) === 'P1/26/9001');
check('...so the NEXT correction of the same class is SILENT — the second dialog the owner banned',
      cfs.applyForConfirm(db, args()) === null);
cfs._reset();
const asked2 = cfs.applyForConfirm(db, args());
const yes = cfs.resolveAsk(db, { ...args(), askKey: asked2.askKey, yes: true });
check('answering YES applies the batch', !!yes && yes.docs.length === 3 && valOf(2) === 'PI/26/9001');
check('...and is also remembered, so the next one applies without asking again',
      (() => { db.prepare("UPDATE extractions SET display_value='P1/26/9500' WHERE document_id=4").run();
               const r2 = cfs.applyForConfirm(db, args());
               return !!r2 && !r2.ask && valOf(4) === 'PI/26/9500'; })());

// ── 4b. S1-C3 — machine evidence must count on the REFUSAL side ─────────────────────────────────
// Oracle 2026-08-19, and this one is a SAFETY hole rather than a missed reward. The default-ON
// `learning_exclude_machine_confirms` hides every auto-filed and swept document from `value_counts`
// — 89.9% of the corpus on the round-9 database. Starved of it, `bothFormsEstablished` answers
// false, the one-time ask never fires, and up to 25 references are rewritten class-wide on evidence
// the app is holding and cannot see. Asking is the conservative branch, so the refusal side must
// see everything. WAS RED before the union was added.
console.log('\nS1-C3 — the ask must see MACHINE-confirmed history too (asking is the safe branch)');
{
  cfs._reset();
  const d = mkCorpus();
  // Five human PI confirms, and THREE P1 confirms that were auto-filed — the mature-install shape.
  for (const [i, v] of [[60, 'PI/25/8496'], [61, 'PI/26/1001'], [62, 'PI/26/1002'],
                        [63, 'PI/26/1003'], [64, 'PI/26/1004']]) {
    d.prepare(`INSERT INTO documents (id, document_type_id, original_filename, folder_path, status,
                supplier_name, overall_confidence) VALUES (?,1,?,'/in','confirmed',?,92)`).run(i, `c${i}.pdf`, SUP);
    d.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence,
                extraction_method) VALUES (?,'invoice_number',?,?,92,'template_mapping')`).run(i, v, v);
  }
  for (const [i, v] of [[70, 'P1261792'], [71, 'P1263711'], [72, 'P1264000']]) {
    d.prepare(`INSERT INTO documents (id, document_type_id, original_filename, folder_path, status,
                supplier_name, overall_confidence, confirmed_via)
                VALUES (?,1,?,'/in','confirmed',?,92,'auto_threshold')`).run(i, `m${i}.pdf`, SUP);
    d.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence,
                extraction_method) VALUES (?,'invoice_number',?,?,92,'template_mapping')`).run(i, v, v);
  }
  d.prepare("INSERT INTO settings (key,value) VALUES ('learning_exclude_machine_confirms','true') "
            + 'ON CONFLICT(key) DO UPDATE SET value=excluded.value').run();
  const g = (learning.getFieldFormats(d) || []).find(x => x.field_key === 'invoice_number'
    && String(x.supplier_name).toLowerCase().includes('pelican'));
  check('precondition: the exclusion really does hide the machine P1 rows from value_counts',
        !!g && Object.keys(g.value_counts).every(v => v.startsWith('PI'))
        && Object.keys(g.machine_value_counts || {}).length === 3);
  check('...and the starved view alone would answer "not established" — i.e. would NOT ask',
        rcf.bothFormsEstablished(g.value_counts, 'P1') === false);
  process.env.REF_CLASS_FIX = '1';
  const r = cfs.applyForConfirm(d, {
    documentId: 1, supplierName: SUP, typeSlug: 'invoice', dtInfo, actorName: 'tester',
    learning, audit: () => {},
    corrections: { invoice_number: { original_value: 'P1/26/801', corrected_value: 'PI/26/801' } },
  });
  check('WITH the machine channel unioned in, the app ASKS instead of silently rewriting',
        !!r && r.ask === true);
  d.close();
}

// ── 5. C3 — the reprocess guard, at the line that actually reverts ──────────────────────────────
console.log('\nC3 — a reprocess must not silently revert the fix (WAS RED)');
const { _mergeReprocessRows } = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
const exRow = { field_key: 'invoice_number', raw_value: 'P1/26/9001', display_value: 'PI/26/9001',
                extraction_method: 'template_mapping+prefix_class_fix', corrected_to: null, validation_note: null };
const same = _mergeReprocessRows([exRow], [{ field_key: 'invoice_number', display_value: 'P1/26/9001',
                                             extraction_method: 'template_mapping', confidence: 84 }]);
check('the page still reads the same way → the human\'s answer survives, marker intact',
      same[0].display_value === 'PI/26/9001' && same[0].extraction_method.endsWith('+prefix_class_fix'));
const moved = _mergeReprocessRows([exRow], [{ field_key: 'invoice_number', display_value: 'PX/26/7777',
                                              extraction_method: 'template_mapping', confidence: 90 }]);
check('the page now says something NEW → it outranks a propagated guess, and the marker is DROPPED '
      + '(so learning re-admits the row and the undo correctly refuses)',
      moved[0].display_value === 'PX/26/7777' && !String(moved[0].extraction_method).includes('+prefix_class_fix'));
const plain = _mergeReprocessRows([{ field_key: 'invoice_number', raw_value: 'A', display_value: 'A',
                                     extraction_method: 'template_mapping' }],
                                  [{ field_key: 'invoice_number', display_value: 'B', extraction_method: 'template_mapping' }]);
check('an ordinary row is unaffected — OFF is byte-identical here too', plain[0].display_value === 'B');

// CHRIS ROUND 10, CARD 6. The fresh note is computed against the read we discard, so it can NAME
// that read. He found "'PL/26/6000' doesn't appear on this page as written" on a row displaying
// PI/26/6000 — a sentence that quotes a value the operator cannot see and judges a value that is no
// longer there. The note must follow the value, and the hold must survive.
const noted = _mergeReprocessRows(
  [{ field_key: 'invoice_number', raw_value: 'PL/26/6000', display_value: 'PI/26/6000',
     extraction_method: 'template_mapping+prefix_class_fix' }],
  [{ field_key: 'invoice_number', display_value: 'PL/26/6000', extraction_method: 'template_mapping',
     validation_note: "'PL/26/6000' doesn't appear on this page as written — please check the reference before filing." }]);
check('a fresh note naming the DISCARDED read is re-pointed at the value actually kept',
      noted[0].display_value === 'PI/26/6000'
      && !noted[0].validation_note.includes('PL/26/6000')
      && noted[0].validation_note.includes('PI/26/6000'));
check('...and the HOLD survives — nothing re-verified this page, so the document still waits',
      !!String(noted[0].validation_note || '').trim());
const other = _mergeReprocessRows(
  [{ field_key: 'invoice_number', raw_value: 'PL/26/6000', display_value: 'PI/26/6000',
     extraction_method: 'template_mapping+prefix_class_fix' }],
  [{ field_key: 'invoice_number', display_value: 'PL/26/6000', extraction_method: 'template_mapping',
     validation_note: 'This value looks unlike the shape this sender usually uses.' }]);
check('a note about ANYTHING ELSE is left exactly as the engine wrote it',
      other[0].validation_note === 'This value looks unlike the shape this sender usually uses.');

// ── 6. placement + guards (source inspection) ───────────────────────────────────────────────────
console.log('\nC7 — placement and the guards that must not be borrowed from elsewhere');
const rsSrc = fs.readFileSync(path.join(REPO, 'src', 'services', 'reviewService.js'), 'utf8');
const hookAt = rsSrc.indexOf("require('./classFixService').applyForConfirm");
check('the hook exists and is the LAST effect before confirm returns',
      hookAt > 0 && hookAt > rsSrc.indexOf('persistConfirmedValues(db')
      && hookAt < rsSrc.indexOf('return { ok: true, success: true, ...filingResult'));
check('it carries its OWN !_via check rather than leaning on the one that closes at :281',
      /if \(!_via && !bulk && dtInfo\) \{/.test(rsSrc));
check('!bulk — File All iterates confirms, and a propagation mid-loop would rewrite siblings the '
      + 'loop has already read into memory', /!_via && !bulk/.test(rsSrc));
const cfSrc = fs.readFileSync(path.join(__dirname, 'classFixService.js'), 'utf8');
check('every write statement carries document_id <> the source document',
      /document_id = @id AND document_id <> @src/.test(cfSrc));
check('the cap is stated once and is the sweep\'s', cfs.CAP === 25);
check('presence and workflow filters mirror the sweep', /NOT IN \('pending', 'claimed'\)/.test(cfSrc)
      && /presence\.viewers\(r\.id\)\.length/.test(cfSrc));
check('the identity field can never be reached: the field is ALWAYS the type\'s ref role, bound '
      + 'once and passed as a parameter — there is no other field_key anywhere in the service',
      /const refKey = dtInfo && dtInfo\.ref_field_key/.test(cfSrc)
      && (cfSrc.match(/field_key\s*=\s*@?refKey/g) || []).length >= 3
      && !/field_key\s*=\s*'(?!.*refKey)/.test(cfSrc)
      && !/'supplier_name'/.test(cfSrc));
check('the service is dark unless the setting or env says otherwise',
      /getSetting\(db, 'ref_class_fix_enabled', 'false'\)/.test(cfSrc));
check('migration 74 seeds it OFF',
      /ins.*ref_class_fix_enabled', 'false'|run\('ref_class_fix_enabled', 'false'\)/
        .test(fs.readFileSync(path.join(REPO, 'database', 'index.js'), 'utf8')));

try { db.close(); } catch {}

// ── 7. OFF == ON, byte-identical (Oracle gate item 2) ───────────────────────────────────────────
// The realdoc corpus arm is VACUOUS for this feature — it writes at CONFIRM, not at extraction, so
// a fresh-extraction harness cannot observe it either way. This is the replacement: hash the WHOLE
// database after a run of confirms and require the hashes to match. Two arms, because "inert" has
// two halves that fail differently:
//   A. flag ON, no qualifying correction  — the common case. Every ordinary confirm must be
//      untouched, or the feature is a tax on the 99% of edits that are not class fixes.
//   B. flag OFF, a qualifying correction  — the kill switch. If this one ever diverges, the switch
//      does not switch anything off and the whole DARK-by-default posture is a fiction.
console.log('\nOFF == ON — the identity proof that replaces the vacuous realdoc arm');
const crypto = require('crypto');

function mkCorpus() {
  const d = new Database(':memory:');
  runMigrations(d);
  d.prepare("INSERT OR IGNORE INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) "
            + "VALUES (1,'Invoice','invoice',1,'invoice_number','invoice_date')").run();
  for (const [k, t] of [['supplier_name', 'text'], ['invoice_number', 'reference_code'], ['invoice_date', 'date']])
    d.prepare('INSERT OR IGNORE INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1,?,?,?,1,1)').run(k, k, t);
  for (let i = 1; i <= 12; i++) {
    d.prepare(`INSERT INTO documents (id, document_type_id, original_filename, folder_path, status,
                supplier_name, overall_confidence, ocr_text) VALUES (?,1,?,'/in','needs_review',?,92,?)`)
      .run(i, `d${i}.pdf`, i % 3 === 0 ? 'Oakhaven Timber' : SUP, `Invoice No: P1/26/80${i}\n`);
    d.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence,
                extraction_method) VALUES (?,'invoice_number',?,?,84,'template_mapping')`)
      .run(i, `P1/26/80${i}`, `P1/26/80${i}`);
  }
  return d;
}
// Hash every row of every table the feature could possibly touch, in a stable order.
function hashDb(d) {
  const h = crypto.createHash('md5');
  for (const t of ['documents', 'extractions', 'corrections', 'settings', 'supplier_hints', 'field_anchors']) {
    let rows = [];
    try { rows = d.prepare(`SELECT * FROM ${t}`).all(); } catch { /* table may not exist */ }
    h.update(t + JSON.stringify(rows.map(r => Object.keys(r).sort().map(k => `${k}=${r[k]}`).join('|')).sort()));
  }
  return h.digest('hex');
}
const runOnce = (d, on, corrected) => {
  cfs._reset();
  process.env.REF_CLASS_FIX = on ? '1' : '0';
  for (let i = 1; i <= 12; i++) {
    cfs.applyForConfirm(d, {
      documentId: i, supplierName: i % 3 === 0 ? 'Oakhaven Timber' : SUP, typeSlug: 'invoice',
      dtInfo, actorName: 'tester', learning, audit: () => {},
      corrections: corrected
        ? { invoice_number: { original_value: `P1/26/80${i}`, corrected_value: `PI/26/80${i}` } }
        // Ordinary edits: a date, an issuer, and a reference re-keyed wholesale — none is a class fix.
        : { invoice_date: { original_value: '01-01-2026', corrected_value: '02-01-2026' },
            supplier_name: { original_value: 'Pelicn', corrected_value: SUP },
            invoice_number: { original_value: `P1/26/80${i}`, corrected_value: `ZZ-${i}-9999` } },
    });
  }
  return hashDb(d);
};
{
  const a = mkCorpus(), b = mkCorpus();
  check('ARM A — flag ON with no qualifying correction is byte-identical to flag OFF '
        + '(an ordinary confirm never notices this feature exists)',
        runOnce(a, false, false) === runOnce(b, true, false));
  a.close(); b.close();
}
{
  const a = mkCorpus(), b = mkCorpus();
  const offHash = runOnce(a, false, true);
  const onHash  = runOnce(b, true, true);
  check('ARM B — flag OFF with a QUALIFYING correction is byte-identical to a no-op run '
        + '(the kill switch really is a kill switch)', offHash === hashDb(mkCorpus()));
  check('...and the same input with the flag ON genuinely DIFFERS — so arm B is not passing '
        + 'because the fixture can never trigger anything', onHash !== offHash);
  a.close(); b.close();
}

delete process.env.REF_CLASS_FIX;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
