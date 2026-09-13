'use strict';
// Pre-configure the NIGHT sandbox DB (mine, never the live one): two users (admin + read-only), the client API
// on a spare loopback port, first-run gates off, two placeholder documents so the search list has rows.
// Run: ELECTRON_RUN_AS_NODE=1 electron.exe night_sandbox_setup.js <sandbox-userData-dir>
const path = require('path');
const REPO = 'C:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const pw = require(path.join(REPO, 'src', 'modules', 'auth', 'password'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
const ud = process.argv[2];
(async () => {
  const db = new Database(path.join(ud, 'docusnap.db'));
  const hAdmin = await pw.hashPassword('Night-Admin-9');
  const hRead = await pw.hashPassword('Night-Reader-9');
  const ins = db.prepare('INSERT OR REPLACE INTO users (id, username, display_name, password_hash, role, is_active, must_change_password) VALUES (?,?,?,?,?,1,0)');
  ins.run(1, 'nightadmin', 'Night Admin', hAdmin, 'admin');
  ins.run(2, 'nightreader', 'Night Reader', hRead, 'readonly');
  for (const [k, v] of Object.entries({ client_api_enabled: 'true', client_api_host: '127.0.0.1', client_api_port: '8797',
    first_run_completed: 'true', welcome_seen: 'true', output_folder: path.join(path.dirname(ud), 'Output') })) learning.setSetting(db, k, v);
  const type = db.prepare("SELECT id FROM document_types WHERE slug = 'invoice'").get();
  const typeId = type ? type.id : 1;
  const d = db.prepare(`INSERT OR REPLACE INTO documents (id, document_type_id, original_filename, stored_filename, stored_path, folder_path, status, supplier_name, reference_number, doc_date, overall_confidence, confirmed_at, processed_at, page_count)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  d.run(1, typeId, 'inv1.pdf', 'Invoice.12-03-2026.INV-001.pdf', '', '', 'confirmed', 'Acme Ltd', 'INV-001', '12-03-2026', 97, '2026-03-12', '2026-03-12', 3);
  d.run(2, typeId, 'po7.pdf', 'po7.pdf', '', '', 'needs_review', 'Cable Co', 'PO-7', '', 72, null, '2026-03-13', null);
  console.log('users:', db.prepare('SELECT username, role FROM users').all().map(u => u.username + ':' + u.role).join(', '));
  console.log('settings:', ['client_api_enabled', 'client_api_port', 'detached_search_seats', 'detached_features_signed'].map(k => k + '=' + (learning.getSetting(db, k) || '(none)')).join(' '));
  console.log('documents:', db.prepare('SELECT COUNT(*) n FROM documents').get().n);
  db.close();
})().catch((e) => { console.error(e); process.exit(1); });
