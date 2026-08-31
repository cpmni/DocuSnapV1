'use strict';
/*
 * test_identity_hold_siblings.js — owner decision 4: a teach that replaces a template's frozen
 * identity with a GENUINELY DIFFERENT company commits, but the layout's OTHER documents are not
 * stamped with the new name at 95 until a second document agrees.
 *
 * WHY THE COMMIT STILL HAPPENS. The near-match guard (dc4bf1d) refuses only near MISSES; a real
 * replacement must go through, or a wrong frozen name could never be corrected by re-teaching.
 * What round 4 showed is that one document's evidence then swept 20 siblings at 95 and put 12 on
 * disk. So the value commits and the SIBLINGS wait.
 *
 * WHY THE NOTE, NOT JUST A LOWER CONFIDENCE (slice-3 B2, recorded 2026-08-13): the review threshold
 * is `< 70`, so a bare 70 does NOT trip below_threshold_valued_count and the document would still
 * be auto-file eligible. The validation_note is what actually holds it.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_identity_hold_siblings.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const templates = require('./templates');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

function freshDb({ hold = true } = {}) {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('teach_identity_near_match_keep','true')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('template_identity_hold_siblings', ?)").run(hold ? 'true' : 'false');
  return db;
}
const idField = (v) => ({ field_key: 'supplier_name', anchor_label: null, direction: 'right', fixed_value: v, is_variable: false });
const tpl = (db, id) => db.prepare('SELECT identity_unconfirmed, identity_supported_count FROM templates WHERE id = ?').get(id);

console.log('\n1. a genuinely different identity commits, and the siblings are held');
{
  const db = freshDb();
  const id = templates.create(db, { name: 'Bramblewood', document_type_slug: 'purchase_order',
                                    fields: [idField('Bramblewood Joinery Ltd')] });
  check('a fresh template is not pending', tpl(db, id).identity_unconfirmed === 0);

  templates.update(db, id, { fields: [idField('Brambleworth Joinery Ltd')] });
  const row = db.prepare("SELECT fixed_value FROM template_fields WHERE template_id=? AND field_key='supplier_name'").get(id);
  check('the different company COMMITS (a wrong frozen name must stay correctable)',
        row.fixed_value === 'Brambleworth Joinery Ltd');
  check('...and the template is marked pending', tpl(db, id).identity_unconfirmed === 1);
  db.close();
}
{
  const db = freshDb();
  const id = templates.create(db, { name: 'B', document_type_slug: 'purchase_order',
                                    fields: [idField('Bramblewood Joinery Ltd')] });
  templates.update(db, id, { fields: [idField('B8ramblewood Joinery Ltd')] });   // the round-4 garble
  check('a NEAR match is refused outright and never marks a hold (nothing changed to hold)',
        tpl(db, id).identity_unconfirmed === 0);
  db.close();
}
{
  const db = freshDb({ hold: false });
  const id = templates.create(db, { name: 'B', document_type_slug: 'purchase_order',
                                    fields: [idField('Bramblewood Joinery Ltd')] });
  templates.update(db, id, { fields: [idField('Brambleworth Joinery Ltd')] });
  check('with the flag OFF nothing is marked at all (the switch is the whole feature)',
        tpl(db, id).identity_unconfirmed === 0);
  db.close();
}

console.log('\n2. agreement releases it; disagreement does not');
{
  const db = freshDb();
  const id = templates.create(db, { name: 'B', document_type_slug: 'purchase_order',
                                    fields: [idField('Bramblewood Joinery Ltd')] });
  templates.update(db, id, { fields: [idField('Brambleworth Joinery Ltd')] });

  templates.noteIdentitySupported(db, id, 'Someone Else Ltd');
  check('a confirm naming a DIFFERENT sender is not support', tpl(db, id).identity_unconfirmed === 1);

  const r = templates.noteIdentitySupported(db, id, 'Brambleworth Joinery Ltd');
  check('one agreeing document releases the hold', r.released === true && tpl(db, id).identity_unconfirmed === 0);

  templates.noteIdentitySupported(db, id, 'Brambleworth Joinery Ltd');
  check('a further confirm on a released template is a no-op', tpl(db, id).identity_unconfirmed === 0);

  check('agreement is case/whitespace-insensitive, like every other scope comparison in the app',
        (() => {
          templates.update(db, id, { fields: [idField('Third Company Ltd')] });
          templates.noteIdentitySupported(db, id, '  third company ltd ');
          return tpl(db, id).identity_unconfirmed === 0;
        })());
  db.close();
}

console.log('\n3. the Python stamp yields while pending, and only for the identity');
{
  const src = fs.readFileSync(path.join(REPO, 'python_backend', 'extraction', 'template_matcher.py'), 'utf8');
  check('the hold is its own flag, DEFAULT OFF',
        /_HOLD_PENDING_IDENTITY = os\.environ\.get\('TEMPLATE_IDENTITY_HOLD_SIBLINGS', '0'\) != '0'/.test(src));
  check('it yields only for the identity field, only while pending, and never for an admin-locked value',
        /_HOLD_PENDING_IDENTITY\s*\n\s*and key in _COMPANY_KEYS\s*\n\s*and not locked\s*\n\s*and template\.get\('identity_unconfirmed'\)/.test(src));
  check('the held stamp carries a NOTE — a bare 70 does not trip the `< 70` review threshold',
        /'confidence': 70,[\s\S]{0,200}'validation_note'/.test(src));
  check('the note tells the operator what to do, not what went wrong',
        /confirm it here too and it will be used automatically/.test(src));
  check('the unheld path still stamps 95 exactly as before',
        /'confidence': 95,\s*\n\s*'method':\s*'template_fixed_locked' if locked else 'template_fixed',/.test(src));
}

console.log('\n5. a REWRITE OF THE SAME NAME is not a displacement (the 2026-08-15 Chris re-run regression)');
// Root cause: nearMatchIdentity(X, X) answers near:false reason:'identical' (deliberate — "near"
// means close-but-not-equal), and the guard read every !near as "genuinely different company". A
// teach writes the issuer TWICE (promote-to-template, then confirm-with-taught_fields), so the
// SECOND, identical write marked the template pending on a FIRST teach — all 200 sibling imports
// stamped @70 "the sender for this layout was changed", File-All-Ready offered 0.
{
  const db = freshDb();
  const id = templates.create(db, { name: 'P', document_type_slug: 'invoice',
                                    fields: [idField('Pelican Office Interiors')] });
  templates.update(db, id, { fields: [idField('Pelican Office Interiors')] });   // the teach's 2nd write
  check('THE REGRESSION: create(V) then update(V) leaves the template NOT pending',
        tpl(db, id).identity_unconfirmed === 0 && tpl(db, id).identity_supported_count === 0);
  templates.update(db, id, { fields: [idField('PELICAN OFFICE INTERIORS')] });
  check('a case-variant rewrite is agreement, not a change (the release basis: trim+lower)',
        tpl(db, id).identity_unconfirmed === 0);
  const row = db.prepare("SELECT fixed_value FROM template_fields WHERE template_id=? AND field_key='supplier_name'").get(id);
  check('...and the INCUMBENT literal is kept byte-identical (scope key never churned)',
        row.fixed_value === 'Pelican Office Interiors');
  db.close();
}
{
  // A rewrite of an ALREADY-PENDING identity is neither displacement nor support: it must not
  // re-zero identity_supported_count (the old amplifier) and must not self-release.
  const db = freshDb();
  const id = templates.create(db, { name: 'B', document_type_slug: 'purchase_order',
                                    fields: [idField('Bramblewood Joinery Ltd')] });
  templates.update(db, id, { fields: [idField('Quillstone Print & Packaging')] });   // genuine change → pending
  check('genuine change still marks (the round-4 defence)', tpl(db, id).identity_unconfirmed === 1);
  templates.update(db, id, { fields: [idField('Quillstone Print & Packaging')] });   // the identical re-teach
  const t = tpl(db, id);
  check('an identical re-write of the pending value neither re-marks-counts nor self-releases',
        t.identity_unconfirmed === 1 && t.identity_supported_count === 0);
  const r = templates.noteIdentitySupported(db, id, 'Quillstone Print & Packaging');
  check('...and a real agreeing confirm still releases it', r.released === true && tpl(db, id).identity_unconfirmed === 0);
  db.close();
}
{
  // The narrowing is DELIBERATE and pinned (Oracle): INTERIOR punctuation/structure changes and
  // un-vettable displacements still mark — only literal (trim+lower, edge-tidied) equality is exempt.
  const db = freshDb();
  const id = templates.create(db, { name: 'S', document_type_slug: 'invoice',
                                    fields: [idField('Smith & Jones Ltd')] });
  templates.update(db, id, { fields: [idField('Smith Jones Ltd')] });   // interior structure changed
  check('an INTERIOR punctuation/structure variant still marks (fold-identical is not literal-identical)',
        tpl(db, id).identity_unconfirmed === 1);
  db.close();
}
{
  const db = freshDb();
  const id = templates.create(db, { name: 'G', document_type_slug: 'invoice',
                                    fields: [idField('Real Company Ltd')] });
  templates.update(db, id, { fields: [idField('***')] });   // fold-empty garbage over a real name
  check('fold-empty garbage displacing a real name still marks (the poison class holds)',
        tpl(db, id).identity_unconfirmed === 1);
  db.close();
}

console.log('\n6. identity EDGE-JUNK tidy at the freeze seam (Chris card 3 — "Pelican Office Interiors -")');
{
  const db = freshDb();
  const id = templates.create(db, { name: 'P', document_type_slug: 'invoice',
                                    fields: [idField('Pelican Office Interiors -')] });
  const row = db.prepare("SELECT fixed_value FROM template_fields WHERE template_id=? AND field_key='supplier_name'").get(id);
  check('a CREATE freezes the TIDIED value (no trailing dash-junk enters the scope key)',
        row.fixed_value === 'Pelican Office Interiors');
  db.close();
}
{
  // A DIRTY incumbent (frozen before the tidy existed) + a clean re-teach: agreement, no mark,
  // and the incumbent literal is KEPT — rewriting it would orphan every hint/anchor/correction
  // keyed to the dirty scope string. The admin fixes a dirty display via setFieldFixedValue.
  const db = freshDb();
  const id = templates.create(db, { name: 'P', document_type_slug: 'invoice', fields: [] });
  db.prepare(`INSERT INTO template_fields (template_id, field_key, anchor_label, direction, fixed_value, is_variable)
              VALUES (?, 'supplier_name', NULL, 'right', 'Pelican Office Interiors -', 0)`).run(id);
  templates.update(db, id, { fields: [idField('Pelican Office Interiors')] });
  const row = db.prepare("SELECT fixed_value FROM template_fields WHERE template_id=? AND field_key='supplier_name'").get(id);
  check('dirty incumbent + clean incoming: NO mark (tidy-both-sides equality)',
        tpl(db, id).identity_unconfirmed === 0);
  check('...and the incumbent literal is retained byte-identical (scope continuity beats cosmetics)',
        row.fixed_value === 'Pelican Office Interiors -');
  db.close();
}
{
  // Pure edge-junk incoming: keep a real incumbent; with none, freeze NOTHING (never junk).
  const db = freshDb();
  const id = templates.create(db, { name: 'J', document_type_slug: 'invoice',
                                    fields: [idField('Real Company Ltd')] });
  templates.update(db, id, { fields: [idField('- -')] });
  const kept = db.prepare("SELECT fixed_value FROM template_fields WHERE template_id=? AND field_key='supplier_name'").get(id);
  check('junk-only incoming keeps the real incumbent', kept.fixed_value === 'Real Company Ltd'
        && tpl(db, id).identity_unconfirmed === 0);
  const id2 = templates.create(db, { name: 'J2', document_type_slug: 'invoice',
                                     fields: [idField('- -')] });
  const j2 = db.prepare("SELECT fixed_value, is_variable FROM template_fields WHERE template_id=? AND field_key='supplier_name'").get(id2);
  check('junk-only on CREATE freezes nothing (fixed_value NULL, variable)',
        (!j2 || j2.fixed_value === null));
  db.close();
}

console.log('\n4. wiring');
{
  const rs = fs.readFileSync(path.join(REPO, 'src', 'services', 'reviewService.js'), 'utf8');
  check('the release runs on confirm, for bulk and single alike',
        /noteIdentitySupported\(db, _tid, \(allValues && allValues\.supplier_name\) \|\| supplier_name \|\| ''\)/.test(rs));
  check('a TAUGHT confirm never releases (Oracle blocking condition 2026-08-16: the teach is the '
        + 'evidence being tested — without this skip a genuine-change teach would self-release '
        + 'once identical rewrites stopped re-marking)',
        /if \(!\(Array\.isArray\(taught_fields\) && taught_fields\.length\)\) \{[\s\S]{0,220}noteIdentitySupported/.test(rs));
  check('...and can never affect the already-returned confirm',
        /catch \(e\) \{ logger\?\.warn\?\.\('identity-hold release skipped: '/.test(rs));
  const ph = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check('the Python side is bridged from the same one setting',
        /template_identity_hold_siblings[\s\S]{0,80}TEMPLATE_IDENTITY_HOLD_SIBLINGS = '1'/.test(ph));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
