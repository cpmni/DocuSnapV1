#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_taught_label_keyword.js
 * ---------------------------------------------
 * Pins the store half of "a confirmed teach label becomes the keyword" (owner decision,
 * 2026-08-11) — migration 61 plus the `exclusive` write.
 *
 * THE DEFECT. A ⊕ teach persists `anchor_label` into `field_anchors`, which drives STAGE 2
 * anchoring. Stage 1 keyword carried on using the shipped caption bank, so a correct taught
 * `po_number` mapping coexisted with a keyword still hunting the generic 'ref'. The store that
 * fixes it (`field_label_overrides`) already existed and was already threaded into extraction; its
 * only writers were the admin Settings screen and the preset seeder.
 *
 * THE OWNER ASKED FOR REPLACE, NOT ADD, and that distinction is the whole point — the pre-existing
 * additive form is exactly what let 'ref' keep winning, because it falls THROUGH to the shipped
 * labels whenever the taught one does not hit. The Python half of that contract is pinned in
 * python_backend/tests/test_taught_label_exclusive.py; this file pins the column and the write.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_taught_label_keyword.js
 */
const Database = require('better-sqlite3');
const { runMigrations, runJsMigrations } = require('../index');
const lo = require('./label_overrides');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};

const db = new Database(':memory:');
runMigrations(db);
try { runJsMigrations(db); } catch { /* workflow ensure may warn on a bare fixture */ }

console.log('\n1. Migration 61 — the column exists and is inert by default');
const cols = db.prepare('PRAGMA table_info(field_label_overrides)').all().map(c => c.name);
check('field_label_overrides.exclusive exists', cols.includes('exclusive'));
lo.addLabelOverride(db, { doc_type_slug: 'invoice', field_key: 'po_number', label: 'Admin Typed' });
const adminRow = db.prepare("SELECT * FROM field_label_overrides WHERE label='Admin Typed'").get();
check('an ADMIN-typed override is NOT exclusive (Settings behaviour unchanged)',
      !adminRow.exclusive, JSON.stringify(adminRow && adminRow.exclusive));

console.log('\n2. The teach write marks its label exclusive');
const r = lo.addLabelOverride(db, { doc_type_slug: 'invoice', field_key: 'po_number',
                                    label: 'Purchase Order No', exclusive: 1 });
check('write reports inserted', r.ok && r.inserted === 1);
const taught = db.prepare("SELECT * FROM field_label_overrides WHERE label='Purchase Order No'").get();
check('stored with exclusive = 1', taught.exclusive === 1);

console.log('\n3. Re-teaching an EXISTING additive label PROMOTES it');
// INSERT OR IGNORE makes a duplicate a no-op, so without the promote step an admin who had already
// typed the same caption would silently keep the additive behaviour the operator just overrode.
const p = lo.addLabelOverride(db, { doc_type_slug: 'invoice', field_key: 'po_number',
                                    label: 'Admin Typed', exclusive: 1 });
check('duplicate insert is still a no-op', p.inserted === 0);
check('...but the existing row is PROMOTED to exclusive', p.promoted === 1);
check('and the row really changed in the DB',
      db.prepare("SELECT exclusive FROM field_label_overrides WHERE label='Admin Typed'").get().exclusive === 1);

console.log('\n4. getForExtraction carries the flag to Python');
// Without this the whole feature is inert: keyword.merge_label_overrides reads o['exclusive'].
const forExt = lo.getForExtraction(db);
const row = forExt.find(o => o.label === 'Purchase Order No');
check('the extraction payload includes an `exclusive` key', row && 'exclusive' in row,
      JSON.stringify(row));
check('...and it is truthy for the taught label', !!(row && row.exclusive));

console.log('\n5. The guards that keep a bad label out of the keyword bank');
// Each of these is a real case: the issuer teaches with an EMPTY label ON PURPOSE (a phantom label
// makes the teach silently do nothing — Oracle-signed 2026-07-10), and a write with no doc-type
// slug could not be scoped to anything.
check('empty label refused', lo.addLabelOverride(db, { doc_type_slug: 'invoice', field_key: 'supplier_name', label: '', exclusive: 1 }).ok === false);
check('missing doc-type slug refused', lo.addLabelOverride(db, { doc_type_slug: '', field_key: 'po_number', label: 'X', exclusive: 1 }).ok === false);
check('over-long label refused (unchanged cap)',
      lo.addLabelOverride(db, { doc_type_slug: 'invoice', field_key: 'po_number', label: 'x'.repeat(121), exclusive: 1 }).code === 'label_too_long');

console.log('\n5b. Migration 62 — TEMPLATE scope ("per doc type for each supplier")');
// The doc-type-wide form is why the mig-61 flag stayed OFF: one supplier's caption became the
// keyword for EVERY supplier's documents of that type. A teach now writes its template's id;
// 0 = doc-type-wide (admin/preset rows only).
check('field_label_overrides.template_id exists',
      db.prepare('PRAGMA table_info(field_label_overrides)').all().some(c => c.name === 'template_id'));
check('an admin row is doc-type-wide (template_id 0)',
      db.prepare("SELECT template_id FROM field_label_overrides WHERE label='Admin Typed'").get().template_id === 0);
const t1 = lo.addLabelOverride(db, { doc_type_slug: 'service_worksheet', field_key: 'worksheet_number',
                                     label: 'JOB SHEET NO', exclusive: 1, template_id: 4 });
check('a teach write stores its template id', t1.ok && t1.inserted === 1 &&
      db.prepare("SELECT template_id FROM field_label_overrides WHERE label='JOB SHEET NO'").get().template_id === 4);
const t2 = lo.addLabelOverride(db, { doc_type_slug: 'service_worksheet', field_key: 'worksheet_number',
                                     label: 'JOB SHEET NO', exclusive: 1, template_id: 7 });
check('a SECOND template may teach the SAME caption (4-column UNIQUE)', t2.ok && t2.inserted === 1);
check('re-teaching the same (label, template) is still a no-op',
      lo.addLabelOverride(db, { doc_type_slug: 'service_worksheet', field_key: 'worksheet_number',
                                label: 'JOB SHEET NO', exclusive: 1, template_id: 4 }).inserted === 0);
const extRow = lo.getForExtraction(db).find(o => o.label === 'JOB SHEET NO' && o.template_id === 4);
check('getForExtraction carries template_id', !!extRow, JSON.stringify(extRow));
// The promote step must never widen an ADMIN row's scope: an exclusive teach on template 9 of the
// admin's caption creates its OWN row rather than promoting the doc-type-wide one.
lo.addLabelOverride(db, { doc_type_slug: 'invoice', field_key: 'account_no', label: 'Scoped Base' });
const p9 = lo.addLabelOverride(db, { doc_type_slug: 'invoice', field_key: 'account_no',
                                     label: 'Scoped Base', exclusive: 1, template_id: 9 });
check('a template-scoped teach of an admin caption INSERTS its own row (never promotes tpl-0)',
      p9.inserted === 1 && p9.promoted === 0
      && db.prepare("SELECT COALESCE(exclusive,0) e FROM field_label_overrides WHERE label='Scoped Base' AND template_id=0").get().e === 0);
db.prepare("DELETE FROM field_label_overrides WHERE label='Scoped Base'").run();

console.log('\n6. CONTROL — the fixture can tell exclusive from additive at all');
// A FRESH additive row, because section 3 deliberately promoted the earlier one: asserting on the
// end state there would be asserting that the promotion did not happen.
lo.addLabelOverride(db, { doc_type_slug: 'invoice', field_key: 'account_no', label: 'Still Additive' });
const all = db.prepare('SELECT label, COALESCE(exclusive,0) e FROM field_label_overrides ORDER BY label').all();
check('both states coexist in one table, so the assertions above are not vacuous',
      all.some(x => x.e === 1) && all.some(x => x.e === 0),
      JSON.stringify(all));
check('and the two are independent — promoting po_number left account_no additive',
      all.find(x => x.label === 'Still Additive').e === 0);

console.log(fails ? `\n${fails} FAILED` : '\nAll taught-label-keyword pins passed');
process.exit(fails ? 1 : 0);
