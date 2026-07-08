'use strict';
/* _live_probe.js — READ-ONLY scale probe for the live-DB identity shadow measurement.
 * Finds the live docusnap.db, counts confirmed docs + resolvable filed PDFs + gazetteer size.
 * Writes nothing. Run: ELECTRON_RUN_AS_NODE=1 electron stress_test/_live_probe.js */
const path = require('path'), fs = require('fs'), os = require('os');
const Database = require('better-sqlite3');

const cands = [
  process.env.LIVE_DB,
  path.join(os.homedir(), 'AppData', 'Roaming', 'ScanFinder', 'docusnap.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'DocuSnap', 'docusnap.db'),
  path.join(process.env.APPDATA || '', 'ScanFinder', 'docusnap.db'),
  path.join(process.env.APPDATA || '', 'DocuSnap', 'docusnap.db'),
].filter(Boolean);

console.log('Candidate DB paths:');
for (const c of cands) console.log('  ', fs.existsSync(c) ? 'FOUND ' : '  --  ', c);

const LIVE_DB = cands.find(c => fs.existsSync(c));
if (!LIVE_DB) { console.error('\nNo live DB found. Set LIVE_DB=<path>.'); process.exit(2); }

const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
const one = (sql) => { try { return db.prepare(sql).get().c; } catch (e) { return 'ERR:' + String(e.message).slice(0, 60); } };

const total = one("SELECT COUNT(*) c FROM documents WHERE status='confirmed'");
const withSup = one("SELECT COUNT(*) c FROM documents WHERE status='confirmed' AND supplier_name IS NOT NULL AND TRIM(supplier_name)<>''");
const distinctSup = one("SELECT COUNT(DISTINCT supplier_name) c FROM documents WHERE status='confirmed' AND supplier_name IS NOT NULL");
const logos = one("SELECT COUNT(*) c FROM logo_fingerprints");
const hints = one("SELECT COUNT(*) c FROM supplier_hints");
const anchors = one("SELECT COUNT(*) c FROM field_anchors");

let resolvable = 0, missing = 0;
try {
  const rows = db.prepare("SELECT working_path, stored_path FROM documents WHERE status='confirmed' AND supplier_name IS NOT NULL AND TRIM(supplier_name)<>''").all();
  for (const d of rows) {
    const ok = [d.working_path, d.stored_path].some(p => p && fs.existsSync(p));
    if (ok) resolvable++; else missing++;
  }
} catch (e) { console.error('resolve scan failed:', e.message); }

console.log('\nDB:', LIVE_DB);
console.log('confirmed docs:', total, '| with supplier:', withSup, '| resolvable filed PDF:', resolvable, '| missing file:', missing);
console.log('distinct confirmed suppliers:', distinctSup);
console.log('gazetteer -> logos:', logos, '| hints:', hints, '| anchors:', anchors);
db.close();
