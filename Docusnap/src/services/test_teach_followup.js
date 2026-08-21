'use strict';
/*
 * test_teach_followup.js — the post-teach "check a few more and this sender files itself" computation
 * (gary+barry → Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-21). Pins:
 *   C1 — `needed` is the MAX over the role fields (issuer/ref/date) of (FORMAT_SOLID_MIN − confirmed
 *        format-group count), NOT an issuer-only or raw-document count.
 *   C2 — the promise is only made when queued siblings can actually reach the bar: enough of them AND
 *        enough DISTINCT reference values (else the ref group stays 'constant' and a new reference is
 *        still refused). Conservative — any doubt drops to a plain reward.
 *   plus: ready state, and the honest-reward (no-promise) degrade.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/services/test_teach_followup.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const { computeTeachFollowup } = require(path.join(REPO, 'src', 'services', 'teachFollowup.js'));

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
const dt = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Invoice','invoice','invoice_number','invoice_date')").run().lastInsertRowid;

let seq = 0;
const addDoc = (supplier, status) => db.prepare(
  "INSERT INTO documents (document_type_id, original_filename, stored_filename, folder_path, status, supplier_name) VALUES (?,?,?,'',?,?)")
  .run(dt, `d${++seq}.pdf`, `d${seq}.pdf`, status, supplier).lastInsertRowid;
const addExt = (docId, key, value) => db.prepare(
  "INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?,?,?,?,95,'keyword')")
  .run(docId, key, value, value);
// A CONFIRMED contribution: issuer + date always, ref only when given.
const confirmed = (supplier, ref) => { const id = addDoc(supplier, 'confirmed'); addExt(id, 'supplier_name', supplier); addExt(id, 'invoice_date', '01/01/2026'); if (ref != null) addExt(id, 'invoice_number', ref); return id; };
// A QUEUED sibling carrying a reference value (feeds the distinct-ref promise gate).
const sibling = (supplier, ref) => { const id = addDoc(supplier, 'needs_review'); addExt(id, 'supplier_name', supplier); if (ref != null) addExt(id, 'invoice_number', ref); return id; };

// ── A — fresh scope, 3 distinct-ref siblings queued → needed 3, promise made ──────────────────
const A = 'Alpha Ltd';
const aTaught = addDoc(A, 'needs_review');                 // the just-taught doc: no rows, like a real teach
['INV-1', 'INV-2', 'INV-3'].forEach(r => sibling(A, r));
const fa = computeTeachFollowup(db, aTaught);
check('A: needed = 3 on a fresh scope (no confirmed contributions yet)', fa.needed === 3);
check('A: not ready', fa.ready === false);
check('A: canPromise — 3 queued siblings with 3 distinct references', fa.canPromise === true);
check('A: siblingCount = 3', fa.siblingCount === 3);

// ── B — C1 per-role MAX: issuer+date solid, ref lagging → needed driven by ref, not 0 ─────────
const B = 'Bravo Ltd';
confirmed(B, 'B-1');   // issuer, date, ref
confirmed(B, null);    // issuer, date only
confirmed(B, null);    // issuer, date only  → issuer=3, date=3, ref=1
const bTaught = addDoc(B, 'needs_review');
const fb = computeTeachFollowup(db, bTaught);
check('B: needed = 2, driven by the lagging REF field (per-role MAX, not issuer-only which would be 0)', fb.needed === 2);

// ── C — C2 constant-ref: siblings all share one reference → NO promise ────────────────────────
const C = 'Charlie Ltd';
const cTaught = addDoc(C, 'needs_review');
for (let i = 0; i < 3; i++) sibling(C, 'SAME-REF');         // 3 siblings, 1 distinct ref
const fc = computeTeachFollowup(db, cTaught);
check('C: needed = 3', fc.needed === 3);
check('C: canPromise FALSE — siblings share one reference (constant-ref lie avoided)', fc.canPromise === false);
check('C: not ready → honest reward, no number promised', fc.ready === false);

// ── D — ready: every role field solid ─────────────────────────────────────────────────────────
const D = 'Delta Ltd';
confirmed(D, 'D-1'); confirmed(D, 'D-2'); confirmed(D, 'D-3');   // issuer=3, date=3, ref=3 distinct
const dTaught = addDoc(D, 'needs_review');
const fd = computeTeachFollowup(db, dTaught);
check('D: needed = 0 when every role field is solid', fd.needed === 0);
check('D: ready → "files itself" reward', fd.ready === true);

// ── E — no siblings queued → cannot promise, honest reward ────────────────────────────────────
const E = 'Echo Ltd';
const eTaught = addDoc(E, 'needs_review');
const fe = computeTeachFollowup(db, eTaught);
check('E: needed = 3 but canPromise FALSE with no queued siblings (home-user no-nag)', fe.needed === 3 && fe.canPromise === false);

// ── guard — a bad/absent docId degrades safely ────────────────────────────────────────────────
check('missing docId → {ok:false}', computeTeachFollowup(db, null).ok === false);

console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
process.exit(fails ? 1 : 0);
