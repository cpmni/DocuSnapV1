#!/usr/bin/env node
'use strict';

/**
 * src/services/test_stage1_path_security.js
 * -----------------------------------------
 * STAGE 1 (critical exploit closure). Proves the three hardened handlers resolve every on-disk
 * path SERVER-SIDE from the doc row and IGNORE renderer-supplied paths — closing:
 *   H1/M12  confirm-review        → arbitrary file DELETE + copy-into-output tree
 *   H2      split-pdf             → arbitrary file DELETE + arbitrary-directory WRITE
 *   H3      get-enhanced-preview  → arbitrary file READ (+ UNC/NTLM outbound-auth leak)
 *
 * Each fix is driven with the exact hostile payloads the plan named (C:\Windows..., \\attacker\share,
 * ..\..\secret.pdf, a UNC path) and asserts the operation used the ROW path instead. The real
 * handlers are registered with a fake ipcMain + fake auth/licensing (require.cache), an in-memory DB,
 * and stubbed spawn/fs — mirroring test_reprocess_lock.js / test_workflow_lock.js.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_stage1_path_security.js
 */

const EventEmitter = require('events');
const path   = require('path');
const os     = require('os');
const realFs = require('fs');

// Isolate the PATH-resolution property under test — the per-document access gate has its own suite
// (test_access_service.js). With it off, _assertDocAccess is a no-op and only the path logic is exercised.
process.env.ACCESS_GATE_ENABLED = '0';

// ── Fake auth + licensing (shared by the processing + review handlers), injected BEFORE require ──
let role = 'admin';
const fakeAuth = {
  requireLogin:    () => ({ id: 1, username: 'u', role }),
  requireUnlocked: () => ({ id: 1, username: 'u', role }),
  requireRole:     (...roles) => { if (!roles.includes(role)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }); return { id: 1, username: 'u', role }; },
  hasRole:         (...roles) => roles.includes(role),
  getCurrentUser:  () => ({ id: 1, username: 'u', role }),
  logAudit:        () => {},
};
const authPath = require.resolve('../modules/auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const licPath = require.resolve('../modules/licensing/handler');
const licStub = new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) });
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: licStub };

const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const documents = require('../../database/modules/documents');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const N = (p) => path.normalize(String(p));

// A fake child process: capture argv, emit fixed JSON on stdout, then close.
function makeSpawn(capture, stdoutObj) {
  return (_cmd, args) => {
    capture.push(args);
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => { proc.stdout.emit('data', Buffer.from(JSON.stringify(stdoutObj))); proc.emit('close', 0); });
    return proc;
  };
}
// fs stub: existsSync true only for a controlled set; unlinkSync captured; writes are no-ops.
function makeFs(existing, unlinked) {
  return Object.assign({}, realFs, {
    existsSync:    (p) => existing.has(N(p)),
    unlinkSync:    (p) => { unlinked.push(String(p)); },
    writeFileSync: () => {},
  });
}

const ROOT = path.join(__dirname, '..', '..');
const HOSTILE = { file: 'C:\\Windows\\System32\\drivers\\etc\\hosts', dir: '\\\\attacker\\share', name: '..\\..\\secret.pdf' };

(async () => {
  // ── §A  H1/M12 — reviewService.confirm resolves paths from the doc row, not the payload ──
  console.log('\n§A  H1/M12 — confirm-review uses the ROW source paths, ignores payload paths');
  {
    const db = new Database(':memory:'); runMigrations(db);
    db.prepare("INSERT INTO document_types (id,name,slug,built_in) VALUES (1,'Invoice','invoice',1)").run();
    const id = Number(documents.insert(db, { original_filename: 'real.pdf', folder_path: '/safe', status: 'needs_review' }).lastInsertRowid);
    let captured = null, movedSrc = null;
    const svc = require('./reviewService').createReviewService({
      documents,
      learning: { getSetting: (_d, k) => (k === 'output_folder' ? '/out' : null), saveCorrections: () => {}, getPrefixModelForScope: () => null },
      doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
      filing: {
        normaliseDate: require('../modules/filing/handler').normaliseDate,
        commitDocument: async ({ folderPath, originalFilename }) => {
          captured = { folderPath, originalFilename };
          return { success: true, filename: 'F.pdf', filePath: '/out/F.pdf', srcPath: path.join(folderPath || '', originalFilename || '') };
        },
      },
      fs: { existsSync: () => false, unlinkSync: () => {} },
      path, logger: null, audit: () => {},
      onScheduleSourceMove: ({ srcPath }) => { movedSrc = srcPath; },
      notifyCounts: () => {}, releaseDelayMs: 0,
    });
    const r = await svc.confirm(db, { username: 'u', role: 'admin' }, {
      document_id: id, folder_path: HOSTILE.file, original_filename: HOSTILE.name,   // hostile payload paths
      corrections: {}, allValues: { supplier_name: 'Acme', invoice_number: 'INV-1', invoice_date: '01-01-2026' },
      supplier_name: 'Acme', document_type: 'Invoice', document_type_slug: 'invoice', taught_fields: [],
    });
    check('confirm ok', r.ok === true);
    check('filing copy-in used the ROW folder (/safe), not the payload C:\\Windows...', captured && N(captured.folderPath) === N('/safe'));
    check('filing copy-in used the ROW filename (real.pdf), not the payload ..\\..\\secret.pdf', captured && captured.originalFilename === 'real.pdf');
    check('deferred source-DELETE target derives from the ROW path (no System32 / traversal)',
          typeof movedSrc === 'string' && movedSrc.includes('real.pdf') && !/System32|secret\.pdf/i.test(movedSrc));
    const r2 = await svc.confirm(db, { username: 'u', role: 'admin' },
      { document_id: 999999, folder_path: HOSTILE.file, original_filename: HOSTILE.name, allValues: {}, corrections: {}, document_type_slug: 'invoice' });
    check('confirm on a NONEXISTENT doc → NOT_FOUND (no filing)', r2.ok === false && r2.code === 'NOT_FOUND');
  }

  // ── §B  H2 — split-pdf resolves source / outdir / delete-target from the row ──
  console.log('\n§B  H2 — split-pdf uses ROW source+outdir+delete, ignores renderer filePath/outDir');
  {
    const db = new Database(':memory:'); runMigrations(db);
    const id = Number(documents.insert(db, { original_filename: 'orig.pdf', folder_path: '/scans', status: 'needs_review' }).lastInsertRowid);
    db.prepare('UPDATE documents SET working_path = ? WHERE id = ?').run('/inbox/1.pdf', id);
    const rowOriginal = path.join('/scans', 'orig.pdf');
    const outFile     = path.join('/scans', 'orig_1.pdf');
    const existing = new Set([N('/inbox/1.pdf'), N(rowOriginal), N(outFile)]);
    const unlinked = [], spawnArgs = [];
    const H = {};
    require('../modules/processing/handler').register({
      ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} },
      getDb: () => db, resourcePath: (...p) => path.join(ROOT, ...p),
      pythonExe: () => 'py', pythonArgs: (...a) => a, tesseractPath: () => 'tesseract',
      backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
      configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
      templatesDir: () => os.tmpdir(), createWindow: () => null, getMainWindow: () => null,
      notifyMainWindow: () => {}, notifyAllWindows: () => {}, safeSend: () => {},
      notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
      reviewTraceActive: false, devSliceDir: os.tmpdir(), windows: {}, app: null,
      fs: makeFs(existing, unlinked), logger: { log() {}, warn() {}, err() {} },
      spawn: makeSpawn(spawnArgs, { success: true, files: [outFile] }), path,
    });
    const split = H['split-pdf'];
    const res = await split({}, HOSTILE.file, '1-1', HOSTILE.dir, id, undefined);
    const a = spawnArgs[0] || [];
    const outdir = a[a.indexOf('--outdir') + 1];
    const file   = a[a.indexOf('--file') + 1];
    check('split succeeded', res && res.success === true);
    check('--outdir is the ROW folder (/scans), NOT the renderer outDir \\\\attacker\\share', N(outdir) === N('/scans'));
    check('--file is the ROW working copy, NOT the renderer filePath C:\\Windows...', N(file) === N('/inbox/1.pdf'));
    check('delete target is the ROW original, exactly once', unlinked.length === 1 && N(unlinked[0]) === N(rowOriginal));
    check('the renderer filePath (hosts) was NEVER unlinked', !unlinked.some(p => /hosts/i.test(p)));
    spawnArgs.length = 0;
    const res2 = await split({}, HOSTILE.file, '1-1', HOSTILE.dir, undefined, undefined);
    check('split WITHOUT a docId → refused, no spawn', res2 && res2.success === false && spawnArgs.length === 0);
  }

  // ── §C  H3 — get-enhanced-preview resolves the file from the row; docId required ──
  console.log('\n§C  H3 — get-enhanced-preview reads the ROW file only (renderer path ignored)');
  {
    const db = new Database(':memory:'); runMigrations(db);
    const id = Number(documents.insert(db, { original_filename: 'p.pdf', folder_path: '/scans', status: 'needs_review' }).lastInsertRowid);
    db.prepare('UPDATE documents SET working_path = ? WHERE id = ?').run('/inbox/9.pdf', id);
    const existing = new Set([N('/inbox/9.pdf')]);
    const spawnArgs = [];
    const H = {};
    require('../modules/review/handler').register({
      ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} },
      getDb: () => db, notifyMainWindow: () => {},
      path, fs: makeFs(existing, []), spawn: makeSpawn(spawnArgs, { ok: true }),
      pythonExe: () => 'py', pythonArgs: (...a) => a, tesseractPath: () => 'tesseract',
      resourcePath: (...p) => path.join(ROOT, ...p), logger: { log() {}, warn() {} },
    });
    const pre = H['get-enhanced-preview'];
    await pre({}, { docId: id, page: 0, enhanceParams: { x: 1 } });
    const a1 = spawnArgs[0] || [];
    check('preview spawned with the ROW working copy path', N(a1[a1.indexOf('--file') + 1]) === N('/inbox/9.pdf'));
    spawnArgs.length = 0;
    const r2 = await pre({}, { page: 0, enhanceParams: { x: 1 } });
    check('NO docId → null, no spawn', r2 === null && spawnArgs.length === 0);
    spawnArgs.length = 0;
    await pre({}, { docId: id, folderPath: 'C:\\Windows', filename: 'evil.pdf', page: 0, enhanceParams: { x: 1 } });
    const a3 = spawnArgs[0] || [];
    check('a smuggled folderPath/filename is IGNORED — still the ROW path', N(a3[a3.indexOf('--file') + 1]) === N('/inbox/9.pdf'));
  }

  // ── §D  H3-class (Oracle C1) — reprocess-document resolves the source from the row ──
  console.log('\n§D  H3 class — reprocess-document uses the ROW source path, not the renderer path');
  {
    const db = new Database(':memory:'); runMigrations(db);
    // A CONFIRMED doc with working_path NULL — the exact precondition (confirm nulls working_path on
    // filing) that would drop the shared resolver onto the renderer-supplied path.
    const id = Number(documents.insert(db, { original_filename: 'real.pdf', folder_path: '/filed', status: 'confirmed' }).lastInsertRowid);
    const probed = [];
    const trackFs = Object.assign({}, realFs, {
      existsSync:   (p) => { probed.push(String(p)); return false; },   // nothing resolvable → early "File not found"
      mkdtempSync:  () => { throw new Error('must not reach the temp copy'); },
      copyFileSync: () => { throw new Error('must not copy'); },
    });
    let spawned = false;
    const H = {};
    require('../modules/processing/handler').register({
      ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} },
      getDb: () => db, resourcePath: (...p) => path.join(ROOT, ...p),
      pythonExe: () => 'py', pythonArgs: (...a) => a, tesseractPath: () => 'tesseract',
      backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
      configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
      templatesDir: () => os.tmpdir(), createWindow: () => null, getMainWindow: () => null,
      notifyMainWindow: () => {}, notifyAllWindows: () => {}, safeSend: () => {},
      notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
      reviewTraceActive: false, devSliceDir: os.tmpdir(), windows: {}, app: null,
      fs: trackFs, logger: { log() {}, warn() {}, err() {} },
      spawn: () => { spawned = true; throw new Error('must not spawn'); }, path,
    });
    const res = await H['reprocess-document']({}, { docId: id, folderPath: '\\\\attacker\\share', filename: '..\\..\\secret.pdf' });
    check('reprocess returned File-not-found cleanly (nothing resolvable, no crash)', res && res.success === false);
    check('the hostile UNC/traversal path was NEVER probed on disk (no SMB/NTLM, no read)', !probed.some(p => /attacker|secret\.pdf/i.test(p)));
    check('resolution probed the ROW path instead', probed.some(p => /real\.pdf/i.test(p)));
    check('no Python spawned, no temp copy', spawned === false);
  }

  console.log('');
  if (fails) { console.log(`FAILED: ${fails} check(s)`); process.exit(1); }
  console.log('All Stage-1 path-security checks passed.');
  process.exit(0);
})();
