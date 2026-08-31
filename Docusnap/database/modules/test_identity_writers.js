'use strict';
/*
 * test_identity_writers.js — WHO can write a template's frozen identity, and what each one is
 * governed by. The round-4 exhibit (a teach replacing 38 confirmations' worth of company name with
 * one draw-box OCR read) was possible because `_upsertFields` never compared warrants; dc4bf1d
 * added the guard. This suite pins the ENUMERATION — that every confirmed-history writer funnels
 * through the one guarded function, that the single exempt door is exempt ON PURPOSE, and that a
 * future fourth writer cannot appear beside them unnoticed.
 *
 * It also pins the provenance record added by migration 64: `template_fields` recorded what a
 * value IS and never where it came from, so diagnosing round 4 took DB forensics and guesswork.
 *
 * The fixture runs the REAL migrations rather than hand-rolling tables — every drifted fixture in
 * this repo (three went red on 2026-08-11) drifted because it hand-rolled the schema its writer
 * needed, and migration 64 is then exercised here rather than simulated.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_identity_writers.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const Database  = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const templates = require('./templates');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
const arm     = (db) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('teach_identity_near_match_keep','true')").run();
const idRow   = (db, id) => db.prepare("SELECT * FROM template_fields WHERE template_id = ? AND field_key = 'supplier_name'").get(id);
const idField = (v) => ({ field_key: 'supplier_name', anchor_label: null, direction: 'right', fixed_value: v, is_variable: false });

console.log('\n1. every confirmed-history writer is governed by the ONE guard');
{
  const db = freshDb(); arm(db);
  const id = templates.create(db, { name: 'Bramblewood', document_type_slug: 'purchase_order',
                                    fields: [idField('Bramblewood Joinery Ltd')] });
  check('create() freezes the identity on a cold template (no incumbent ⇒ nothing to guard)',
        idRow(db, id).fixed_value === 'Bramblewood Joinery Ltd');

  // The round-4 exhibit, through the real teach path.
  templates.update(db, id, { fields: [idField('B8ramblewood Joinery Ltd')] });
  check('update() — the teach path — cannot rename a sender it already knows  ← the exhibit',
        idRow(db, id).fixed_value === 'Bramblewood Joinery Ltd');

  // THE INVARIANT: a genuinely different company still displaces it, or a wrong frozen name could
  // never be corrected by re-teaching.
  templates.update(db, id, { fields: [idField('Brambleworth Joinery Ltd')] });
  check('...but a genuinely DIFFERENT company still displaces the stored identity',
        idRow(db, id).fixed_value === 'Brambleworth Joinery Ltd');
  db.close();
}
{
  const src = fs.readFileSync(path.join(__dirname, 'templates.js'), 'utf8');
  check('mergeInto folds through _upsertFields, with its own provenance',
        /_upsertFields\(db, toId, missingF, \{ source: 'merge' \}\)/.test(src));
  check('create() and update() route through it too',
        /_upsertFields\(db, id, fields, \{ source: source \|\| 'create' \}\)/.test(src)
        && /_upsertFields\(db, id, fields, \{ source: source \|\| 'teach' \}\)/.test(src));
  check('there are exactly THREE _upsertFields CALL sites (a fourth writer must face this pin)',
        (src.match(/(?<!function )_upsertFields\(db, /g) || []).length === 3);
  check('the guard runs for every field of every one of them',
        /for \(const f of fields\) \{\s*\n\s*const eff = _identityOverwriteGuard\(db, templateId, f\);/.test(src));
}
{
  // Graduation only ever CREATEs (it skips a doc that already has a template), so its frozen issuer
  // is a first freeze and never a replacement — stated here rather than assumed.
  const gsrc = fs.readFileSync(path.join(__dirname, 'graduationTemplate.js'), 'utf8');
  check('graduation writes through templates.create, never update',
        /templates\.create\(db, \{/.test(gsrc) && !/templates\.update\(db/.test(gsrc));
  check('...and stamps its own provenance', /source: 'graduation'/.test(gsrc));
  check('...and skips a doc that already has a template (so there is no incumbent to replace)',
        /if \(doc\.template_id\) return \{ action: 'skip', reason: 'already-linked' \}/.test(gsrc));
}

console.log('\n2. the ONE exempt door, exempt on purpose');
{
  const db = freshDb(); arm(db);
  const id = templates.create(db, { name: 'B8', document_type_slug: 'purchase_order',
                                    fields: [idField('B8ramblewood Joinery Ltd')] });
  templates.setFieldFixedValue(db, id, 'supplier_name', 'Bramblewood Joinery Ltd');
  check('an admin literal CAN correct a near-miss frozen name  ← why this door must stay ungoverned',
        idRow(db, id).fixed_value === 'Bramblewood Joinery Ltd');
  check('...and it locks, so a later rebuild cannot undo the correction', idRow(db, id).fixed_locked === 1);
  templates.update(db, id, { fields: [idField('Something Else Ltd')] });
  check('a locked row survives a rebuild that tries to replace it',
        idRow(db, id).fixed_value === 'Bramblewood Joinery Ltd');
  db.close();
}

console.log('\n3. provenance — how did this value get here? (migration 64)');
{
  const db = freshDb(); arm(db);
  const id = templates.create(db, { name: 'X', document_type_slug: 'invoice', fields: [idField('Acme Holdings Ltd')] });
  const r0 = idRow(db, id);
  check('a created freeze records its source', r0.fixed_source === 'create');
  check('...and when', !!r0.fixed_set_at);

  templates.update(db, id, { fields: [idField('Acme Holdings Ltd')] });
  check('an unchanged rebuild does NOT rewrite the provenance', idRow(db, id).fixed_source === 'create');

  templates.update(db, id, { fields: [idField('Different Company Ltd')] });
  check('a real replacement records the writer that did it', idRow(db, id).fixed_source === 'teach');

  templates.setFieldFixedValue(db, id, 'supplier_name', 'Typed By An Admin Ltd');
  check('the admin door records itself distinctly', idRow(db, id).fixed_source === 'admin');
  db.close();
}
{
  // A DB that has not run migration 64 must keep working, not throw — a fixture, or an app started
  // mid-upgrade. Built by running the real migrations and then taking the two columns back off, so
  // every other table stays real. The provenance probe is cached per DB HANDLE, so this has to be a
  // handle that has never been probed.
  const db = new Database(':memory:');
  runMigrations(db);
  db.exec(`
    DROP TABLE template_fields;
    CREATE TABLE template_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT,
      anchor_label TEXT, direction TEXT, fixed_value TEXT,
      is_variable INTEGER DEFAULT 1, fixed_locked INTEGER DEFAULT 0,
      UNIQUE(template_id, field_key)
    );
  `);
  let ok = true;
  try {
    const id = templates.create(db, { name: 'Y', document_type_slug: 'invoice', fields: [idField('Old Schema Ltd')] });
    templates.setFieldFixedValue(db, id, 'vat_no', 'GB 123');
    ok = db.prepare("SELECT fixed_value FROM template_fields WHERE template_id = ? AND field_key='supplier_name'")
           .get(id).fixed_value === 'Old Schema Ltd';
  } catch (e) { ok = false; console.log(`      (${e.message})`); }
  check('a pre-migration-64 schema still writes, without provenance', ok);
  db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
