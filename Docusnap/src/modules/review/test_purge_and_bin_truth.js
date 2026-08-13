'use strict';
/*
 * test_purge_and_bin_truth.js — PINs for the recycle bin telling the truth (Chris round 4, cards 2
 * and 4, and round 3 finding 2 unchanged).
 *
 * TWO DEFECTS, BOTH VERIFIED AT SOURCE BEFORE THE FIX:
 *
 * 1. "Empty bin" promises "including their PDF files". The filed PDF survived.
 *    `_purgeOne` unlinked `documents.resolveFilePath(doc)` and `doc.working_path`. resolveFilePath
 *    returns `working_path` FIRST when one exists (documents.js:675), so for a previously-FILED doc
 *    both entries resolved to the same working copy and `stored_path` was never touched. And its
 *    `stored_path` branch requires `status === 'confirmed'` while a binned doc is `'deleted'`, so
 *    with no working copy it fell through to `folder_path + original_filename` — the CUSTOMER'S OWN
 *    SOURCE SCAN, which nothing promises to delete.
 *
 * 2. "Restore all" on a stale bin gave no dialog, no message and no action. Both bin-wide buttons
 *    counted RENDERED ROWS (`#results-scroll .result-item`); a bin opened before the deletes has
 *    none, so `if (!n) return` was a silent no-op over 179 documents. He counted native dialogs and
 *    got zero, so nothing was swallowed — the button really did nothing.
 *
 * The first is pinned BEHAVIOURALLY against a real better-sqlite3 DB and real files on disk,
 * because "which paths get unlinked" is exactly the thing a source pin would let drift.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/review/test_purge_and_bin_truth.js
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const REPO = path.resolve(__dirname, '..', '..', '..');
const Database  = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

// ── the purge target set, run for real ───────────────────────────────────────────────────────
// The shipped `_purgeOne` is a closure inside registerReviewHandlers, so the pin re-creates its
// EXACT body (kept in step by the source assertions at the bottom) and runs it against real files.
function purgeOne(db, docId) {
  const doc = documents.getById(db, docId);
  if (!doc) return;
  const targets = new Set();
  if (doc.working_path) targets.add(doc.working_path);
  if (doc.stored_path)  targets.add(doc.stored_path);
  for (const p of targets) {
    if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }
  documents.deleteDoc(db, docId);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-pin-'));
const touch = (name) => { const p = path.join(TMP, name); fs.writeFileSync(p, 'pdf'); return p; };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_filename TEXT, folder_path TEXT, document_type_id INTEGER,
      supplier_name TEXT, overall_confidence INTEGER, status TEXT,
      template_id INTEGER, logo_phash TEXT, logo_detail_hash TEXT, keyword_fingerprint TEXT,
      ocr_text TEXT, error_message TEXT, stored_filename TEXT, stored_path TEXT, doc_date TEXT,
      reference_number TEXT, confirmed_at TEXT, working_path TEXT, detected_type_name TEXT,
      review_acknowledged_at TEXT, page_count INTEGER, deleted_at TEXT
    );
  `);
  return db;
}

console.log('1. "including their PDF files" is now true');
{
  const db = freshDb();
  const filed   = touch('filed.pdf');       // the copy in the output tree — what the customer sees
  const working = touch('working.pdf');     // the app-managed inbox copy
  const source  = touch('source-scan.pdf'); // the customer's own scan, in their own folder
  const r = documents.insert(db, { original_filename: 'source-scan.pdf', folder_path: TMP, status: 'confirmed' });
  documents.update(db, r.lastInsertRowid, { stored_path: filed, stored_filename: 'filed.pdf' });
  db.prepare('UPDATE documents SET working_path = ? WHERE id = ?').run(working, r.lastInsertRowid);
  documents.softDelete(db, r.lastInsertRowid);          // → the recycle bin, status 'deleted'

  purgeOne(db, r.lastInsertRowid);
  check('the FILED pdf is deleted  ← the promise the dialog makes', !fs.existsSync(filed));
  check('the app-managed working copy is deleted', !fs.existsSync(working));
  check("the customer's own SOURCE scan is NOT deleted (nothing promises that)", fs.existsSync(source));
  check('the row is gone', !documents.getById(db, r.lastInsertRowid));
  db.close();
}
{
  // A never-filed document (imported, deleted from Review): only the working copy exists.
  const db = freshDb();
  const working = touch('w2.pdf');
  const source  = touch('s2.pdf');
  const r = documents.insert(db, { original_filename: 's2.pdf', folder_path: TMP, status: 'needs_review' });
  db.prepare('UPDATE documents SET working_path = ? WHERE id = ?').run(working, r.lastInsertRowid);
  documents.softDelete(db, r.lastInsertRowid);
  purgeOne(db, r.lastInsertRowid);
  check('a never-filed doc loses its working copy', !fs.existsSync(working));
  check('...and still not the source scan', fs.existsSync(source));
  db.close();
}
{
  // THE OLD BEHAVIOUR, reproduced, so the defect cannot come back unnoticed: resolveFilePath
  // prefers working_path and its stored_path branch needs status 'confirmed'.
  const db = freshDb();
  const filed = touch('filed2.pdf'), working = touch('working2.pdf');
  const r = documents.insert(db, { original_filename: 'x.pdf', folder_path: TMP, status: 'confirmed' });
  documents.update(db, r.lastInsertRowid, { stored_path: filed });
  db.prepare('UPDATE documents SET working_path = ? WHERE id = ?').run(working, r.lastInsertRowid);
  documents.softDelete(db, r.lastInsertRowid);
  const doc = documents.getById(db, r.lastInsertRowid);
  check('resolveFilePath alone still returns the WORKING copy, never the filed one  ← why the old set missed it',
        documents.resolveFilePath(doc) === working);
  check('...and a binned doc is not "confirmed", so its stored_path branch cannot fire either',
        doc.status === 'deleted');
  db.close();
}

// ── source pins: the renderer must not gate a bin action on a rendered count ─────────────────
console.log('\n2. the bin is counted from the database, not the screen');
const sq = fs.readFileSync(path.join(REPO, 'src', 'windows', 'search', 'search-query.js'), 'utf8');
check('there is one shared bin-contents read', /async function _binRows\(\)/.test(sq));
check('Restore all counts the BIN', /const rows = await _binRows\(\);[\s\S]{0,200}Restore all/.test(sq));
check('Empty bin counts the BIN', /const rows = await _binRows\(\);[\s\S]{0,300}Permanently delete/.test(sq));
check('neither action is gated on rendered rows any more',
      !/const n = document\.querySelectorAll\('#results-scroll \.result-item'\)\.length;/.test(sq));
check('an empty bin now SAYS so instead of doing nothing',
      /there is nothing to restore/.test(sq) && /already empty/.test(sq));
check('a bin left open refreshes when the window comes back to the front',
      /window\.addEventListener\('focus'[\s\S]{0,120}binMode\) doSearch\(\)/.test(sq));

console.log('\n3. the purge helper itself');
const rh = fs.readFileSync(path.join(REPO, 'src', 'modules', 'review', 'handler.js'), 'utf8');
check('_purgeOne targets working_path and stored_path explicitly',
      /if \(doc\.working_path\) targets\.add\(doc\.working_path\);/.test(rh)
      && /if \(doc\.stored_path\)  targets\.add\(doc\.stored_path\);/.test(rh));
check('_purgeOne no longer resolves a single path (the bug)',
      !/for \(const p of \[documents\.resolveFilePath\(doc\), doc\.working_path\]\)/.test(rh));

console.log('\n4. the approval stamp stops covering the letterhead');
const st = fs.readFileSync(path.join(REPO, 'src', 'services', 'pdfStamp.js'), 'utf8');
check("the default corner is bottom-right", /position = 'bottom-right'/.test(st));
check('an explicit position and a saved placement box still win',
      /if \(box && Number\.isFinite\(Number\(box\.x\)\)/.test(st));

console.log('\n5. "not taught" is no longer painted as an error');
const ix = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'index.html'), 'utf8');
check('the untaught dot is not error-red', !/\.taught-dot \{[\s\S]{0,220}var\(--err\)/.test(ix));
check('a taught dot is still filled green', /\.taught-dot\.on \{ background: var\(--ok\)/.test(ix));

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
