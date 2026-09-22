const db = require('better-sqlite3')(process.argv[2], {readonly:true});
console.log('cols:', db.prepare('PRAGMA table_info(documents)').all().map(c=>c.name).join(','));
const rows = db.prepare('SELECT id, original_filename FROM documents ORDER BY id').all();
console.log('n=',rows.length,'ids',rows[0].id,'..',rows[rows.length-1].id);
console.log('id 1-12:'); rows.slice(0,12).forEach(r=>console.log('  ',r.id,r.original_filename));
console.log('around 210:'); rows.filter(r=>r.id>=208&&r.id<=214).forEach(r=>console.log('  ',r.id,r.original_filename));
