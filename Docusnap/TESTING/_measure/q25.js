const db = require('better-sqlite3')(process.argv[2], {readonly:true});
console.log('id | filename | status | #extraction rows | #corrections');
for (const d of db.prepare('SELECT id, original_filename, status FROM documents WHERE id BETWEEN 1 AND 12 ORDER BY id').all()) {
  const n = db.prepare('SELECT COUNT(*) n FROM extractions WHERE document_id=?').get(d.id).n;
  const c = db.prepare('SELECT COUNT(*) n FROM corrections WHERE document_id=?').get(d.id).n;
  console.log(`${String(d.id).padStart(3)} ${d.original_filename.slice(0,40).padEnd(40)} ${d.status.padEnd(10)} rows=${String(n).padStart(2)} corr=${c}`);
}
