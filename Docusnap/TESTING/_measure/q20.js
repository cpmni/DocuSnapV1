const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const docs = db.prepare("SELECT * FROM documents WHERE original_filename LIKE 'Oakhaven%delivery_note_001%' AND status='needs_review'").all();
for (const d of docs) {
  console.log(`\n=== ${d.original_filename} (id ${d.id}) conf=${d.overall_confidence} type_id=${d.document_type_id}`);
  const fields = new Set(db.prepare('SELECT key FROM fields WHERE document_type_id=?').all(d.document_type_id).map(r=>r.key));
  console.log('   type fields:', [...fields].join(', '));
  for (const e of db.prepare('SELECT field_key, display_value, confidence, extraction_method, validation_note, corrected_to FROM extractions WHERE document_id=?').all(d.id)) {
    const shown = fields.has(e.field_key) ? 'VISIBLE' : '*** NOT IN TYPE (invisible in Review) ***';
    console.log(`   ${e.field_key.padEnd(18)} ${String(e.display_value).slice(0,28).padEnd(28)} c=${e.confidence} ${shown}`);
    if (e.validation_note) console.log(`        NOTE: ${e.validation_note}`);
    if (e.corrected_to) console.log(`        corrected_to: ${e.corrected_to}`);
  }
}
