const db = require('better-sqlite3')(process.argv[2], {readonly:true});
console.log('QUEUED Pelican invoice_number values (the class-fix blast radius):');
for (const r of db.prepare(`SELECT e.display_value v, d.status s, COUNT(*) n
  FROM extractions e JOIN documents d ON d.id=e.document_id
  WHERE e.field_key='invoice_number' AND d.supplier_name LIKE 'Pelican%'
    AND d.status IN ('needs_review','deferred') GROUP BY 1,2 ORDER BY 3 DESC`).all())
  console.log(`   ${String(r.v).padEnd(16)} ${r.s.padEnd(13)} ×${r.n}`);
const byPrefix = {};
for (const r of db.prepare(`SELECT e.display_value v FROM extractions e JOIN documents d ON d.id=e.document_id
  WHERE e.field_key='invoice_number' AND d.supplier_name LIKE 'Pelican%' AND d.status IN ('needs_review','deferred')`).all()) {
  const p = String(r.v||'').slice(0,2); byPrefix[p] = (byPrefix[p]||0)+1;
}
console.log('   queued by prefix:', JSON.stringify(byPrefix));
console.log('\nCONFIRMED Pelican invoice_number prefixes (the both-forms question):');
const conf = {};
for (const r of db.prepare(`SELECT e.display_value v FROM extractions e JOIN documents d ON d.id=e.document_id
  WHERE e.field_key='invoice_number' AND d.supplier_name LIKE 'Pelican%' AND d.status='confirmed'`).all()) {
  const p = String(r.v||'').slice(0,2); conf[p] = (conf[p]||0)+1;
}
console.log('  ', JSON.stringify(conf));
