'use strict';
/*
 * test_identity_overwrite_guard.js — pins the IDENTITY-OVERWRITE GUARD and its distance module.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_identity_overwrite_guard.js
 *
 * THE DEFECT (Chris round 4, verified in the sandbox DB and on disk). An operator drew a
 * slightly-off box on their own company name; OCR read 'B8ramblewood Joinery Ltd'. The teach
 * OVERWROTE template 13's frozen identity — a value backed by 38 confirmations replaced by one
 * draw-box read of one crop. That template stamped 20 sibling purchase orders via `template_fixed`
 * at 95 with an EMPTY validation_note, so every auto-file gate passed them; 20 were confirmed and
 * 12 written to disk under `Output\B8ramblewood-Joinery-Ltd\`. The write had exactly one guard,
 * `fixed_locked = 1`, and never compared WARRANTS.
 *
 * The pins below run against a REAL better-sqlite3 database through the REAL `templates.update`
 * path, because the defect lives in an UPSERT's conflict branch and a mocked writer would prove
 * nothing about it.
 */
const path = require('path');
const Database = require('better-sqlite3');
const REPO = path.join(__dirname, '..', '..');
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const np = require(path.join(REPO, 'database', 'modules', 'name_proximity.js'));

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// ── the distance module ─────────────────────────────────────────────────────────────────────
console.log('— name_proximity —');

const REAL   = 'Bramblewood Joinery Ltd';
const GARBLE = 'B8ramblewood Joinery Ltd';   // the exhibit: 1 edit
const OTHER  = 'Brambleworth Joinery Ltd';   // a GENUINELY DIFFERENT company: 3 edits

check('the exhibit is judged a near match', np.nearMatchIdentity(GARBLE, REAL).near === true);
check('a genuinely different company is NOT  ← the invariant: a wrong frozen name must stay '
      + 'correctable by re-teaching', np.nearMatchIdentity(OTHER, REAL).near === false);
check('...and it is reported as different-company, not silently dropped',
      np.nearMatchIdentity(OTHER, REAL).reason === 'different-company');

// The measured reason BOTH legs are required: a bare similarity floor cannot separate these.
const simGarble = np.similarIdentity(GARBLE, REAL);
const simOther  = np.similarIdentity(OTHER, REAL);
check(`both clear a bare 0.75 floor (garble ${simGarble.toFixed(3)}, different company `
      + `${simOther.toFixed(3)}) — so the EDIT CAP is what separates them`,
      simGarble >= 0.75 && simOther >= 0.75);

check('identical values are not a "near match" (no-op, distinct reason)',
      np.nearMatchIdentity(REAL, REAL).near === false
      && np.nearMatchIdentity(REAL, REAL).reason === 'identical');
check('punctuation/case/spacing differences fold to identical',
      np.nearMatchIdentity('bramblewood  joinery, ltd.', REAL).reason === 'identical');

// Short names must be exact or nothing — a single substitution in a 2-4 char identity is a
// 25-50% change with no redundancy to detect it.
for (const [a, b] of [['BP', 'BR'], ['IBM', 'IBN'], ['3M', '3N'], ['EE', 'EF']]) {
  check(`short name ${JSON.stringify(b)} -> ${JSON.stringify(a)} is never a near match (BP/IBM/3M/EE immunity)`,
        np.nearMatchIdentity(a, b).near === false);
}
check('an accented name is not folded away to a shorter one (Unicode fold, Python parity)',
      np.foldIdentity('Nestlé Ltd') !== np.foldIdentity('Nestl Ltd'));

// ── the guard, through the real writer ──────────────────────────────────────────────────────
console.log('\n— the writer —');

function freshDb() {
  const db = new Database(':memory:');
  // Mirrors database/index.js:169-191 plus the columns later migrations add and `update` touches.
  db.exec(`
    CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE, document_type_slug TEXT, logo_phash TEXT, logo_detail_hash TEXT,
      keyword_fingerprint TEXT, sample_document_id INTEGER, sample_deskew_angle REAL,
      confirmed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT NOT NULL DEFAULT 'right',
      fixed_value TEXT, is_variable INTEGER NOT NULL DEFAULT 1,
      fixed_locked INTEGER NOT NULL DEFAULT 0, UNIQUE(template_id, field_key));
    CREATE TABLE template_logo_hashes (id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, UNIQUE(template_id, phash));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  return db;
}
const setFlag = (db, on) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run('teach_identity_near_match_keep', on ? 'true' : 'false');
const seed = (db, value, locked = 0) => {
  db.prepare('INSERT INTO templates (name, slug) VALUES (?, ?)').run('tpl', 'tpl-' + Math.floor(Math.random()*1e9));
  db.prepare('INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable, fixed_locked) '
             + 'VALUES (1, ?, ?, 0, ?)').run('supplier_name', value, locked);
  return 1;
};
const frozen = (db) => db.prepare(
  'SELECT fixed_value, is_variable FROM template_fields WHERE template_id=1 AND field_key=?')
  .get('supplier_name');
const overwrite = (db, value) => templates.update(db, 1, {
  fields: [{ field_key: 'supplier_name', fixed_value: value, is_variable: false }] });

// (a) DEFAULT OFF must be byte-identical — the old behaviour, poison and all.
let db = freshDb(); seed(db, REAL); setFlag(db, false);
overwrite(db, GARBLE);
check('flag OFF: the garble still overwrites (byte-identical to today)',
      frozen(db).fixed_value === GARBLE);
db.close();

// (b) ARMED — the exhibit.
db = freshDb(); seed(db, REAL); setFlag(db, true);
overwrite(db, GARBLE);
check('ARMED: the 38x-confirmed identity SURVIVES the garbled teach  ← Chris round 4, prevented',
      frozen(db).fixed_value === REAL);
check('ARMED: the row stays frozen (is_variable untouched)', frozen(db).is_variable === 0);
db.close();

// (c) ARMED — a genuinely different company still displaces it. THE load-bearing inverse:
// without this a wrong frozen name could never be corrected by re-teaching.
db = freshDb(); seed(db, REAL); setFlag(db, true);
overwrite(db, OTHER);
check('ARMED: a genuinely DIFFERENT company still displaces the stored identity  ← re-teaching '
      + 'must keep working', frozen(db).fixed_value === OTHER);
db.close();

// (d) ARMED — a cold template's FIRST freeze is untouched. Only REPLACEMENT is governed.
db = freshDb();
db.prepare('INSERT INTO templates (name, slug) VALUES (?, ?)').run('tpl', 'tpl-' + Math.floor(Math.random()*1e9)); setFlag(db, true);
overwrite(db, GARBLE);
check('ARMED: a first freeze on a cold template is untouched (only replacement is governed)',
      frozen(db).fixed_value === GARBLE);
db.close();

// (e) ARMED — an admin-locked literal is untouched by this guard (the CASE already protects it).
db = freshDb(); seed(db, REAL, 1); setFlag(db, true);
overwrite(db, OTHER);
check('ARMED: an admin-LOCKED fixed value is preserved, as before',
      frozen(db).fixed_value === REAL);
db.close();

// (f) ARMED — a non-identity field is never governed.
db = freshDb(); setFlag(db, true);
db.prepare('INSERT INTO templates (name, slug) VALUES (?, ?)').run('tpl', 'tpl-' + Math.floor(Math.random()*1e9));
db.prepare('INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) '
           + "VALUES (1,'vat_no','GB 512 8846 27',0)").run();
templates.update(db, 1, { fields: [{ field_key: 'vat_no', fixed_value: 'GB 512 8846 28', is_variable: false }] });
check('ARMED: a non-identity field (vat_no) is untouched by the guard',
      db.prepare("SELECT fixed_value f FROM template_fields WHERE field_key='vat_no'").get().f
        === 'GB 512 8846 28');
db.close();

// (g) ARMED — the DOUBLE write. One teach runs the overwrite twice (promote-to-template, then
// confirm-with-taught_fields). The second pass must not sneak the garble in.
db = freshDb(); seed(db, REAL); setFlag(db, true);
overwrite(db, GARBLE); overwrite(db, GARBLE);
check('ARMED: the second write of the same teach cannot sneak it in either',
      frozen(db).fixed_value === REAL);
db.close();

console.log(fails ? `\n${fails} FAILED` : '\nAll pins passed');
process.exit(fails ? 1 : 0);
