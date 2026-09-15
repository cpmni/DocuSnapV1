'use strict';
// sandbox_setting.js — upsert one settings row in a DEMO sandbox DB (e.g. output_folder before the setup
// wizard, so the wizard suggests a neutral demo path and no native folder dialog is needed on camera).
// Run with Electron-as-Node from the repo root:  ELECTRON_RUN_AS_NODE=1 electron.cmd sandbox_setting.js <userData> <key> <value>
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));

const [userData, key, value] = process.argv.slice(2);
if (!userData || !key || value == null) {
  console.error('usage: sandbox_setting.js <sandbox-userData-dir> <key> <value>');
  process.exit(1);
}
const db = new Database(path.join(userData, 'docusnap.db'));
db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
db.close();
console.log(`setting ${key} = ${value}`);
