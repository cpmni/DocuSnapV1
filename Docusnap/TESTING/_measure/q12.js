// Value-level check for the wave-1 docs the counterfactual would have auto-filed: does the
// committed REFERENCE actually appear on the page (sepless, case-folded)? A ref that is not
// printed on its own page is the signature of a misread that would ride into the FILENAME.
const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const sep = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const reprocessed = new Set(db.prepare("SELECT DISTINCT document_id FROM audit_log WHERE action='reprocess' AND document_id IS NOT NULL").all().map(r=>r.document_id));
const rows = db.prepare(`SELECT d.id, d.original_filename, d.ocr_text, d.reference_number, d.doc_date, dt.ref_field_key
  FROM documents d LEFT JOIN document_types dt ON dt.id=d.document_type_id WHERE d.id BETWEEN 11 AND 210`).all();
let checked=0, refMissing=0, noRef=0, dateMissing=0;
const bad=[];
for (const r of rows) {
  if (reprocessed.has(r.id)) continue;
  checked++;
  const ref = String(r.reference_number||'').trim();
  if (!ref) { noRef++; continue; }
  const page = sep(r.ocr_text);
  if (!page.includes(sep(ref))) { refMissing++; bad.push(`${r.original_filename}  ref="${ref}" NOT on page`); }
  const d = String(r.doc_date||'').trim();           // DD-MM-YYYY — check the digits appear
  if (d) { const digits = d.replace(/[^0-9]/g,''); if (!page.includes(digits) && !page.includes(digits.slice(0,4))) dateMissing++; }
}
console.log(`eligible wave-1 docs checked : ${checked}`);
console.log(`  reference NOT found on page: ${refMissing}   (${checked?(100*refMissing/checked).toFixed(1):0}%)`);
console.log(`  no reference captured      : ${noRef}`);
console.log(`  date digits not on page    : ${dateMissing}  (weak proxy — formats vary)`);
bad.slice(0,15).forEach(b=>console.log('   ',b));
