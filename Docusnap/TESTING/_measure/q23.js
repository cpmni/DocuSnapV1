const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const dt = db.prepare("SELECT id FROM document_types WHERE slug='credit_note'").get();
const docs = db.prepare("SELECT id, original_filename, confirmed_via, status FROM documents WHERE status='confirmed' AND document_type_id=? AND LOWER(TRIM(supplier_name))=LOWER('Meadowvale Dairy Wholesale')").all(dt.id);
for (const d of docs) {
  const e = db.prepare("SELECT display_value, corrected_to, extraction_method FROM extractions WHERE document_id=? AND field_key='supplier_name'").get(d.id);
  const c = db.prepare("SELECT corrected_value FROM corrections WHERE document_id=? AND field_key='supplier_name'").get(d.id);
  console.log(`${String(d.id).padStart(4)} ${d.original_filename.slice(0,42).padEnd(42)} via=${d.confirmed_via||'human'}`);
  console.log(`      extraction: ${e ? JSON.stringify(e.display_value) + ' method=' + e.extraction_method : 'NO supplier_name ROW'}`);
  if (c) console.log(`      correction: ${JSON.stringify(c.corrected_value)}`);
}
