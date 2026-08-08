'use strict';
// Seed the Chris sandbox: fresh migrated DB + ONLY the license rows copied from the live DB
// (same machine → same fingerprint → the cached seat/trial token verifies offline). No users,
// no documents, no learning — Chris gets the true first-run experience. Live DB opened
// STRICTLY READ-ONLY.
const path = require('path');
const fs = require('fs');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const dbmod = require(path.join(REPO, 'database', 'index.js'));

const SANDBOX = process.argv[2];
if (!SANDBOX) { console.error('usage: seed_sandbox.js <sandbox-userData-dir>'); process.exit(1); }
fs.mkdirSync(SANDBOX, { recursive: true });

const live = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });
const sand = new Database(path.join(SANDBOX, 'docusnap.db'));
dbmod.runMigrations(sand);
try { dbmod.runJsMigrations(sand); } catch (e) { console.log('js migrations note:', e.message); }

let tokens = 0, regs = 0;
for (const r of live.prepare('SELECT * FROM license_tokens').all()) {
  const cols = Object.keys(r);
  sand.prepare(`INSERT INTO license_tokens (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(r);
  tokens++;
}
try {
  for (const r of live.prepare('SELECT * FROM device_registrations').all()) {
    const cols = Object.keys(r);
    sand.prepare(`INSERT INTO device_registrations (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(r);
    regs++;
  }
} catch (e) { console.log('device_registrations note:', e.message); }
// Detached/workflow entitlement seats (backend-cached, license-derived — same machine):
for (const k of ['detached_search_seats', 'detached_workflow_seats', 'detached_features_signed']) {
  const row = live.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  if (row) sand.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, row.value);
}
// Terms: leave UNACCEPTED (Chris reviews the legal gate as part of first-run).
console.log(`seeded: ${tokens} license token(s), ${regs} device registration(s), entitlement settings copied`);
console.log('users in sandbox:', sand.prepare('SELECT COUNT(*) n FROM users').get().n, '(0 = create-first-admin flow)');
live.close(); sand.close();
