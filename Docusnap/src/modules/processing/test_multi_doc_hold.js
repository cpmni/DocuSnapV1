'use strict';
/*
 * test_multi_doc_hold.js — G3, the load-bearing safety pin of the OPT-IN split feature (2026-09-21; gary → Oracle
 * SIGN-OFF-W/COND; docs/designs/OPTIN_SPLIT_2026-09-20.md).
 *
 * With auto-detect separation OFF (the opt-in default, mig 194), a whole scan that actually holds SEVERAL documents
 * lands as ONE document. A graduated supplier would then AUTO-FILE that merged bundle and it would never reach
 * Review — a silent wrong-file. The handler's multi-document hold closes it: when Python reports `multi_doc_suspect`
 * (a LATER page reads as a new document-start) on a multipage doc AND auto-split is OFF, the handler stamps
 * MULTI_DOC_HOLD_NOTE so the ONE predicate (isAutoFileEligible) refuses auto-file until a human confirms or splits.
 *
 * MUST-FAIL-ON-PRE-FIX (Oracle G3): §1's "held → isAutoFileEligible refuses" reproduces the silent-file bug —
 * delete the hold block and the note is never stamped, the doc is eligible, and §1 goes red. Scope pins (§3/§4)
 * stop a future dev widening it to a blanket page_count>1 hold (which would kill auto-file for legit 3-page
 * invoices / the 34-page contract — the max-auto-file rule).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/processing/test_multi_doc_hold.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require(path.join(REPO, 'database', 'index'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
const H = require('./handler.js');
const SP = require('./split_plan');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };
const read = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const db = new Database(':memory:');
quiet(() => runMigrations(db));
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req] of [['supplier_name', 1], ['invoice_number', 1], ['invoice_date', 1], ['total', 0]])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, 'text', ?, 1, 1)").run(k, k, req);
learning.setSetting(db, 'auto_file_threshold', '1');   // the laxest slider: only the note can refuse (graduated-supplier proxy)
const FOLDER = path.join(require('os').tmpdir(), 'sf-multi-doc-hold-pin');

const fileDone = (name, over = {}) => ({
  type: 'file_done', success: true, status: 'needs_review', needs_review: false, original_filename: name,
  overall_confidence: 100, document_type: 'Invoice', supplier_name: 'Acme Widgets', page_count: 3,
  extractions: {
    supplier_name:  { value: 'Acme Widgets', confidence: 100, method: 'logo' },
    invoice_number: { value: 'INV-100', confidence: 100, method: 'keyword' },
    invoice_date:   { value: '01-08-2026', confidence: 100, method: 'keyword' },
  }, ...over,
});
const noteOf = (id, k) => (db.prepare('SELECT validation_note FROM extractions WHERE document_id = ? AND field_key = ?').get(id, k) || {}).validation_note;
const doc = (id) => documents.getById(db, id);

(async () => {
  console.log('§1 auto-split OFF + a later-page doc-start → HELD from auto-file (the silent-file bug closed)');
  check("precondition: auto_separate_enabled defaults OFF (mig 194)", learning.getSetting(db, 'auto_separate_enabled', 'false') === 'false');
  const m1 = fileDone('bundle_A.pdf', { multi_doc_suspect: true });
  await H.handleFileMessage(db, m1, FOLDER, null, null, false, {});
  const id1 = m1.db_id;
  const n1 = noteOf(id1, 'invoice_number');
  check('the ref-role row carries the multi-document note', n1 === SP.MULTI_DOC_HOLD_NOTE, n1);
  const v1 = trust.isAutoFileEligible(db, doc(id1));
  check("isAutoFileEligible refuses it: 'flagged'", v1.eligible === false && trust.isFlaggedReason(v1.reason), JSON.stringify(v1));
  check('the File-All bypass does NOT lift it', !trust.autoFileEligibleIds(db, [doc(id1)], { bypassPutBack: true }).includes(id1));
  check('msg.needs_review was raised', m1.needs_review === true);

  console.log('\n§2 positive control: no second-document signal → NOT held, eligible (a single multipage invoice files)');
  const m2 = fileDone('invoice_3pg.pdf');   // multi_doc_suspect absent
  await H.handleFileMessage(db, m2, FOLDER, null, null, false, {});
  check('a 3-page doc with no later doc-start is untouched and eligible',
    !noteOf(m2.db_id, 'invoice_number') && trust.isAutoFileEligible(db, doc(m2.db_id)).eligible === true);

  console.log('\n§3 SCOPE: a single-page doc is never held even if the flag were set (guard: page_count > 1)');
  const m3 = fileDone('one_page.pdf', { multi_doc_suspect: true, page_count: 1 });
  await H.handleFileMessage(db, m3, FOLDER, null, null, false, {});
  check('page_count 1 + suspect → NOT held (eligible)',
    !noteOf(m3.db_id, 'invoice_number') && trust.isAutoFileEligible(db, doc(m3.db_id)).eligible === true);

  console.log('\n§4 GATING: auto-split ON → the pre-pass owns separation, the hold is inert (byte-identical, Oracle G1)');
  learning.setSetting(db, 'auto_separate_enabled', 'true');
  const m4 = fileDone('bundle_B.pdf', { multi_doc_suspect: true });
  await H.handleFileMessage(db, m4, FOLDER, null, null, false, {});
  check('auto_separate ON + suspect → NOT held here (eligible)',
    !noteOf(m4.db_id, 'invoice_number') && trust.isAutoFileEligible(db, doc(m4.db_id)).eligible === true);
  learning.setSetting(db, 'auto_separate_enabled', 'false');

  console.log('\n§5 source contract: the note is a PLAIN review note (a normal confirm clears it), not a lane-hold family member');
  check('MULTI_DOC_HOLD_NOTE does not end with the lane-hold "— confirm once." marker',
    !/—\s*confirm once\.\s*$/.test(SP.MULTI_DOC_HOLD_NOTE));
  check('MULTI_DOC_HOLD_NOTE mentions Split', /split/i.test(SP.MULTI_DOC_HOLD_NOTE));
  const RS = read(path.join(REPO, 'src', 'services', 'reviewService.js'));
  check('a human confirm clears every note (reviewService)', RS.includes('UPDATE extractions SET validation_note = NULL, corrected_to = NULL WHERE document_id = ?'));
  const H_SRC = read(path.join(__dirname, 'handler.js'));
  check('the hold is gated on multi_doc_suspect + page_count>1 + auto-split OFF',
    /msg\.multi_doc_suspect && Number\(msg\.page_count\) > 1\s*\n\s*&& learning\.getSetting\(db, 'auto_separate_enabled', 'false'\) !== 'true'/.test(H_SRC));

  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('PIN CRASHED:', e); process.exit(1); });
