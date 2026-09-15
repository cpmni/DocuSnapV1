'use strict';
// sandbox_license.js — strip or restore the licence rows of a DEMO sandbox DB.
//   strip   → the app shows the licence screen (record.py films it; nothing is ever activated)
//   restore → copy this machine's licence rows back from the LIVE DB (read-only) so the gate passes again
// Run with Electron-as-Node from the repo root:  ELECTRON_RUN_AS_NODE=1 electron.cmd sandbox_license.js <userData> strip|restore
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));

const [userData, mode] = process.argv.slice(2);
if (!userData || !['strip', 'restore'].includes(mode)) {
  console.error('usage: sandbox_license.js <sandbox-userData-dir> strip|restore');
  process.exit(1);
}
const ENT_KEYS = ['detached_search_seats', 'detached_workflow_seats', 'detached_features_signed'];
const sand = new Database(path.join(userData, 'docusnap.db'));

if (mode === 'strip') {
  const t = sand.prepare('DELETE FROM license_tokens').run().changes;
  let r = 0;
  try { r = sand.prepare('DELETE FROM device_registrations').run().changes; } catch {}
  sand.prepare(`DELETE FROM settings WHERE key IN (${ENT_KEYS.map(() => '?').join(',')})`).run(...ENT_KEYS);
  console.log(`stripped: ${t} license token(s), ${r} device registration(s)`);
} else {
  const live = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });
  let tokens = 0, regs = 0;
  for (const row of live.prepare('SELECT * FROM license_tokens').all()) {
    const cols = Object.keys(row);
    sand.prepare(`INSERT OR REPLACE INTO license_tokens (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
    tokens++;
  }
  try {
    for (const row of live.prepare('SELECT * FROM device_registrations').all()) {
      const cols = Object.keys(row);
      sand.prepare(`INSERT OR REPLACE INTO device_registrations (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
      regs++;
    }
  } catch {}
  for (const k of ENT_KEYS) {
    const row = live.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    if (row) sand.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, row.value);
  }
  live.close();
  console.log(`restored: ${tokens} license token(s), ${regs} device registration(s)`);
}
sand.close();
