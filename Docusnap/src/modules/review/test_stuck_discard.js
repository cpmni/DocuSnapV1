'use strict';
/*
 * test_stuck_discard.js — PIN for "Remove" (discard) on the "couldn't be read" surface.
 *
 * THE DEFECT (owner, 2026-09-13): a doc that fails OCR holds at status='error' forever. The launchpad
 * banner's × only HIDES it for the session and the Home attention card ("N couldn't be read") has no
 * dismiss at all, so a genuinely-dead doc (e.g. a repeated 300s timeout that "Try again" can't fix)
 * could never be cleared — the count came back on every launch.
 *
 * THE FIX: a "Remove" action → discard-stuck-docs soft-deletes the error rows (into the recycle bin,
 * originals untouched), so getStuckCount → 0 and both surfaces clear. Recoverable, consistent with the
 * app's delete model, and it ONLY ever touches status='error' rows (a stale/forged id can't reach a
 * live document).
 *
 * Part 1 pins the SEMANTICS behaviourally (the handler leans on softDelete + the error-only set).
 * Part 2 pins the WIRING by source-grep (a drifted call-site across handler/preload/html/renderer is
 * exactly what silently breaks this).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/review/test_stuck_discard.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. semantics — discarding a stuck doc clears the count; live docs are untouched');
{
  const Database  = require('better-sqlite3');
  const documents = require('../../../database/modules/documents');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_filename TEXT, folder_path TEXT, working_path TEXT,
      status TEXT, error_message TEXT, processed_at TEXT, deleted_at TEXT,
      confirmed_at TEXT
    );
  `);
  const ins = db.prepare("INSERT INTO documents (original_filename, status, error_message, confirmed_at) VALUES (?,?,?,?)");
  ins.run('timeout1.pdf', 'error', 'Timeout: 300s', null);
  ins.run('timeout2.pdf', 'error', 'Timeout: 300s', null);
  const liveId = ins.run('good.pdf', 'confirmed', null, '2026-09-10T00:00:00Z').lastInsertRowid;
  const reviewId = ins.run('inreview.pdf', 'needs_review', null, null).lastInsertRowid;

  check('two stuck to start', documents.getStuckCount(db) === 2);

  // The exact set the handler discards: getStuckQueue ids (error-only) → softDelete each.
  const stuckIds = documents.getStuckQueue(db).map(d => d.id);
  check('getStuckQueue yields ONLY the two error rows', stuckIds.length === 2 && !stuckIds.includes(liveId) && !stuckIds.includes(reviewId));
  for (const id of stuckIds) documents.softDelete(db, id);

  check('stuck count clears to 0', documents.getStuckCount(db) === 0);
  check('discarded rows are recoverable (status=deleted, not gone)',
        db.prepare("SELECT COUNT(*) n FROM documents WHERE status='deleted' AND deleted_at IS NOT NULL").get().n === 2);
  check('the confirmed live doc is untouched',
        db.prepare('SELECT status FROM documents WHERE id=?').get(liveId).status === 'confirmed');
  check('the in-review doc is untouched',
        db.prepare('SELECT status FROM documents WHERE id=?').get(reviewId).status === 'needs_review');
  db.close();
}

console.log('2. wiring — the discard path is registered, error-only guarded, and broadcast');
{
  const rh = read('src/modules/review/handler.js');
  check('review handler registers discard-stuck-docs', /ipcMain\.handle\('discard-stuck-docs'/.test(rh));
  const body = rh.slice(rh.indexOf("ipcMain.handle('discard-stuck-docs'"), rh.indexOf("ipcMain.handle('discard-stuck-docs'") + 900);
  check('admin/edit gated', /requireRole\('admin', 'edit'\)/.test(body));
  check('acts on the getStuckQueue set only (error-only guard)', /documents\.getStuckQueue\(db(,\s*getCurrentUser\(\))?\)\.map\(d => d\.id\)/.test(body));
  check('soft-deletes (recoverable — never a hard purge)', /documents\.softDelete\(db, id\)/.test(body) && !/deleteDoc/.test(body));
  check('re-broadcasts the stuck count', /broadcastStuckCount\(notifyMainWindow, db\)/.test(body));
  check('fires the bin-changed signal (the doc now lives in the bin)', /notifyBinChanged\(\)/.test(body));

  const pre = read('src/preload.js');
  check('preload exposes discardStuckDocs', /discardStuckDocs:\s+\(ids\)\s+=> ipcRenderer\.invoke\('discard-stuck-docs', ids\)/.test(pre));

  const html = read('src/windows/main/index.html');
  check('the Remove button exists in the stuck banner', /id="btn-stuck-discard"/.test(html));

  const rr = read('src/windows/main/renderer.js');
  check('renderer wires Remove → discardStuckDocs behind a confirm', /btnStuckDiscard\?\.addEventListener[\s\S]{0,600}discardStuckDocs\(\)/.test(rr) && /confirm\(/.test(rr.slice(rr.indexOf('btnStuckDiscard?.addEventListener'), rr.indexOf('btnStuckDiscard?.addEventListener') + 600)));
  check('Remove is admin/edit-only (hidden for read-only)', /btnStuckDiscard\.style\.display = _userCanReview/.test(rr));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
