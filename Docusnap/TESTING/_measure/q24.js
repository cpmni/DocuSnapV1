const db = require('better-sqlite3')(process.argv[2], {readonly:true});
for (const id of [7, 89]) {
  const d = db.prepare('SELECT original_filename, supplier_name, template_id FROM documents WHERE id=?').get(id);
  console.log(`\n=== doc ${id} ${d.original_filename} supplier_col=${JSON.stringify(d.supplier_name)} tpl=${d.template_id}`);
  for (const e of db.prepare('SELECT field_key, display_value, extraction_method FROM extractions WHERE document_id=?').all(id))
    console.log(`   ${e.field_key.padEnd(18)} ${JSON.stringify(String(e.display_value).slice(0,30))} ${e.extraction_method}`);
}
// how many of the 10 TEACH docs (ids 1-10) lack a supplier_name row?
const missing = db.prepare(`SELECT d.id, d.original_filename FROM documents d
  WHERE d.id BETWEEN 1 AND 10 AND NOT EXISTS (SELECT 1 FROM extractions e WHERE e.document_id=d.id AND e.field_key='supplier_name')`).all();
console.log(`\nteach docs (ids 1-10) with NO supplier_name row: ${missing.length}/10`);
missing.forEach(m=>console.log('   ', m.id, m.original_filename));
