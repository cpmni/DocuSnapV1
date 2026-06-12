#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_bulk_review_delete.js
 * -------------------------------------------
 * Covers documents.deleteByStatus — the helper behind the admin "Delete All
 * Review" / "Delete All Deferred" actions. Verifies it deletes ONLY the given
 * status (never confirmed or other states), and that extractions/corrections
 * are removed by their ON DELETE CASCADE while unrelated docs' data survive.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_bulk_review_delete.js
 */

const Database = require('better-sqlite3');
const documents = require('./documents');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
const cnt = (db, sql, ...a) => db.prepare(sql).get(...a).c;

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT, folder_path TEXT, original_filename TEXT);
  CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, field_key TEXT);
  CREATE TABLE templates (id INTEGER PRIMARY KEY, sample_document_id INTEGER REFERENCES documents(id));
`);
const doc = db.prepare(`INSERT INTO documents (id,status) VALUES (?,?)`);
const ext = db.prepare(`INSERT INTO extractions (document_id,field_key) VALUES (?,?)`);
// 2 needs_review, 2 deferred, 2 confirmed
doc.run(1,'needs_review'); doc.run(2,'needs_review');
doc.run(3,'deferred');     doc.run(4,'deferred');
doc.run(5,'confirmed');    doc.run(6,'confirmed');
for (const id of [1,2,3,4,5,6]) ext.run(id, 'invoice_number');

let fail = 0;

const r1 = documents.deleteByStatus(db, 'needs_review');
fail += !check('deleteByStatus(needs_review) reports 2 deleted', r1.changes === 2);
fail += !check('needs_review docs gone', cnt(db,`SELECT COUNT(*) c FROM documents WHERE status='needs_review'`) === 0);
fail += !check('deferred docs untouched (2)', cnt(db,`SELECT COUNT(*) c FROM documents WHERE status='deferred'`) === 2);
fail += !check('confirmed docs untouched (2)', cnt(db,`SELECT COUNT(*) c FROM documents WHERE status='confirmed'`) === 2);
fail += !check('extractions of deleted review docs cascaded away', cnt(db,`SELECT COUNT(*) c FROM extractions WHERE document_id IN (1,2)`) === 0);
fail += !check('extractions of surviving docs intact (4)', cnt(db,`SELECT COUNT(*) c FROM extractions`) === 4);

const r2 = documents.deleteByStatus(db, 'deferred');
fail += !check('deleteByStatus(deferred) reports 2 deleted', r2.changes === 2);
fail += !check('deferred docs gone', cnt(db,`SELECT COUNT(*) c FROM documents WHERE status='deferred'`) === 0);
fail += !check('confirmed STILL untouched (2) — bulk delete never reaches confirmed', cnt(db,`SELECT COUNT(*) c FROM documents WHERE status='confirmed'`) === 2);

const r3 = documents.deleteByStatus(db, 'needs_review');
fail += !check('idempotent: re-deleting an empty status removes nothing', r3.changes === 0);

db.close();
console.log(fail ? `\n${fail} FAILED` : '\nAll bulk-review-delete checks passed');
process.exit(fail ? 1 : 0);
