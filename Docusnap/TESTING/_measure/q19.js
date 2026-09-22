const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const prov = learning.getFieldFormats(db, {includeProvisional:true}) || [];
const solid = learning.getFieldFormats(db) || [];
const key = f => `${String(f.supplier_name||'').toLowerCase()}|${String(f.document_type||'').toLowerCase()}|${f.field_key}`;
const solidSet = new Set(solid.map(key));
console.log('supplier_name groups — scope | distinct | confirmed_count | solid?');
for (const f of prov.filter(f=>f.field_key==='supplier_name' && f.supplier_name)) {
  const distinct = Object.keys(f.value_counts||{}).length;
  console.log(`  ${String(f.supplier_name).slice(0,26).padEnd(26)} ${String(f.document_type).padEnd(16)} distinct=${distinct} count=${f.confirmed_count} solid=${solidSet.has(key(f))}`);
}
