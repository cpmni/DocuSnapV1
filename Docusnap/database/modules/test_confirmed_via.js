#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_confirmed_via.js
 * --------------------------------------
 * Pins the Catch-up Filing slice-3 claim/undo primitives:
 *   - confirmIfReviewable stamps confirmed_via at CLAIM time ('scope_sweep' machine confirm),
 *     NULL for a human confirm (the default — no caller change can silently relabel);
 *   - deconfirmDocument clears confirmed_via (a sent-back doc is confirmed by nothing);
 *   - both stay working on a pre-mig-57 DB with NO confirmed_via column (presence-guarded).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_confirmed_via.js
 */

const path = require('path'), fs = require('fs'), os = require('os');
const Database = require('better-sqlite3');
const documents = require(path.join(__dirname, 'documents.js'));

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }

function freshDb(withVia) {
  const db = new Database(path.join(os.tmpdir(), `via_${Date.now()}_${Math.random().toString(36).slice(2)}.db`));
  db.exec(`CREATE TABLE documents (
    id INTEGER PRIMARY KEY, status TEXT, confirmed_at TEXT, confirmed_by_username TEXT,
    stored_filename TEXT, stored_path TEXT, supplier_pin TEXT
    ${withVia ? ', confirmed_via TEXT' : ''} )`);
  db.prepare("INSERT INTO documents (id, status) VALUES (1, 'needs_review')").run();
  return db;
}

console.log('mig-57 DB (confirmed_via present)');
{
  const db = freshDb(true);
  documents.confirmIfReviewable(db, 1, { confirmed_by_username: 'sweeper', confirmed_via: 'scope_sweep' });
  let row = db.prepare('SELECT * FROM documents WHERE id = 1').get();
  check("machine claim stamps confirmed_via='scope_sweep'", row.status === 'confirmed' && row.confirmed_via === 'scope_sweep');
  documents.deconfirmDocument(db, 1);
  row = db.prepare('SELECT * FROM documents WHERE id = 1').get();
  check('deconfirm clears confirmed_via + returns the doc to the queue',
        row.status === 'needs_review' && row.confirmed_via === null && row.confirmed_at === null);
  documents.confirmIfReviewable(db, 1, { confirmed_by_username: 'chris' });
  row = db.prepare('SELECT * FROM documents WHERE id = 1').get();
  check('human claim (no via arg) stamps NULL', row.status === 'confirmed' && row.confirmed_via === null);
  db.close();
}

console.log('pre-mig-57 DB (no column) — presence guard');
{
  const db = freshDb(false);
  let threw = false;
  try { documents.confirmIfReviewable(db, 1, { confirmed_by_username: 'chris', confirmed_via: 'scope_sweep' }); }
  catch { threw = true; }
  const row = db.prepare('SELECT * FROM documents WHERE id = 1').get();
  check('claim neither throws nor fails on a via-less schema', !threw && row.status === 'confirmed');
  let threw2 = false;
  try { documents.deconfirmDocument(db, 1); } catch { threw2 = true; }
  check('deconfirm neither throws nor fails', !threw2
        && db.prepare('SELECT status FROM documents WHERE id = 1').get().status === 'needs_review');
  db.close();
}

console.log(`\n${fails ? fails + ' FAILED' : 'All confirmed_via claim/undo pins passed.'}`);
process.exit(fails ? 1 : 0);
