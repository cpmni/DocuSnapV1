'use strict';
// Arm tonight's DARK switches in the CHRIS SANDBOX DB only (never the live DB).
const path = require('path');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const dbPath = process.argv[2];
if (!dbPath || !/chris-sandbox/.test(dbPath)) { console.error('refusing: not a sandbox DB path'); process.exit(2); }
const db = new Database(dbPath);
const ON = ['learning_repair_console', 'learning_repair_forget', 'barcode_inventory', 'barcode_field',
            'corrob_verification_doubt_clear', 'corrob_note_recompute_fc', 'quiet_reread_enabled', 'quiet_reread_on_layout',
            'list_field_scan'];
const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
for (const k of ON) up.run(k);
console.log('armed:', ON.join(', '));
console.log(db.prepare("SELECT key, value FROM settings WHERE key IN (" + ON.map(() => '?').join(',') + ")").all(...ON).map(r => `${r.key}=${r.value}`).join(' '));
db.close();
