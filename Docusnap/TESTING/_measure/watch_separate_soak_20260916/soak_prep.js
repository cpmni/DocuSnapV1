// soak_prep.js <soakRoot> — turn the copied live DB at <soakRoot>/userData/docusnap.db into a SANDBOX:
//   migrate → rewrite every path setting into the sandbox → watch folder ON + watch_separate_enabled ON →
//   client API OFF (no TLS server on the owner's port) → sandbox admin login (admin / Scan-Finder-2026).
// Sandbox-only edits; the owner's live DB is never touched.
'use strict';
const path = require('path');
const fs = require('fs');
const REPO = 'C:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require(path.join(REPO, 'database', 'index'));
const pw = require(path.join(REPO, 'src', 'modules', 'auth', 'password'));

(async () => {
  const root = process.argv[2];
  const userData = path.join(root, 'userData');
  const watch = path.join(root, 'Watch'), filed = path.join(root, 'Filed');
  for (const d of [watch, filed, path.join(root, 'Bundles')]) fs.mkdirSync(d, { recursive: true });
  const db = new Database(path.join(userData, 'docusnap.db'));
  db.pragma('journal_mode = WAL');
  const o = console.log; console.log = () => {}; runMigrations(db); console.log = o;
  const set = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const settings = {
    output_folder: filed,
    processed_folder: '',
    watch_folder: watch,
    watch_folder_enabled: '1',
    watch_separate_enabled: 'true',
    client_api_enabled: 'false',
    diagnostic_logging: 'false',
  };
  for (const [k, v] of Object.entries(settings)) set.run(k, v);
  // any other setting that still points into the owner's profile → blank it (belt: nothing in the sandbox may touch it)
  const home = process.env.USERPROFILE.replace(/\\/g, '\\\\');
  const stray = db.prepare("SELECT key, value FROM settings WHERE value LIKE ? AND key NOT LIKE 'client_api_tls_%'").all(`%${process.env.USERPROFILE}%`);
  for (const r of stray) console.log('  stray path setting left as-is (review):', r.key, '=', r.value);
  // sandbox admin
  const hash = await pw.hashPassword('Scan-Finder-2026');
  const u = db.prepare('SELECT id, username FROM users ORDER BY id LIMIT 1').get();
  db.prepare("UPDATE users SET username = 'admin', password_hash = ?, must_change_password = 0, totp_enabled = 0, is_active = 1 WHERE id = ?").run(hash, u.id);
  console.log(`sandbox admin: user #${u.id} '${u.username}' → 'admin'`);
  const g = k => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value;
  console.log('migrations max =', db.prepare('SELECT MAX(version) v FROM migrations').get().v);
  for (const k of Object.keys(settings)) console.log(' ', k, '=', g(k));
  console.log('  auto_separate_enabled =', g('auto_separate_enabled') ?? '(unset → default true)');
  console.log('  templates =', db.prepare('SELECT COUNT(*) n FROM templates').get().n, '· docs =', db.prepare('SELECT COUNT(*) n FROM documents').get().n);
  db.close();
})().catch(e => { console.error('PREP FAILED:', e); process.exit(1); });
