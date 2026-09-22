'use strict';
// Arm the DARK switches in the CHRIS SANDBOX DB only (never the live DB) — round 7 (2026-08-27):
// last night's six + today's letterhead scope + the two that were OFF in round 6's sandbox but ON live
// (the disagreement refusal behind card 2; the buyer-issued type scope).
const path = require('path');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const dbPath = process.argv[2];
if (!dbPath || !/chris-sandbox/.test(dbPath)) { console.error('refusing: not a sandbox DB path'); process.exit(2); }
const db = new Database(dbPath);
const ON = ['learning_repair_console', 'learning_repair_forget', 'barcode_inventory', 'barcode_field',
            'corrob_verification_doubt_clear', 'corrob_note_recompute_fc', 'quiet_reread_enabled', 'quiet_reread_on_layout',
            'quiet_reread_kw_select', 'list_field_scan',
            'template_buyer_issued_type_scope', 'template_buyer_issued_letterhead_scope', 'template_identity_on_page',
            'trust_role_disagreement_refuse'];
const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'");
for (const k of ON) up.run(k);
console.log('armed:', ON.join(', '));
console.log(db.prepare("SELECT key, value FROM settings WHERE key IN (" + ON.map(() => '?').join(',') + ")").all(...ON).map(r => `${r.key}=${r.value}`).join(' '));
db.close();
