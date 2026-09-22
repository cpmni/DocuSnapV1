const db = require('better-sqlite3')(process.argv[2], {readonly:true});
for (const id of [337, 204, 191]) {
  const d = db.prepare('SELECT original_filename, ocr_text FROM documents WHERE id=?').get(id);
  const t = String(d.ocr_text || '');
  console.log('=== doc', id, d.original_filename, 'len', t.length);
  // show every line containing digits that could be the ref
  const lines = t.split('\n');
  for (const [i, ln] of lines.entries()) {
    if (/(9910|22033|74238|Invoice No|Order No|Sales Order|Invoice Number)/i.test(ln))
      console.log(`  L${i}: ${JSON.stringify(ln)}`);
  }
}
