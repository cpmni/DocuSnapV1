const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const rows = db.prepare(`SELECT d.id, d.original_filename, d.reference_number, e.field_key, e.display_value, e.confidence, e.extraction_method, e.validation_note
  FROM documents d JOIN extractions e ON e.document_id = d.id
  WHERE e.validation_note LIKE '%doesn''t appear on this page as written%'`).all();
console.log('flagged rows:', rows.length);
for (const r of rows.slice(0, 10)) console.log(JSON.stringify(r));
// pull ocr_text around the value for the first 3
for (const r of rows.slice(0, 3)) {
  const doc = db.prepare('SELECT ocr_text FROM documents WHERE id=?').get(r.id);
  const t = String(doc.ocr_text || '');
  const val = String(r.display_value || '');
  const stem = val.replace(/[^A-Za-z0-9]/g, '').slice(0, 5);
  const i = t.replace(/[^A-Za-z0-9]/g, '').indexOf(val.replace(/[^A-Za-z0-9]/g, ''));
  console.log('--- doc', r.id, r.original_filename, 'value:', JSON.stringify(val), 'seplessFoundAt:', i);
  // show raw text neighborhood by searching the first 4 chars
  const j = t.indexOf(stem.slice(0, 4));
  console.log('rawCtx:', JSON.stringify(t.slice(Math.max(0, j - 60), j + 80)));
}
