const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const rows = db.prepare(`SELECT d.id, d.original_filename, e.field_key, e.display_value, e.confidence, e.extraction_method, e.validation_note
  FROM documents d JOIN extractions e ON e.document_id = d.id
  WHERE e.validation_note LIKE '%doesn''t appear on this page as written%' AND d.status='needs_review'`).all();
console.log('currently flagged:', rows.length);
for (const r of rows) console.log(r.id, r.original_filename, JSON.stringify(r.display_value), r.confidence, r.extraction_method);
for (const r of rows) {
  const t = String(db.prepare('SELECT ocr_text FROM documents WHERE id=?').get(r.id).ocr_text || '');
  const val = String(r.display_value||'');
  const stem = val.replace(/[^A-Za-z0-9]/g,'').slice(0,4);
  console.log('=== doc', r.id, val, 'pagelen', t.length);
  for (const [i, ln] of t.split('\n').entries()) {
    const lnStem = ln.replace(/[^A-Za-z0-9]/g,'');
    if (lnStem.includes(stem) || /Order No|Invoice Number|SALES ORDER/i.test(ln)) console.log(`  L${i}: ${JSON.stringify(ln)}`);
  }
}
