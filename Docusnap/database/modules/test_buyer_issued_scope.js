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

// ── 4. LETTERHEAD SCOPE — the JS mirror (2026-08-27, Chris round 6 card 1; gary → Oracle) ──────────
// The same class through the JS keyword arm: the quiet lane's selector (arm c′) and the three
// identifyByFingerprint roads (wizard save target, graduation link, reextract re-pin) scored a marked
// template over the WHOLE page. With `template_buyer_issued_letterhead_scope` on, a marked row scores
// over brandingFp.headerBandText only. Real sandbox texts; template 3's real fingerprint.
console.log('\n4. letterhead scope — the JS keyword mirror (findByKeywordFingerprint / identifyByFingerprint)');
{
  const brandingFp = require('./branding_fingerprint');
  const DOC6 = ['Oakhaven Electrical Wholesale', '19 Conduit Row · Ampfield, AM4 7GB · VAT Reg GB 660 1173 45',
    'GOODS DELIVERY NOTE', 'Despatch Ref OED/29786', 'Delivery Date    22-01-2026', 'Your PO    PO-46500',
    'CUSTOMER    DELIVER TO', 'Bramblewood Joinery Ltd    Bramblewood Joinery Ltd', 'Unit 4, Sawpit Lane    Unit 4, Sawpit Lane',
    'Draymarket, DM2 6QF    Draymarket, DM2 6QF', 'Description    Qty'].join('\n');
  const DOC7 = ['Bramblewood Joinery Ltd    PURCHASE ORDER', 'Unit 4, Sawpit Lane · Draymarket, DM2 6QF',
    'Tel 01632 962130 VAT Reg No GB 512 8846 27', 'Purchase Order No PO-65220', 'Order Date    06-03-2026',
    'SUPPLIER    DELIVER TO', 'Quillstone Print & Packaging    Bramblewood Joinery Ltd', 'Pressworks, 51 Galley Street    Unit 4, Sawpit Lane',
    'Inkerton, IK9 4YS    Draymarket, DM2 6QF'].join('\n');
  const T3_FP = ['Bramblewood', 'Joinery', 'Ltd', 'PURCHASE', 'Unit', 'Sawpit', 'Lane', 'Draymarket', 'Tel'];

  check('headerBandText: doc 6 = lines 0-5 (cut before "CUSTOMER    DELIVER TO") — the same string the Python pin asserts',
        brandingFp.headerBandText(DOC6) === DOC6.split('\n').slice(0, 6).join(' '));
  check('headerBandText: doc 7 = lines 0-4 (cut before "SUPPLIER    DELIVER TO")',
        brandingFp.headerBandText(DOC7) === DOC7.split('\n').slice(0, 5).join(' '));
  {
    const py = fs.readFileSync(path.join(REPO, 'python_backend', 'extraction', 'template_matcher.py'), 'utf8');
    const m = /_HEADER_RECIPIENT_MARKERS = \(([^)]*)\)/.exec(py);
    const pyMarkers = m ? m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : null;
    check('the recipient markers are the SAME list on both sides (read from the .py source)',
          !!pyMarkers && JSON.stringify(pyMarkers) === JSON.stringify(brandingFp.HEADER_RECIPIENT_MARKERS));
    check('the counterparty regex is the same word-boundary supplier|vendor on both sides',
          /_cpty_re = re\.compile\(r'\\b\(\?:supplier\|vendor\)\\b', re\.IGNORECASE\)/.test(py)
          && /\/\\b\(\?:supplier\|vendor\)\\b\/i/.test(fs.readFileSync(path.join(REPO, 'database', 'modules', 'branding_fingerprint.js'), 'utf8')));
  }

  const db = freshDb();
  const t3 = templates.create(db, { name: 'Bramblewood Joinery Ltd', document_type_slug: 'purchase_order', keyword_fingerprint: T3_FP });
  templates.markBuyerIssued(db, t3, { ref_field_key: 'po_number' });
  const plain = templates.create(db, { name: 'Plain twin', document_type_slug: 'invoice', keyword_fingerprint: T3_FP });
  const setScope = (v) => db.prepare("INSERT INTO settings (key, value) VALUES ('template_buyer_issued_letterhead_scope', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
  delete process.env.TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE;

  setScope('false');
  const off6 = templates.findByKeywordFingerprint(db, DOC6, 75, 'purchase_order');
  check('OFF (positive control): the marked template SELECTS doc 6 at 7/9 = 77', !!off6 && off6.template.id === t3 && off6.confidence === 77);
  check('OFF: identifyByFingerprint names it too (the wizard / graduation-link / reextract road)',
        (() => { const r = templates.identifyByFingerprint(db, { logo_phash: null, ocr_text: DOC6, document_type_slug: 'purchase_order' }); return !!r && r.template.id === t3; })());

  setScope('true');
  check('ON: doc 6 is NOT selected (no fingerprint word in its letterhead band)', templates.findByKeywordFingerprint(db, DOC6, 75, 'purchase_order') === null);
  check('ON: identifyByFingerprint → null on doc 6',
        templates.identifyByFingerprint(db, { logo_phash: null, ocr_text: DOC6, document_type_slug: 'purchase_order' }) === null);
  const on7 = templates.findByKeywordFingerprint(db, DOC7, 75, 'purchase_order');
  check('ON: the owner\'s own PO still selects at 100', !!on7 && on7.template.id === t3 && on7.confidence === 100);
  const onPlain = templates.findByKeywordFingerprint(db, DOC6, 75, 'invoice');
  check('ON: an UNMARKED twin still scores the whole page (byte-identical for unmarked rows)', !!onPlain && onPlain.template.id === plain && onPlain.confidence === 77);

  process.env.TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE = '0';
  check('env =0 wins over the setting (harness arms): doc 6 selects again',
        (() => { const r = templates.findByKeywordFingerprint(db, DOC6, 75, 'purchase_order'); return !!r && r.template.id === t3; })());
  setScope('false');
  process.env.TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE = '1';
  check('env =1 wins over the setting: doc 6 refused', templates.findByKeywordFingerprint(db, DOC6, 75, 'purchase_order') === null);
  delete process.env.TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE;
  db.close();

  {
    // A fixture table WITHOUT the buyer_issued column (pre-migration-66 shape): whole page, never a throw.
    const raw = new Database(':memory:');
    raw.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, document_type_slug TEXT, keyword_fingerprint TEXT)");
    raw.prepare("INSERT INTO settings VALUES ('template_buyer_issued_letterhead_scope', 'true')").run();
    raw.prepare("INSERT INTO templates (name, slug, document_type_slug, keyword_fingerprint) VALUES ('B', 'b', 'purchase_order', ?)").run(JSON.stringify(T3_FP));
    let r = null, threw = false;
    try { r = templates.findByKeywordFingerprint(raw, DOC6, 75, 'purchase_order'); } catch { threw = true; }
    check('no buyer_issued column: no throw, whole-page scoring (nothing to scope)', !threw && !!r && r.confidence === 77);
    raw.close();
  }
  const tsrc = fs.readFileSync(path.join(REPO, 'database', 'modules', 'templates.js'), 'utf8');
  check('templates.js reads the ONE setting key (env wins both directions)',
        /getSetting\(db, 'template_buyer_issued_letterhead_scope', 'false'\) === 'true'/.test(tsrc)
        && /TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE === '1'/.test(tsrc) && /TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE === '0'/.test(tsrc));
  const ph = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check('the Python arm is bridged from the same setting',
        /template_buyer_issued_letterhead_scope[\s\S]{0,80}TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE = '1'/.test(ph));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
