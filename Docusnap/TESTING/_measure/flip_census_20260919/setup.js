// setup.js — migrate the 700-corpus copy to HEAD + emit the test-doc id list for the flip census.
// Test docs = live+scan, learning_excluded_at STAMPED (build_warm_db.js convention). Run:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe TESTING/_measure/flip_census_20260919/setup.js
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/GIT Projects/Docusnap';
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const { runMigrations } = require(path.join(ROOT, 'database/index'));
const DIR = path.join(ROOT, 'TESTING/_measure/flip_census_20260919');
const DB = path.join(DIR, 'warm_700_mig.db');

const db = new Database(DB);
const before = db.prepare('SELECT MAX(version) v FROM migrations').get().v;
runMigrations(db);
const after = db.prepare('SELECT MAX(version) v FROM migrations').get().v;

const rows = db.prepare("SELECT id FROM documents WHERE learning_excluded_at IS NOT NULL AND status='confirmed' ORDER BY id").all();
const ids = rows.map(r => r.id);
fs.writeFileSync(path.join(DIR, 'rr_ids_700.txt'), ids.join(','));
console.log(`migrated ${before} -> ${after}`);
console.log(`test docs (learning-excluded, confirmed): ${ids.length}`);
db.close();
