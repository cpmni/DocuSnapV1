'use strict';
/*
 * test_duplicate_supplier_repair.js — Layer 6 of the teach-poisoning arc: repair what is ALREADY
 * in the database.
 *
 * WHY IT EXISTS. Every other fix in this arc is preventive, which leaves a customer whose filing
 * tree is already split with nothing telling them (Oracle O7). Two gaps closed here:
 *   1. NOTHING FOUND THE PAIR. `findDuplicateSupplierPairs` reports every pair of known sender
 *      scopes one or two characters apart, using the SAME `name_proximity` comparison as the
 *      teach-time challenge and the write guard — so all three agree about what "the same company,
 *      misread" means. Report-only: it never merges or renames.
 *   2. THE RENAME COULD NOT FINISH THE JOB. `renameSupplier` fixed six learning tables and left
 *      `template_fields.fixed_value` — the value STAMPED onto every future document of that layout
 *      — still saying the old name, so the rename would appear to work and then quietly undo
 *      itself on the next import.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_duplicate_supplier_repair.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const learning  = require('./learning');
const templates = require('./templates');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
const addDocs = (db, name, n, status = 'confirmed') => {
  const ins = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name) VALUES (?, 'C:/o', ?, ?)");
  for (let i = 0; i < n; i++) ins.run(`d${Math.random()}.pdf`, status, name);
};

console.log('\n1. finding the split');
{
  const db = freshDb();
  addDocs(db, 'Bramblewood Joinery Ltd', 38);
  addDocs(db, 'B8ramblewood Joinery Ltd', 12);
  addDocs(db, 'Oakhaven Electrical Wholesale', 20);
  const pairs = learning.findDuplicateSupplierPairs(db);
  check('the split pair is found', pairs.length === 1);
  check('the heavier side is offered as the likely-correct one',
        pairs[0].likelyCorrect === 'Bramblewood Joinery Ltd' && pairs[0].likelyCorrectDocs === 38);
  check('...with the other side and its weight, so the operator can judge',
        pairs[0].other === 'B8ramblewood Joinery Ltd' && pairs[0].otherDocs === 12);
  check('one character apart is reported as such', pairs[0].distance === 1);
  check('an unrelated company is not paired with anything',
        !pairs.some(p => /Oakhaven/.test(p.likelyCorrect + p.other)));
  db.close();
}
{
  // THE PIN THAT MADE THE DETECTOR STRICTER THAN THE WRITE GUARD. `Northgate`/`Southgate` is TWO
  // edits at similarity 0.889 — it passes name_proximity, which is correct for the guard's seam
  // (a declined overwrite) and WRONG here, where the words on screen are "look like duplicates"
  // and the offered action is a merge. Two real companies must never be paired.
  const db = freshDb();
  addDocs(db, 'Northgate Motors Ltd', 10);
  addDocs(db, 'Southgate Motors Ltd', 10);
  check('two genuinely different companies two characters apart are NOT reported',
        learning.findDuplicateSupplierPairs(db).length === 0);
  db.close();
}
{
  // ...but a TWO-character machine garble still is, when it carries the signature: a digit inside
  // an alphabetic token. That is the round-4 shape, and it is not something a real name does.
  const db = freshDb();
  addDocs(db, 'Bramblewood Joinery Ltd', 20);
  addDocs(db, 'B8rambl3wood Joinery Ltd', 4);
  const pairs = learning.findDuplicateSupplierPairs(db);
  check('a two-character garble WITH a digit inside a word is still reported',
        pairs.length === 1 && pairs[0].distance === 2);
  db.close();
}
{
  // A leading digit is ordinary in a real name and must not be read as the signature.
  const db = freshDb();
  addDocs(db, '3M United Kingdom plc', 10);
  addDocs(db, '3N United Kingdom plc', 10);   // 1 edit — reported on distance alone, correctly
  const pairs = learning.findDuplicateSupplierPairs(db);
  check('a leading digit is not the machine signature (the pair rides distance 1, not the digit arm)',
        pairs.length === 1 && pairs[0].distance === 1);
  db.close();
}
{
  const db = freshDb();
  addDocs(db, 'Bramblewood Joinery Ltd', 5);
  addDocs(db, 'B8ramblewood Joinery Ltd', 3, 'deleted');
  check('a binned scope is not offered as a live duplicate',
        learning.findDuplicateSupplierPairs(db).length === 0);
  db.close();
}
{
  const db = freshDb();
  check('an empty install reports nothing rather than throwing',
        learning.findDuplicateSupplierPairs(db).length === 0);
  db.close();
}

console.log('\n2. the rename now reaches the value that would undo it');
{
  const db = freshDb();
  addDocs(db, 'B8ramblewood Joinery Ltd', 12);
  const tid = templates.create(db, {
    name: 'B8ramblewood', document_type_slug: 'purchase_order',
    fields: [{ field_key: 'supplier_name', anchor_label: null, direction: 'right',
               fixed_value: 'B8ramblewood Joinery Ltd', is_variable: false }],
  });
  db.prepare("INSERT INTO supplier_hints (supplier_name, document_type, field_key, hint_value, usage_count) VALUES (?, 'purchase_order', 'vat_no', 'GB 512 8846 27', 4)")
    .run('B8ramblewood Joinery Ltd');

  const r = learning.renameSupplier(db, { oldName: 'B8ramblewood Joinery Ltd', newName: 'Bramblewood Joinery Ltd' });
  check('the rename runs', r.renamed === 1);
  check('documents move to the corrected name',
        db.prepare("SELECT COUNT(*) n FROM documents WHERE supplier_name = 'Bramblewood Joinery Ltd'").get().n === 12);
  check('the learning scope moves with them',
        db.prepare("SELECT COUNT(*) n FROM supplier_hints WHERE supplier_name = 'Bramblewood Joinery Ltd'").get().n === 1);
  check("the template's FROZEN identity moves too  ← the gap that made the rename undo itself",
        db.prepare("SELECT fixed_value FROM template_fields WHERE template_id = ? AND field_key = 'supplier_name'")
          .get(tid).fixed_value === 'Bramblewood Joinery Ltd');
  check('nothing is left under the old name',
        db.prepare("SELECT COUNT(*) n FROM template_fields WHERE fixed_value = 'B8ramblewood Joinery Ltd'").get().n === 0);
  db.close();
}
{
  // A frozen value for a DIFFERENT company must not be dragged along by someone else's rename.
  const db = freshDb();
  addDocs(db, 'Acme Ltd', 3);
  const other = templates.create(db, {
    name: 'Oakhaven', document_type_slug: 'delivery_note',
    fields: [{ field_key: 'supplier_name', anchor_label: null, direction: 'right',
               fixed_value: 'Oakhaven Electrical Wholesale', is_variable: false }],
  });
  learning.renameSupplier(db, { oldName: 'Acme Ltd', newName: 'Acme Holdings Ltd' });
  check("another company's frozen identity is untouched",
        db.prepare("SELECT fixed_value FROM template_fields WHERE template_id = ?").get(other).fixed_value
          === 'Oakhaven Electrical Wholesale');
  db.close();
}

console.log('\n3. what it deliberately does NOT do');
{
  const fs = require('fs');
  const sh = fs.readFileSync(path.join(REPO, 'src', 'modules', 'settings', 'handler.js'), 'utf8');
  check('the detector is admin-gated and report-only',
        /ipcMain\.handle\('find-duplicate-suppliers'[\s\S]{0,200}requireRole\('admin'\)/.test(sh)
        && /findDuplicateSupplierPairs\(getDb\(\)\)/.test(sh));
  check('the rename stays audited', /action: 'rename_supplier'/.test(sh));
  const html = fs.readFileSync(path.join(REPO, 'src', 'windows', 'settings', 'index.html'), 'utf8');
  check('the screen says files are NOT moved, rather than moving them silently',
        /Filed documents keep their files where they are/.test(html));
  check('the screen states that nothing changes by looking',
        /Nothing is changed by looking/.test(html));
  const rend = fs.readFileSync(path.join(REPO, 'src', 'windows', 'settings', 'renderer.js'), 'utf8');
  check('picking a pair only PREFILLS the audited rename, it never renames',
        /data-dupe-fix/.test(rend) && !/findDuplicateSuppliers[\s\S]{0,600}api\.renameSupplier/.test(rend));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
