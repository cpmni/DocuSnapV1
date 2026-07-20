'use strict';
/*
 * test_template_confirmed_count.js — N: LIVE confirmed-doc count for the Template Manager
 * (docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md).
 *
 * The stored templates.confirmed_count is under-counted (bumped only on the taught-confirm reuse
 * branch), so the roster shows "confirmed 0×". getAllWithLiveCounts / confirmedDocCount show a LIVE
 * COUNT of confirmed documents instead — WITHOUT touching the stored column or getAll() (which feeds
 * the extraction pipeline). This pins: live count is right, roster sorts by it, it self-heals on
 * de-confirm, and getAll() still returns the STORED column unchanged.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_template_confirmed_count.js
 */
const Database  = require('better-sqlite3');
const templates = require('./templates');

let failures = 0;
function check(label, cond) { console.log((cond ? '  OK  ' : '  BAD ') + label); if (!cond) failures++; return cond; }
function section(t) { console.log('\n' + t); }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
      sample_document_id INTEGER, confirmed_count INTEGER NOT NULL DEFAULT 0, ocr_auto_params TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT, anchor_label TEXT, direction TEXT, fixed_value TEXT, is_variable INTEGER, fixed_locked INTEGER DEFAULT 0);
    CREATE TABLE template_field_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT);
    CREATE TABLE template_landmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, label_text TEXT, page_number INTEGER);
    CREATE TABLE template_logo_hashes (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, phash TEXT, detail_hash TEXT, UNIQUE(template_id, phash));
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, template_id INTEGER, supplier_name TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT);
  `);
  return db;
}

// STORED confirmed_count is deliberately INVERTED vs reality to prove the display uses the live count.
function mkTemplate(db, name, storedCount) {
  const slug = name.toLowerCase();
  return db.prepare("INSERT INTO templates (name, slug, document_type_slug, confirmed_count) VALUES (?, ?, 'invoice', ?)")
    .run(name, slug, storedCount).lastInsertRowid;
}
function mkDoc(db, templateId, status) {
  return db.prepare("INSERT INTO documents (status, template_id) VALUES (?, ?)").run(status, templateId).lastInsertRowid;
}
const byName = (rows, name) => rows.find(r => r.name === name);

section('N: live confirmed-doc counts drive the roster (stored column is inverted)');
{
  const db = makeDb();
  const t1 = mkTemplate(db, 'Alpha', 0);   // stored 0 but will have 3 confirmed docs
  const t2 = mkTemplate(db, 'Beta',  5);   // stored 5 but will have 1 confirmed doc
  const a1 = mkDoc(db, t1, 'confirmed'); mkDoc(db, t1, 'confirmed'); mkDoc(db, t1, 'confirmed');
  mkDoc(db, t1, 'pending');                            // NOT confirmed → must not count
  mkDoc(db, t2, 'confirmed');
  mkDoc(db, null, 'confirmed');                        // template-less confirmed → counts for nobody

  const live = templates.getAllWithLiveCounts(db);
  check('Alpha live count = 3 (its confirmed docs, not the stored 0)', byName(live, 'Alpha').confirmed_count === 3);
  check('Beta live count = 1 (not the stored 5)', byName(live, 'Beta').confirmed_count === 1);
  check('a pending doc is NOT counted', byName(live, 'Alpha').confirmed_count === 3);
  check('roster is sorted by the live count (Alpha=3 before Beta=1)', live[0].name === 'Alpha' && live[1].name === 'Beta');

  check('confirmedDocCount(Alpha) = 3', templates.confirmedDocCount(db, t1) === 3);
  check('confirmedDocCount(Beta) = 1',  templates.confirmedDocCount(db, t2) === 1);

  // PIN DELIBERATELY FLIPPED (2026-07-20). The N slice left getAll on the STORED column to avoid
  // changing pipeline behaviour at that time, and these two checks pinned that choice. But the
  // stored column is only ever bumped by templates.update() on the taught-confirm reuse branch, so
  // a real install reads 0 next to 20 confirmed docs (owner's DB: 0 / 1 / 0 vs 20 / 20 / 19) — and
  // this column is NOT display-only: it feeds the same-type sibling tiebreaks in
  // template_matcher.py:179 and engine.py:696 plus the order templates reach the matcher, all of
  // which sat INERT while every value was 0. getAll now serves the same LIVE count the roster does.
  section('getAll() serves the LIVE count too (pipeline + roster agree; was: stored column)');
  const raw = templates.getAll(db);
  check('getAll Alpha shows the LIVE 3, not the stored 0', raw.find(r => r.name === 'Alpha').confirmed_count === 3);
  check('getAll Beta shows the LIVE 1, not the stored 5',  raw.find(r => r.name === 'Beta').confirmed_count === 1);
  check('getAll is ordered by the live count (Alpha 3 before Beta 1)',
        raw.findIndex(r => r.name === 'Alpha') < raw.findIndex(r => r.name === 'Beta'));
  // The kill switch must restore the old reading byte-for-byte.
  process.env.TEMPLATE_LIVE_COUNTS = '0';
  const stored = templates.getAll(db);
  check('TEMPLATE_LIVE_COUNTS=0 restores the stored column (Alpha 0)',
        stored.find(r => r.name === 'Alpha').confirmed_count === 0);
  check('TEMPLATE_LIVE_COUNTS=0 restores the stored column (Beta 5)',
        stored.find(r => r.name === 'Beta').confirmed_count === 5);
  delete process.env.TEMPLATE_LIVE_COUNTS;
  // FAIL-SAFE (the property this change actually adds): the count must be UNTAKEABLE-safe.
  // getAll is the pipeline reader, so a DB where the count can't be taken must degrade to the
  // stored column, NOT zero every template (which would silently disarm the sibling tiebreaks) and
  // NOT throw. NOTE getAll has always required the template_* tables — that dependency predates
  // this change — so the guarantee is pinned at the level it belongs to.
  {
    const Database = require('better-sqlite3');
    const bare = new Database(':memory:');
    bare.exec('CREATE TABLE templates (id INTEGER PRIMARY KEY, confirmed_count INTEGER DEFAULT 0)');
    check('liveConfirmedCounts returns NULL when the documents table is absent (not an empty map — '
          + 'an empty map legitimately means "no confirmed docs yet" and would zero everything)',
          templates.liveConfirmedCounts(bare) === null);
    bare.close();
  }
  check('a real DB returns a MAP (empty or populated), never null',
        templates.liveConfirmedCounts(db) instanceof Map);

  section('N: the live count SELF-HEALS when a doc is de-confirmed');
  db.prepare("UPDATE documents SET status='deleted' WHERE id=?").run(a1);
  check('Alpha live count drops to 2 after one de-confirm', templates.confirmedDocCount(db, t1) === 2);
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' check(s) FAILED'));
process.exit(failures === 0 ? 0 : 1);
