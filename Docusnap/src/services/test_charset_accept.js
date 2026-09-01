'use strict';
/**
 * test_charset_accept.js — the "These characters are fine" service (2026-09-01; reggie+gary → Oracle).
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_charset_accept.js
 *
 * Pins the load-bearing, ANTI-COSMETIC behaviour: the note cap is destructive (confidence -> 70), so
 * clearing the note alone would be cosmetic (the 08-15 fc_delta lesson). These pins prove the accept
 * RESTORES the pre-cap confidence and RECOMPUTES overall_confidence, and that the garble guard +
 * per-type sibling gate + legacy fail-toward-review all hold. (The full isAutoFileEligible false->true
 * is exercised by the owner's realdoc / reprocess-agreement gate.)
 */
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
const svc = require('./charsetAcceptService');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error(`  x ${name}`); } };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, slug TEXT, ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY, document_type_id INTEGER, key TEXT, type TEXT, required INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, document_type_id INTEGER, status TEXT, overall_confidence INTEGER, supplier_name TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, display_value TEXT,
                              confidence INTEGER, validation_note TEXT, charset_flag_meta TEXT);
  `);
  db.prepare("INSERT INTO settings (key,value) VALUES ('accept_field_chars_enabled','true')").run();
  db.prepare("INSERT INTO document_types (id,slug,ref_field_key,date_field_key) VALUES (1,'invoice','ref',NULL)").run();
  db.prepare("INSERT INTO fields (document_type_id,key,type,required) VALUES (1,'ref','reference_code',1)").run();
  return db;
}
const NOTE = (chars) => `unexpected characters (${chars}) - please verify`;
function addDoc(db, id, { chars, precap, useMeta = true, otherReq = false }) {
  db.prepare("INSERT INTO documents (id,document_type_id,status,overall_confidence,supplier_name) VALUES (?,?, 'needs_review', 70, 'Acme')").run(id, 1);
  db.prepare("INSERT INTO extractions (document_id,field_key,display_value,confidence,validation_note,charset_flag_meta) VALUES (?, 'ref', ?, 70, ?, ?)")
    .run(id, 'INV' + chars.replace(/\s/g, '') + '123', NOTE(chars), useMeta ? JSON.stringify({ chars: chars.split(' '), precap }) : null);
}
const getRef = (db, id) => db.prepare("SELECT confidence, validation_note, charset_flag_meta FROM extractions WHERE document_id=? AND field_key='ref'").get(id);
const getOverall = (db, id) => db.prepare('SELECT overall_confidence o FROM documents WHERE id=?').get(id).o;

// ── isAcceptableFieldChar (garble guard) ──────────────────────────────────────
ok('accepts "&"',  learning.isAcceptableFieldChar('&'));
ok('accepts "#"',  learning.isAcceptableFieldChar('#'));
ok('refuses U+FFFD', !learning.isAcceptableFieldChar('�'));
ok('refuses Cyrillic А', !learning.isAcceptableFieldChar('А'));
ok('refuses unicode minus U+2212', !learning.isAcceptableFieldChar('−'));
ok('refuses space', !learning.isAcceptableFieldChar(' '));
ok('refuses alnum "A"', !learning.isAcceptableFieldChar('A'));

// ── addAcceptedFieldChars: idempotent + garble drop ───────────────────────────
{
  const db = freshDb();
  const r1 = learning.addAcceptedFieldChars(db, 'reference_code', ['&', '�', 'A']);
  ok('adds only the valid char', r1.added.length === 1 && r1.added[0] === '&');
  const r2 = learning.addAcceptedFieldChars(db, 'reference_code', ['&']);
  ok('idempotent re-add', r2.added.length === 0);
  ok('stored per-type', (learning.getAcceptedFieldChars(db).reference_code || []).join('') === '&');
  db.close();
}

// ── recomputeOverall (JS port, lower bound) ───────────────────────────────────
ok('recompute: single valued required field = its confidence',
   svc.recomputeOverall({ ref: { value: 'X', confidence: 95, validation_note: null } }, [{ key: 'ref', required: true }]) === 95);
ok('recompute: a remaining note penalises',
   svc.recomputeOverall({ ref: { value: 'X', confidence: 95, validation_note: 'n' } }, [{ key: 'ref', required: true }]) === 83);
ok('recompute: empty required field scores 0',
   svc.recomputeOverall({ ref: { value: '', confidence: 0, validation_note: null } }, [{ key: 'ref', required: true }]) === 0);

// ── THE ANTI-COSMETIC PIN: precap restored, note cleared, overall recomputed up ─
{
  const db = freshDb();
  addDoc(db, 1, { chars: '&', precap: 100 });
  const before = getRef(db, 1);
  const res = svc.applyCharsetAccept(db, { docId: 1, fieldKey: 'ref' });
  const after = getRef(db, 1);
  ok('accept ok', res.ok && res.accepted.join('') === '&');
  ok('note cleared', before.validation_note && after.validation_note === null);
  ok('confidence RESTORED to precap (not left at 70 — anti-cosmetic)', before.confidence === 70 && after.confidence === 100);
  ok('charset_flag_meta consumed', after.charset_flag_meta === null);
  ok('overall RECOMPUTED up (70 -> 100)', getOverall(db, 1) === 100);
  db.close();
}

// ── CRITICAL-HONESTY: a weak read (precap 80 < 88) is restored but stays weak ──
// (proves the accept restores the field's OWN confidence, never a fabricated clean floor)
{
  const db = freshDb();
  addDoc(db, 1, { chars: '&', precap: 80 });
  svc.applyCharsetAccept(db, { docId: 1, fieldKey: 'ref' });
  ok('weak read restored to its OWN 80 (not inflated)', getRef(db, 1).confidence === 80);
  db.close();
}

// ── LEGACY (charset_flag_meta NULL): note clears, confidence KEPT, overall not recomputed ──
{
  const db = freshDb();
  addDoc(db, 1, { chars: '&', precap: 0, useMeta: false });
  const beforeO = getOverall(db, 1);
  svc.applyCharsetAccept(db, { docId: 1, fieldKey: 'ref' });
  const after = getRef(db, 1);
  ok('legacy: note cleared', after.validation_note === null);
  ok('legacy: confidence KEPT at 70 (fail-toward-review)', after.confidence === 70);
  ok('legacy: overall NOT recomputed', getOverall(db, 1) === beforeO);
  db.close();
}

// ── SIBLING GATE: accept "&" clears the "(&)" doc but leaves the "(& #)" doc held ──
{
  const db = freshDb();
  addDoc(db, 1, { chars: '&', precap: 100 });
  addDoc(db, 2, { chars: '& #', precap: 100 });
  svc.applyCharsetAccept(db, { docId: 1, fieldKey: 'ref' });
  ok('sibling with only accepted chars cleared', getRef(db, 1).validation_note === null);
  ok('sibling with a still-unaccepted char STAYS held', /unexpected characters/.test(getRef(db, 2).validation_note || ''));
  db.close();
}

// ── garble refusal at the service door (whole accept refused) ──────────────────
{
  const db = freshDb();
  db.prepare("INSERT INTO documents (id,document_type_id,status,overall_confidence,supplier_name) VALUES (9,1,'needs_review',70,'Acme')").run();
  db.prepare("INSERT INTO extractions (document_id,field_key,display_value,confidence,validation_note,charset_flag_meta) VALUES (9,'ref','INV�1',70,?,?)")
    .run(NOTE('�'), JSON.stringify({ chars: ['�'], precap: 90 }));
  const res = svc.applyCharsetAccept(db, { docId: 9, fieldKey: 'ref' });
  ok('garble accept refused', !res.ok && res.error === 'unreadable-characters');
  ok('note NOT cleared on refusal', /unexpected characters/.test(getRef(db, 9).validation_note || ''));
  db.close();
}

console.log(`\ncharset-accept service: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
