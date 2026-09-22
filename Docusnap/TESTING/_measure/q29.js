const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const rows = db.prepare(`SELECT d.id, d.original_filename, d.status, e.display_value, e.corrected_to, e.extraction_method, e.validation_note
  FROM documents d JOIN extractions e ON e.document_id=d.id
  WHERE e.field_key='invoice_number' AND (e.display_value LIKE 'P1%' OR e.display_value LIKE 'PL%') LIMIT 6`).all();
console.log('misread Pelican refs still stored:', rows.length);
for (const r of rows) {
  console.log(`\n${r.original_filename} [${r.status}] value=${JSON.stringify(r.display_value)}`);
  console.log(`   method=${r.extraction_method}  corrected_to=${JSON.stringify(r.corrected_to)}`);
  console.log(`   note=${String(r.validation_note||'').slice(0,90)}`);
  const t = String(db.prepare('SELECT ocr_text FROM documents WHERE id=?').get(r.id).ocr_text||'');
  const line = t.split('\n').find(l => /P[1IL]\/\d/.test(l));
  console.log(`   page reads: ${JSON.stringify((line||'').trim().slice(0,60))}`);
}
const conf = db.prepare(`SELECT e.display_value v, COUNT(*) n FROM documents d JOIN extractions e ON e.document_id=d.id
  WHERE d.status='confirmed' AND e.field_key='invoice_number' GROUP BY 1 ORDER BY n DESC LIMIT 4`).all();
console.log('\nconfirmed invoice_number samples:', conf.map(c=>`${c.v}×${c.n}`).join(', '));
