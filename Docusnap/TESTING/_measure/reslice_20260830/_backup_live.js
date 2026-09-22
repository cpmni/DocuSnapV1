// Back up the LIVE DB with better-sqlite3's online backup API (never a file copy).
// Run: ELECTRON_RUN_AS_NODE=1 node_modules\.bin\electron  tmp\_backup_live.js <dest>
const path = require('path');
const Database = require('c:/GIT Projects/Docusnap/node_modules/better-sqlite3');
const src = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const dest = process.argv[2];
if (!dest) { console.log('usage: _backup_live.js <dest>'); process.exit(2); }
const db = new Database(src, { readonly: true, fileMustExist: true });
db.backup(dest).then(() => {
  const d2 = new Database(dest, { readonly: true });
  const n = d2.prepare("SELECT COUNT(*) c FROM documents WHERE status='confirmed'").get().c;
  const m = d2.prepare('SELECT MAX(version) v FROM migrations').get().v;
  console.log(`backup ok -> ${dest}; confirmed docs=${n}; migration=${m}`);
  d2.close(); db.close();
}).catch(e => { console.log('backup FAILED', e.message); process.exit(1); });
