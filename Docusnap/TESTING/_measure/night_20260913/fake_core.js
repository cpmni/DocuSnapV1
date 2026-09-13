'use strict';
// Hermetic /v1 core for reproducing the client pop-out end to end: the REAL api handler on an in-memory DB
// (real schema), one admin user (admin / Popout-Test-9), entitlement ON, workflow ON. Listens on 8799 (http).
// Run: ELECTRON_RUN_AS_NODE=1 electron.exe fake_core.js
const path = require('path');
const ROOT = 'C:/GIT Projects/Docusnap';
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const api = require(path.join(ROOT, 'src', 'modules', 'api', 'handler'));
const pw  = require(path.join(ROOT, 'src', 'modules', 'auth', 'password'));
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const learning = require(path.join(ROOT, 'database', 'modules', 'learning'));
const licensing = require(path.join(ROOT, 'src', 'modules', 'licensing', 'handler'));
licensing.licenseDenied = () => null;

(async () => {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare(`INSERT INTO document_types (id,name,slug,built_in) VALUES (1,'Invoice','invoice',1)`).run();
  db.prepare(`INSERT INTO documents (id,supplier_name,reference_number,doc_date,document_type_id,status,original_filename,stored_filename,stored_path,folder_path,confirmed_at,processed_at,page_count)
              VALUES (1,'Acme Ltd','INV-001','12-03-2026',1,'confirmed','inv1.pdf','Invoice.pdf','','','2026-03-11','2026-03-11',3),
                     (2,'Bolt Supplies','INV-002','14-03-2026',1,'confirmed','inv2.pdf','Invoice2.pdf','','','2026-03-12','2026-03-12',1)`).run();
  const h = await pw.hashPassword('Popout-Test-9');
  db.prepare(`INSERT INTO users (id,username,display_name,password_hash,role,is_active) VALUES (1,'admin','Admin',?, 'admin',1)`).run(h);
  learning.setSetting(db, 'output_folder', 'C:/out');
  const server = api.createServer({
    getDb: () => db, learning,
    checkEntitlement: () => ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } }),
    app: { getPath: () => require('os').tmpdir() },
    resourcePath: (...s) => path.join(ROOT, ...s),
    pythonExe: () => 'py', pythonArgs: (script, ...a) => ['-3.12', script, ...a],
    tesseractPath: () => 'C:/Program Files/Tesseract-OCR/tesseract.exe',
    log: (m) => console.log('[core]', m),
  });
  server.listen(8799, '127.0.0.1', () => console.log('fake core listening on 8799, contract', api.API_CONTRACT_VERSION));
})().catch((e) => { console.error(e); process.exit(1); });
