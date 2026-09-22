const db = require('better-sqlite3')(process.argv[2], {readonly:true});
console.log('docs total:', db.prepare('SELECT COUNT(*) n FROM documents').get().n);
for (const r of db.prepare("SELECT status, COUNT(*) n FROM documents GROUP BY status").all()) console.log(' ', r.status, r.n);
console.log('sample filenames:');
for (const r of db.prepare('SELECT original_filename FROM documents LIMIT 5').all()) console.log('  ', JSON.stringify(r.original_filename));
