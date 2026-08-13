'use strict';
/*
 * test_buyer_issued_scope.js — buyer-issued slice 2 (slice 1 shipped as ca0bb49).
 *
 * THE DEFECT. A template taught on a PURCHASE ORDER the business ISSUED carries the OWNER's own
 * company as its frozen identity. The owner's name and address are printed on every document the
 * business RECEIVES — as the recipient — so `template_identity_on_page` is satisfied by
 * construction, and the layout goes on to claim inbound delivery notes and quotes from OTHER
 * suppliers at 95, stamping the owner's name and VAT number on them. Chris met it twice: 20
 * Oakhaven delivery notes on 2026-08-11, and 40 documents from two suppliers in round 4, before he
 * had touched anything.
 *
 * THE MARK is written in JS at confirm time; the REFUSAL is Python's and is deliberately narrow —
 * a marked template may not win a TEXT arm on a document whose OWN printed title is a TRUSTED
 * heading declaring a different type. Same type still matches; an absent or untrusted title still
 * matches (absence is not evidence); the logo arm is untouched.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_buyer_issued_scope.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const templates = require('./templates');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

const freshDb = () => { const db = new Database(':memory:'); runMigrations(db); return db; };
const mark = (db, id) => db.prepare('SELECT buyer_issued FROM templates WHERE id = ?').get(id).buyer_issued;

console.log('\n1. the mark: a PO-shaped type, and nothing else');
{
  const db = freshDb();
  const po  = templates.create(db, { name: 'Ours', document_type_slug: 'purchase_order' });
  const inv = templates.create(db, { name: 'Theirs', document_type_slug: 'invoice' });
  check('a fresh template carries no mark', mark(db, po) === 0);

  templates.markBuyerIssued(db, po, { ref_field_key: 'po_number' });
  check('a type whose reference role is a PO number marks the template', mark(db, po) === 1);

  templates.markBuyerIssued(db, inv, { ref_field_key: 'invoice_number' });
  check('an invoice layout is NOT marked', mark(db, inv) === 0);

  templates.markBuyerIssued(db, po, { ref_field_key: 'invoice_number' });
  check('the mark is go-forward-only — it is never CLEARED by a later confirm', mark(db, po) === 1);

  templates.markBuyerIssued(db, po, null);
  templates.markBuyerIssued(db, 99999, { ref_field_key: 'po_number' });
  check('a missing type / unknown template is a no-op, never a throw', mark(db, po) === 1);
  db.close();
}
{
  // A DB that has not run migration 66 must be a no-op, not a throw.
  const db = new Database(':memory:');
  runMigrations(db);
  db.exec('CREATE TABLE t_backup AS SELECT id, name, slug, document_type_slug FROM templates');
  let ok = true;
  try { templates.markBuyerIssued(db, 1, { ref_field_key: 'po_number' }); } catch { ok = false; }
  check('the writer survives a schema without the column', ok);
  db.close();
}

console.log('\n2. the refusal: narrow by construction (template_matcher.py)');
{
  const src = fs.readFileSync(path.join(REPO, 'python_backend', 'extraction', 'template_matcher.py'), 'utf8');
  check('it is its own flag, DEFAULT OFF',
        /_BUYER_ISSUED_TYPE_SCOPE = os\.environ\.get\('TEMPLATE_BUYER_ISSUED_TYPE_SCOPE', '0'\) != '0'/.test(src));
  check('it needs the mark, a TRUSTED title, a detected slug, and a DIFFERENT type — all four',
        /_BUYER_ISSUED_TYPE_SCOPE and t\.get\('buyer_issued'\)\s*\n\s*and title_trusted and detected_slug\s*\n\s*and \(t\.get\('document_type_slug'\) or ''\) != detected_slug/.test(src));
  check('it lives in the TEXT arm (_match_by_keywords), so the logo arm is untouched',
        /def _match_by_keywords\([\s\S]{0,4000}_BUYER_ISSUED_TYPE_SCOPE/.test(src));
  check('a refused template is SKIPPED, never scored — it cannot win on a tie-break either',
        /and \(t\.get\('document_type_slug'\) or ''\) != detected_slug\):\s*\n\s*continue/.test(src));
}

console.log('\n3. wiring');
{
  const rh = fs.readFileSync(path.join(REPO, 'src', 'modules', 'review', 'handler.js'), 'utf8');
  check('the mark is written on the update path (an existing template earns it on its next confirm)',
        /templates\.markBuyerIssued\(db, templateId, dtInfo\)/.test(rh));
  check('...and on the create path', /templates\.markBuyerIssued\(db, newTemplateId, dtInfo\)/.test(rh));
  const ph = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check('the Python side is bridged from the setting',
        /template_buyer_issued_type_scope[\s\S]{0,80}TEMPLATE_BUYER_ISSUED_TYPE_SCOPE = '1'/.test(ph));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
