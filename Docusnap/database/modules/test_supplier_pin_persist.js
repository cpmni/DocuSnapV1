'use strict';
/*
 * test_supplier_pin_persist.js — operator "Resolve" supplier PIN storage (Part B, B-slice 2).
 * Migration 50 adds documents.supplier_pin; the pin is written by the resolve-issuer IPC and CLEARED on
 * confirm (both paths) so a stale pin can never override a later legitimate resolution.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_supplier_pin_persist.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);

const cols = db.prepare('PRAGMA table_info(documents)').all().map(c => c.name);
check('migration 50: documents.supplier_pin column exists', cols.includes('supplier_pin'));

const dt = db.prepare("INSERT INTO document_types (name, slug) VALUES ('Invoice','invoice')").run();
function newDoc(status) {
  return db.prepare("INSERT INTO documents (document_type_id, original_filename, stored_filename, folder_path, status, supplier_name) VALUES (?, 'm.pdf', 'm.pdf', '', ?, 'Ridgeway Plant Hire')")
           .run(dt.lastInsertRowid, status).lastInsertRowid;
}
const pinOf = (id) => db.prepare('SELECT supplier_pin FROM documents WHERE id = ?').get(id).supplier_pin;
const statusOf = (id) => db.prepare('SELECT status FROM documents WHERE id = ?').get(id).status;

// 1) the pin write (what the resolve-issuer IPC does)
const a = newDoc('needs_review');
db.prepare('UPDATE documents SET supplier_pin = ? WHERE id = ?').run('Marlowe Medical Supplies', a);
check('pin written + read back', pinOf(a) === 'Marlowe Medical Supplies');

// 2) confirmIfReviewable (the atomic primary confirm path) clears the pin
documents.confirmIfReviewable(db, a, { stored_filename: 'x.pdf', stored_path: '/x.pdf', confirmed_by_username: 'u' });
check('confirmIfReviewable set status confirmed', statusOf(a) === 'confirmed');
check('confirmIfReviewable CLEARED the pin (no stale override later)', pinOf(a) == null);

// 3) confirm() (the re-file path, via the update() allowlist) also clears the pin
const b = newDoc('needs_review');
db.prepare('UPDATE documents SET supplier_pin = ? WHERE id = ?').run('Marlowe Medical Supplies', b);
documents.confirm(db, b, { stored_filename: 'y.pdf', stored_path: '/y.pdf', confirmed_by_username: 'u' });
check('confirm() set status confirmed', statusOf(b) === 'confirmed');
check('confirm() CLEARED the pin (supplier_pin now allowed by update())', pinOf(b) == null);

// 4) a doc with no pin round-trips NULL (null-inert)
const c = newDoc('needs_review');
check('a doc with no pin → supplier_pin NULL (null-inert)', pinOf(c) == null);

console.log('\n' + (fails === 0 ? 'ALL PASS' : `${fails} FAILED`));
process.exit(fails ? 1 : 0);
