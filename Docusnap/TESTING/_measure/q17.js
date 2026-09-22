const db = require('better-sqlite3')(process.argv[2], {readonly:true});
for (const k of ['credit_note_date','delivery_date','supplier_name']) {
  const rows = db.prepare('SELECT dt.slug, f.key, f.type FROM fields f JOIN document_types dt ON dt.id=f.document_type_id WHERE f.key=?').all(k);
  rows.forEach(r => console.log(`${r.slug.padEnd(18)} ${r.key.padEnd(18)} type=${JSON.stringify(r.type)}`));
}
console.log('--- sample stored values:');
for (const r of db.prepare("SELECT e.field_key, e.display_value FROM extractions e JOIN documents d ON d.id=e.document_id WHERE e.field_key IN ('credit_note_date','delivery_date') AND d.status='needs_review' LIMIT 4").all())
  console.log('   ', r.field_key, JSON.stringify(r.display_value));
