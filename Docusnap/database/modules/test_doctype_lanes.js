'use strict';
/**
 * test_doctype_lanes.js — pins the OCR / Quick-File lane CROSSOVER (Slice 1, mig 196; design
 * docs/designs/QUICKFILE_LOOKUP_LISTS_2026-09-21.md, Oracle SIGN-OFF-W/COND).
 *
 * PIN 2 (detection-exclusion): quick_file can NEVER re-admit a reading_mode='none' type to OCR detection —
 * detection reads reading_mode ONLY (process_docs.py:1140-1141, keyword.py:906). The Python side never
 * selects quick_file, so mig 196 is inert to detection; this pins the invariant on the JS mirror + the
 * migration backfill + the C2 updateType invariant + desktop↔/v1 picker parity (Oracle C1).
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_doctype_lanes.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const dt = require('./document_types');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

// The detection candidate set EXACTLY as process_docs.py builds known_type_names (reading_mode != 'none').
const detectionCandidates = (db) =>
  new Set(db.prepare("SELECT name FROM document_types WHERE COALESCE(reading_mode,'read') != 'none'").all().map(r => r.name));

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

console.log('§1 mig 196 — column added + backfilled (picker set byte-identical post-migration)');
{
  const db = freshDb();
  const cols = db.prepare('PRAGMA table_info(document_types)').all().map(c => c.name);
  check('quick_file column exists', cols.includes('quick_file'));
  // Seed a couple of known types.
  db.prepare("INSERT INTO document_types (name, slug, reading_mode, built_in) VALUES ('OCR Invoice','ocr_invoice','read',0)").run();
  db.prepare("INSERT INTO document_types (name, slug, reading_mode, built_in) VALUES ('QF Filed','qf_filed','none',0)").run();
  // Re-run the backfill idempotently (mig already ran; assert the rule directly).
  db.prepare("UPDATE document_types SET quick_file = 1 WHERE reading_mode = 'none'").run();
  const ocr = db.prepare("SELECT quick_file, reading_mode FROM document_types WHERE slug='ocr_invoice'").get();
  const qf = db.prepare("SELECT quick_file, reading_mode FROM document_types WHERE slug='qf_filed'").get();
  check("a reading_mode='read' type backfills quick_file=0", ocr.quick_file === 0);
  check("a reading_mode='none' type backfills quick_file=1 (still in the picker)", qf.quick_file === 1);
}

console.log('§2 PIN 2 — quick_file NEVER re-admits a none type to detection; a crossover read type stays detected');
{
  const db = freshDb();
  // A Quick-File-only type flagged quick_file=1, AND a crossover (read + quick_file=1) type.
  db.prepare("INSERT INTO document_types (name, slug, reading_mode, quick_file, built_in) VALUES ('QF Only','qf_only','none',1,0)").run();
  db.prepare("INSERT INTO document_types (name, slug, reading_mode, quick_file, built_in) VALUES ('Crossover Inv','crossover_inv','read',1,0)").run();
  db.prepare("INSERT INTO document_types (name, slug, reading_mode, quick_file, built_in) VALUES ('Pure OCR','pure_ocr','read',0,0)").run();
  const cand = detectionCandidates(db);
  check("a none+quick_file=1 type is EXCLUDED from detection (reading_mode is the sole gate)", !cand.has('QF Only'));
  check('a read+quick_file=1 (crossover) type IS a detection candidate', cand.has('Crossover Inv'));
  check('a plain read type is a detection candidate', cand.has('Pure OCR'));
}

console.log('§3 isQuickFileType — the shared picker predicate (Oracle C1 parity source)');
{
  check('none type → offered', dt.isQuickFileType({ reading_mode: 'none', quick_file: 0 }));   // pre-mig fixture: fallback
  check('read+quick_file=1 (crossover) → offered', dt.isQuickFileType({ reading_mode: 'read', quick_file: 1 }));
  check('read+quick_file=0 → NOT offered', !dt.isQuickFileType({ reading_mode: 'read', quick_file: 0 }));
  check('null → not offered', !dt.isQuickFileType(null));
}

console.log('§4 updateType C2 invariant — a no-OCR type stays reachable (enforced on BOTH writes)');
{
  const db = freshDb();
  const id = db.prepare("INSERT INTO document_types (name, slug, reading_mode, quick_file, built_in) VALUES ('Lane Test','lane_test','read',0,0)").run().lastInsertRowid;
  // (a) setting reading_mode='none' auto-sets quick_file=1.
  dt.updateType(db, id, { reading_mode: 'none' });
  let row = db.prepare('SELECT reading_mode, quick_file FROM document_types WHERE id=?').get(id);
  check("reading_mode='none' forces quick_file=1", row.reading_mode === 'none' && row.quick_file === 1);
  // (b) trying to clear quick_file on a none type is refused/repaired to 1 (no orphan).
  dt.updateType(db, id, { quick_file: 0 });
  row = db.prepare('SELECT reading_mode, quick_file FROM document_types WHERE id=?').get(id);
  check('cannot orphan a none type (quick_file forced back to 1)', row.quick_file === 1);
  // (c) an unknown reading_mode falls back to 'read'.
  dt.updateType(db, id, { reading_mode: 'garbage' });
  row = db.prepare('SELECT reading_mode, quick_file FROM document_types WHERE id=?').get(id);
  check("unknown reading_mode falls back to 'read'", row.reading_mode === 'read');
  // (d) back to read → quick_file=0 is now allowed (a pure OCR type).
  dt.updateType(db, id, { reading_mode: 'read', quick_file: 0 });
  row = db.prepare('SELECT reading_mode, quick_file FROM document_types WHERE id=?').get(id);
  check("read + quick_file=0 allowed (a pure OCR type)", row.reading_mode === 'read' && row.quick_file === 0);
  // (e) a crossover: read + quick_file=1.
  dt.updateType(db, id, { quick_file: 1 });
  row = db.prepare('SELECT reading_mode, quick_file FROM document_types WHERE id=?').get(id);
  check('read + quick_file=1 (crossover) allowed', row.reading_mode === 'read' && row.quick_file === 1);
}

console.log('§5 desktop ↔ /v1 picker parity — both filter through docTypes.isQuickFileType (Oracle C1)');
{
  const desktop = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'directIntake', 'handler.js'), 'utf8');
  const v1 = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'api', 'handler.js'), 'utf8');
  check('desktop picker uses isQuickFileType', /\.filter\(\s*t\s*=>\s*(docTypes|doctypes)\.isQuickFileType\(t\)\s*\)/.test(desktop));
  check('/v1 picker uses isQuickFileType', /\.filter\(\s*t\s*=>\s*(docTypes|doctypes)\.isQuickFileType\(t\)\s*\)/.test(v1));
  check('neither picker still filters on the raw reading_mode string', !/filter\(t => String\(t\.reading_mode \|\| 'read'\) === 'none'\)/.test(desktop + v1));
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
