'use strict';
/*
 * test_watch_row_dbid_sync.js (2026-09-04) — pins the invariant the watch/import results-row wiring
 * depends on: _handleFileMessage stamps msg.db_id SYNCHRONOUSLY (before it returns), so a caller that
 * mirrors the file_done to the renderer right after the call carries the doc id.
 *
 * THE BUG this guards against: the watch handler wrapped the WHOLE handleFileMessage call in
 * setImmediate, then mirrored the row immediately — so the mirrored msg had NO db_id. Result: every
 * watch-split results row opened Review at doc #1 (the click fell back to openReviewWindow()) and never
 * flipped to "Filed (auto)" (markRowFiled matches on data-doc-id, which was absent). The fix calls
 * handleFileMessage synchronously for file_done — like the manual import path — and this pins that the
 * db_id is genuinely available at that point (a future refactor that defers the stamp into the async
 * tail would re-break both paths, and this test would catch it).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron stress_test/test_watch_row_dbid_sync.js
 */
const os = require('os'), path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../database/index');
const H = require('../src/modules/processing/handler');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
const folder = os.tmpdir();
const notify = () => {};                        // renderer stub — we assert on the mutated msg, not IPC
const logger = { log() {}, warn() {}, err() {} };

// ── SUCCESS file_done: db_id must be set synchronously, before the returned IO promise resolves ──
const okMsg = {
  type: 'file_done', success: true, original_filename: 'watch_split_p2.pdf',
  status: 'needs_review', overall_confidence: 88, document_type: null, extractions: {},
};
const io = H.handleFileMessage(db, okMsg, folder, notify, logger, /* autoFileRun */ false);
check('success: msg.db_id is a number SYNCHRONOUSLY after the call', typeof okMsg.db_id === 'number' && okMsg.db_id > 0);
check('success: a document row was actually persisted at that id',
      !!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(okMsg.db_id));
// the heavy tail (working copy / drain / auto-file) is a promise; let it settle without failing the test
if (io && typeof io.then === 'function') io.catch(() => {});

// ── FAILURE file_done: the stuck-doc record also stamps db_id synchronously ──
const errMsg = {
  type: 'file_done', success: false, original_filename: 'watch_split_p3.pdf',
  error: 'boom',
};
H.handleFileMessage(db, errMsg, folder, notify, logger, false);
check('error: msg.db_id is a number SYNCHRONOUSLY after the call', typeof errMsg.db_id === 'number' && errMsg.db_id > 0);
check('error: the stuck-doc row exists at status=error',
      !!db.prepare("SELECT 1 FROM documents WHERE id = ? AND status = 'error'").get(errMsg.db_id));

// ── the two arrivals get DISTINCT ids (no cross-wiring to doc #1) ──
check('distinct docs get distinct ids (no fallback to the first doc)', okMsg.db_id !== errMsg.db_id);

// give the deferred IO a tick to drain so the process can exit cleanly
setImmediate(() => {
  db.close();
  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
  process.exit(fails ? 1 : 0);
});
