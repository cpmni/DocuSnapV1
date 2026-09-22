const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const fmts = learning.getFieldFormats(db, {includeProvisional:true}) || [];
// Which scopes have a learned FORMAT for supplier_name at all?
const sup = fmts.filter(f => f.field_key === 'supplier_name');
console.log('learned-format rows total:', fmts.length, '| for supplier_name:', sup.length);
sup.slice(0,8).forEach(f => console.log('   ', JSON.stringify(f.supplier_name), f.document_type, 'distinct=', Object.keys(f.value_counts||{}).length));
// how many confirms per scope, and is the scope graduated?
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const scopes = db.prepare(`SELECT supplier_name, dt.slug, COUNT(*) n FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
   WHERE d.status='confirmed' GROUP BY 1,2 ORDER BY n DESC`).all();
console.log('\nscope, confirms, graduated?, has supplier_name format?');
for (const s of scopes.slice(0,10)) {
  const t = trust.scopeTrust(db, s.supplier_name, s.slug);
  const has = sup.some(f => String(f.supplier_name||'').toLowerCase()===String(s.supplier_name||'').toLowerCase() && String(f.document_type||'').toLowerCase()===String(s.slug||'').toLowerCase());
  console.log(`  ${String(s.supplier_name).slice(0,28).padEnd(28)} ${String(s.n).padStart(3)}  trusted=${t.trusted} floor=${t.floor}  supFormat=${has}`);
}
