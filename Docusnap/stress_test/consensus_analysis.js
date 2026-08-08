'use strict';
// Offline analysis of the RR_CONSENSUS dump (overnight P1). Answers: does a multi-read consensus
// (a critical value corroborated by a 2nd independent read = the page OCR) let MORE docs auto-file,
// and is it M-SAFE (does the naive "value witnessed in page OCR -> trust" signal ever lift a WRONG
// value)? Read-only. Usage: node consensus_analysis.js [dump.jsonl]
const path = require('path'), fs = require('fs');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const DUMP = process.argv[2] || path.join(REPO, 'stress_test', 'out', 'rr_consensus.jsonl');
const db = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });
const ocrById = {}; for (const r of db.prepare('SELECT id, ocr_text FROM documents').all()) ocrById[r.id] = r.ocr_text || '';
db.close();

const alnum = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = s => String(s || '').replace(/[^0-9]/g, '');
const refWit = (v, o) => { const c = alnum(v); return c.length >= 4 ? alnum(o).includes(c) : null; };
const dateWit = (v, o) => { const d = digits(v); if (d.length !== 8) return null; const dd = d.slice(0, 2), mm = d.slice(2, 4), y = d.slice(4), t = digits(o); return [dd + mm + y, mm + dd + y, y + mm + dd, y + dd + mm].some(x => t.includes(x)); };

const rows = fs.readFileSync(DUMP, 'utf8').split('\n').filter(x => x.trim()).map(x => JSON.parse(x));
let filed = 0, held = 0; const reason = {};
let liftCand = 0, liftSafe = 0, liftM = 0; const mDocs = [], safeDocs = [];
let mWitnessed = 0;                       // of current WRONG auto-files, how many are self-witnessed
for (const r of rows) {
  const o = ocrById[r.id] || '';
  const fields = [r.ref && { ...r.ref, isDate: false }, r.date && { ...r.date, isDate: true }].filter(Boolean);
  for (const f of fields) f.wit = f.isDate ? dateWit(f.val, o) : refWit(f.val, o);
  if (r.wouldFile) {
    filed++;
    for (const f of fields) if (f.correct === false && f.wit === true) mWitnessed++;
    continue;
  }
  held++; reason[r.reason] = (reason[r.reason] || 0) + 1;
  const wc = /weak-critical-field:(\S+)/.exec(r.reason || '');
  if (wc) {
    const k = wc[1]; const f = fields.find(x => x.key === k);
    if (f && f.wit === true && f.correct != null) {
      liftCand++;
      if (f.correct) { liftSafe++; safeDocs.push(`#${r.id} ${r.type} ${k}="${f.val}" conf${f.conf} witnessed+correct`); }
      else { liftM++; mDocs.push(`#${r.id} ${r.type} ${k}="${f.val}" conf${f.conf} witnessed but WRONG`); }
    }
  }
}
console.log(`docs=${rows.length}  filed(auto)=${filed}  held=${held}`);
console.log('held by reason:', JSON.stringify(reason));
console.log(`\nNAIVE CONSENSUS-LIFT (held by weak-critical-field, that value WITNESSED in page OCR -> trust it):`);
console.log(`  candidates=${liftCand}  SAFE(correct)=${liftSafe}  WRONG(would RAISE M)=${liftM}`);
console.log(`\nM-SAFETY of naive membership: current wrong auto-files whose wrong critical value is SELF-WITNESSED in the page OCR = ${mWitnessed}`);
console.log(`  (a self-witnessed misread is why naive membership is NOT auto-file-safe — cross-tier agreement is the real signal.)`);
console.log('\nWRONG lift candidates (naive membership would raise M by these):');
for (const d of mDocs.slice(0, 25)) console.log('  ' + d);
console.log('\nSAFE lift candidates (sample):');
for (const d of safeDocs.slice(0, 15)) console.log('  ' + d);
