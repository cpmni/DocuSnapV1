#!/usr/bin/env node
'use strict';

/**
 * src/modules/processing/test_reprocess_lock.js
 * Slice 1 Stage E — the WORKFLOW_LOCK on BOTH reprocess doors, driven through the
 * REAL processing handler (registered with a fake ipcMain/auth, the review-handler
 * test pattern). Hermetic: every locked path returns BEFORE any file staging or
 * Python spawn (ctx.spawn throws if reached).
 *
 * Pins:
 *   §1 single-doc: edit on a locked doc -> WORKFLOW_LOCKED refusal, NO 'reprocess'
 *      success audit; admin overrides (audited) and proceeds past the guard.
 *   §2 batch: skip-and-report — locked docs are counted out, never abort the batch,
 *      and ADMIN BATCH ALSO SKIPS (the deliberate no-auto-override choice; bulk
 *      mutation under an approver is exactly the class the lock exists for — the
 *      override stays a per-doc act via single-doc reprocess). Do NOT "fix" this.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_reprocess_lock.js
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

let session = { id: 1, username: 'admin', role: 'admin' };
const audits = [];
const fakeAuth = {
  requireLogin() { if (!session) throw Object.assign(new Error('login'), { code: 'AUTH_REQUIRED' }); return session; },
  requireRole(...roles) {
    if (!session || !roles.includes(session.role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
    return session;
  },
  getCurrentUser() { return session; },
  logAudit(_db, entry) { audits.push(entry); },
};
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

// Licensing always allows (the lock, not licensing, is under test). Proxy: any other
// export the handler touches resolves to a harmless no-op.
const licPath = require.resolve('../licensing/handler');
const licStub = new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) });
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: licStub };

const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
const lockedId = Number(documents.insert(db, { original_filename: 'locked.pdf', folder_path: '/nowhere', status: 'needs_review' }).lastInsertRowid);
const freeId   = Number(documents.insert(db, { original_filename: 'free.pdf',   folder_path: '/nowhere', status: 'needs_review' }).lastInsertRowid);
db.prepare(`INSERT INTO document_routes (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state)
            VALUES (?, 1, 'admin', 2, 'editor', 'approve', 'pending')`).run(lockedId);

const H = {};
const ROOT = path.join(__dirname, '..', '..', '..');
const handler = require('./handler');
handler.register({
  ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} },
  getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p),
  pythonExe: () => 'py',
  pythonArgs: (...a) => a,
  tesseractPath: () => 'tesseract',
  backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
  configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
  templatesDir: () => os.tmpdir(),
  createWindow: () => null, getMainWindow: () => null,
  notifyMainWindow: () => {}, notifyAllWindows: () => {}, safeSend: () => {},
  notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
  reviewTraceActive: false,
  devSliceDir: path.join(os.tmpdir(), 'ds-devslices-test'),
  windows: {}, app: null, fs,
  logger: { log: () => {}, warn: () => {}, err: () => {} },
  spawn: () => { throw new Error('spawn must not run in this test'); },
  path,
});

(async () => {
  console.log('§1 single-doc door (reprocess-document)');
  session = { id: 2, username: 'editor', role: 'edit' };
  audits.length = 0;
  let r = await H['reprocess-document']({}, { docId: lockedId, folderPath: '/nowhere', filename: 'locked.pdf' });
  check('edit on a LOCKED doc -> WORKFLOW_LOCKED refusal', r && r.success === false && r.code === 'WORKFLOW_LOCKED');
  check("refusal writes NO 'reprocess' success audit", !audits.some(a => a.action === 'reprocess'));
  check('refusal writes NO override audit either', !audits.some(a => a.action === 'workflow_lock_overridden'));

  r = await H['reprocess-document']({}, { docId: freeId, folderPath: '/nowhere', filename: 'free.pdf' });
  check('edit on an UNLOCKED doc passes the guard (fails later on the missing file, not the lock)',
    r && r.success === false && !r.code && /File not found/i.test(r.error || ''));

  session = { id: 1, username: 'admin', role: 'admin' };
  audits.length = 0;
  r = await H['reprocess-document']({}, { docId: lockedId, folderPath: '/nowhere', filename: 'locked.pdf' });
  check('ADMIN overrides the single-doc lock (proceeds past the guard to the missing file)',
    r && r.success === false && !r.code && /File not found/i.test(r.error || ''));
  check('admin override is AUDITED (workflow_lock_overridden, action reprocess)',
    audits.some(a => a.action === 'workflow_lock_overridden' && a.metadata && a.metadata.action === 'reprocess'));

  console.log('§2 batch door (reprocess-batch) — skip-and-report, admin also skips (pinned)');
  session = { id: 2, username: 'editor', role: 'edit' };
  r = await H['reprocess-batch']({}, [
    { docId: lockedId, folderPath: '/nowhere', filename: 'locked.pdf' },
    { docId: freeId,   folderPath: '/nowhere', filename: 'free.pdf' },   // file missing -> staged-skip (existing behaviour)
  ], {});
  check('batch succeeds (never aborts on a locked doc)', r && r.success === true);
  check('locked doc counted in lockedSkipped', r.lockedSkipped === 1);
  check('nothing processed (the free doc had no file — pre-existing continue)', r.done === 0 && r.failed === 0);

  session = { id: 1, username: 'admin', role: 'admin' };
  r = await H['reprocess-batch']({}, [{ docId: lockedId, folderPath: '/nowhere', filename: 'locked.pdf' }], {});
  check('ADMIN batch ALSO skips the locked doc (no bulk auto-override — deliberate, do not "fix")',
    r && r.success === true && r.lockedSkipped === 1 && r.done === 0);

  const routeGone = db.prepare(`UPDATE document_routes SET state='approved' WHERE document_id=?`).run(lockedId);
  check('(setup) route closed', routeGone.changes === 1);
  r = await H['reprocess-batch']({}, [{ docId: lockedId, folderPath: '/nowhere', filename: 'locked.pdf' }], {});
  check('a CLOSED route no longer skips (lock is open-routes-only)', r && r.lockedSkipped === 0);

  console.log('§3 FYI non-locking (2026-07-19 slice) — an open acknowledge route is NOT a lock');
  // WHY delete-close (bulk delete doors) is NOT skip-and-report like this batch: a delete is a
  // VISIBLE cancellation — the route closes to an honest 'recalled' tombstone in Completed —
  // whereas a bulk reprocess under an approver is a SILENT REWRITE of what they're judging.
  // The two behaviours are both deliberate; do not "align" one to the other (Oracle C3).
  db.prepare(`INSERT INTO document_routes (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state)
              VALUES (?, 1, 'admin', 2, 'editor', 'acknowledge', 'pending')`).run(lockedId);
  session = { id: 2, username: 'editor', role: 'edit' };
  r = await H['reprocess-batch']({}, [{ docId: lockedId, folderPath: '/nowhere', filename: 'locked.pdf' }], {});
  check('batch does NOT skip an FYI/acknowledge-routed doc (postcard, not gate — pinned)',
    r && r.success === true && r.lockedSkipped === 0);
  r = await H['reprocess-document']({}, { docId: lockedId, folderPath: '/nowhere', filename: 'locked.pdf' });
  check('single-doc door passes the guard on an FYI route (fails later on the missing file)',
    r && r.success === false && !r.code && /File not found/i.test(r.error || ''));
  process.env.WORKFLOW_ACK_LOCKS = '1';
  r = await H['reprocess-batch']({}, [{ docId: lockedId, folderPath: '/nowhere', filename: 'locked.pdf' }], {});
  check('WORKFLOW_ACK_LOCKS=1 restores the batch skip for FYI routes (polarity pin)',
    r && r.lockedSkipped === 1);
  delete process.env.WORKFLOW_ACK_LOCKS;

  db.close();
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll reprocess-lock checks passed.');
  process.exit(fails ? 1 : 0);
})();
