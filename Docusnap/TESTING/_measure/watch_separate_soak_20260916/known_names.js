'use strict';
// known_names.js DB [minConfirms] [outJson] — the mig-179 ADMISSION cell (Oracle C4/C5 (a)): print the known-supplier
// population exactly as the SHIPPED reader returns it (learning.getKnownSupplierNames), optionally to a JSON file the
// census (seg_census3.py) feeds to the SHIPPED prepare_known_suppliers. Read-only.
// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe TESTING/_measure/watch_separate_soak_20260916/known_names.js <db> 3 out.json
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
const db = new Database(process.argv[2], { readonly: true });
const minConfirms = Number(process.argv[3] || 3);
const names = learning.getKnownSupplierNames(db, { minConfirms });
console.log(`${names.length} known supplier names at minConfirms ${minConfirms}:`);
for (const n of names) console.log('  ' + n);
if (process.argv[4]) { fs.writeFileSync(process.argv[4], JSON.stringify(names)); console.log(`written ${process.argv[4]}`); }
