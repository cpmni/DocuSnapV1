#!/usr/bin/env node
'use strict';
// Traced single-doc reprocess against a COPY of a DB, through the REAL handler (fake ipcMain, real
// spawn) — prints the engine's log lines (template match method, identity arms) for one document.
// Usage: ELECTRON_RUN_AS_NODE=1 electron trace_reprocess.js <db-copy> <docId> <inboxDirOverride>
// The inbox override repoints working_path (a renamed userData folder leaves it absolute + stale).
const path = require('path'); const os = require('os'); const fs = require('fs');
const ROOT = 'C:/GIT Projects/Docusnap';
const Database = require(ROOT + '/node_modules/better-sqlite3');
const [dbPath, docIdArg, inboxDir] = process.argv.slice(2);
const db = new Database(dbPath);
const docId = Number(docIdArg);
if (inboxDir) {
  for (const r of db.prepare('SELECT id, working_path FROM documents').all()) {
    if (r.working_path) db.prepare('UPDATE documents SET working_path = ? WHERE id = ?').run(path.join(inboxDir, path.basename(r.working_path)), r.id);
  }
}
const session = { id: 1, username: 'admin', role: 'admin' };
const fakeAuth = { requireLogin() { return session; }, requireRole() { return session; }, getCurrentUser() { return session; }, logAudit() {} };
const authPath = require.resolve(ROOT + '/src/modules/auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const licPath = require.resolve(ROOT + '/src/modules/licensing/handler');
require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) }) };
const H = {}; const logs = [];
const handler = require(ROOT + '/src/modules/processing/handler');
handler.register({
  ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} }, getDb: () => db,
  resourcePath: (...p) => path.join(ROOT, ...p), pythonExe: () => 'py', pythonArgs: (s, ...a) => ['-3.12', s, ...a],
  tesseractPath: () => 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
  backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'), configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
  templatesDir: () => path.join(os.tmpdir(), 'ds-trace-templates'), createWindow: () => null, getMainWindow: () => null,
  notifyMainWindow: (ch, p) => { if (ch === 'reprocess-progress' && p && p.type === 'log') logs.push(p.text); },
  notifyAllWindows: () => {}, safeSend: (_s, ch, p) => { if (p && p.type === 'log') logs.push(p.text); }, notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
  reviewTraceActive: false, devSliceDir: path.join(os.tmpdir(), 'ds-trace-slices'), windows: {}, app: null, fs,
  logger: { log: (m) => logs.push('[log] ' + m), warn: (m) => logs.push('[warn] ' + m), err: (m) => logs.push('[err] ' + m) },
  spawn: require('child_process').spawn, path,
});
(async () => {
  const d = db.prepare('SELECT original_filename, folder_path, working_path FROM documents WHERE id = ?').get(docId);
  console.log('doc', docId, d.original_filename, 'working exists:', fs.existsSync(d.working_path || ''));
  const r = await H['reprocess-document']({}, { docId, folderPath: d.folder_path, filename: d.original_filename });
  console.log('result:', JSON.stringify({ success: r && r.success, error: r && r.error }).slice(0, 200));
  const keep = logs.filter(l => /via|Template|template|identity|Identity|letterhead|Letterhead|variant|fragment|Corrob|shed|fixed/i.test(String(l)));
  console.log(keep.map(l => '  ' + String(l).slice(0, 220)).join('\n'));
  const row = db.prepare("SELECT display_value, confidence, extraction_method, validation_note FROM extractions WHERE document_id = ? AND field_key = 'supplier_name'").get(docId);
  console.log('supplier row after:', JSON.stringify(row));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
