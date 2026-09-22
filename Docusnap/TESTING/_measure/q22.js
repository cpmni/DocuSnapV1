const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const dt = db.prepare("SELECT id FROM document_types WHERE slug='credit_note'").get();
console.log('Meadowvale credit_note confirmed docs:', db.prepare(
  "SELECT COUNT(*) n FROM documents WHERE status='confirmed' AND document_type_id=? AND LOWER(TRIM(supplier_name))=LOWER('Meadowvale Dairy Wholesale')").get(dt.id).n);
console.log('confirmed_via breakdown:');
for (const r of db.prepare("SELECT COALESCE(confirmed_via,'(human)') v, COUNT(*) n FROM documents WHERE status='confirmed' AND document_type_id=? AND LOWER(TRIM(supplier_name))=LOWER('Meadowvale Dairy Wholesale') GROUP BY 1").all(dt.id)) console.log('   ', r.v, r.n);
const g = (learning.getFieldFormats(db)||[]).filter(f=>f.field_key==='supplier_name' && /meadowvale/i.test(f.supplier_name||''));
const gp = (learning.getFieldFormats(db,{includeProvisional:true})||[]).filter(f=>f.field_key==='supplier_name' && /meadowvale/i.test(f.supplier_name||''));
console.log('solid groups:', g.length, '| provisional-inclusive:', gp.length);
gp.forEach(f=>console.log('   ', f.document_type, 'count=', f.confirmed_count, 'distinct=', Object.keys(f.value_counts||{}).length, 'provisional=', !!f.provisional));
