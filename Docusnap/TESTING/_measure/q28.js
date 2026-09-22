const db = require('better-sqlite3')(process.argv[2], {readonly:true});
for (const r of db.prepare(`SELECT status, COALESCE(confirmed_via,'(human)') via, COUNT(*) n FROM documents
   WHERE LOWER(TRIM(supplier_name))=LOWER('Meadowvale Dairy Wholesale') GROUP BY 1,2 ORDER BY 3 DESC`).all())
  console.log(`   ${r.status.padEnd(12)} via=${String(r.via).padEnd(18)} ${r.n}`);
const g = (require('C:/GIT Projects/Docusnap/database/modules/learning.js').getFieldFormats(db)||[])
  .filter(f=>/meadowvale/i.test(f.supplier_name||''));
console.log('   solid learned groups for Meadowvale now:', g.map(f=>f.field_key).join(', ') || '(none)');
