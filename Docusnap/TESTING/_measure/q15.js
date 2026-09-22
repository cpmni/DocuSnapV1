const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const fac = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const fmts = learning.getFieldFormats(db, {includeProvisional:true}) || [];
const sup = fmts.filter(f => f.field_key==='supplier_name' && f.supplier_name);
for (const f of sup.slice(0,6)) {
  const vals = Object.keys(f.value_counts||{});
  console.log(JSON.stringify(f.supplier_name), f.document_type, 'samples=', JSON.stringify((f.sample_values||vals).slice(0,2)));
}
console.log('\n--- what class does the trust gate assign these? (valueMatchesShape on the name)');
console.log('exported helpers:', Object.keys(fac).filter(k=>/shape|class|scopeFormats/i.test(k)).join(', '));
