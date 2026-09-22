const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const d = db.prepare('SELECT ocr_text FROM documents WHERE id=191').get();
const t = String(d.ocr_text||'');
for (const [i, ln] of t.split('\n').entries()) if (/74238|ORD|SB/i.test(ln)) console.log(`L${i}: ${JSON.stringify(ln)}`);
console.log('--- card3 credit note:');
const cn = db.prepare("SELECT id, original_filename FROM documents WHERE original_filename LIKE '%credit_note_0050%'").get();
if (cn) {
  for (const r of db.prepare('SELECT field_key, display_value, confidence, extraction_method, validation_note, corrected_to FROM extractions WHERE document_id=?').all(cn.id))
    console.log(JSON.stringify(r));
  const ct = String(db.prepare('SELECT ocr_text FROM documents WHERE id=?').get(cn.id).ocr_text||'');
  for (const [i, ln] of ct.split('\n').entries()) if (/428|514|85|540|total|vat/i.test(ln)) console.log(`L${i}: ${JSON.stringify(ln)}`);
}
