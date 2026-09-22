const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const dt = db.prepare("SELECT id FROM document_types WHERE slug='credit_note'").get();
const vals = db.prepare(`SELECT e.field_key, e.display_value FROM documents d JOIN extractions e ON e.document_id=d.id
  WHERE d.status='confirmed' AND d.document_type_id=? AND LOWER(TRIM(d.supplier_name))=LOWER('Meadowvale Dairy Wholesale')
    AND e.field_key IN ('credit_note_number','supplier_name')`).all(dt.id);
const by = {};
for (const v of vals) (by[v.field_key] = by[v.field_key] || []).push(v.display_value);
for (const [k, arr] of Object.entries(by)) {
  const distinct = [...new Set(arr)];
  console.log(`${k.padEnd(20)} values=${arr.length} distinct=${distinct.length} cls=${trust.classifyLearnedShape(distinct)}  ${JSON.stringify(distinct.slice(0,3))}`);
}
console.log(`\nFORMAT_SOLID_MIN = ${learning.FORMAT_SOLID_MIN}`);
console.log('PREDICTION: one more confirmed Meadowvale credit note gives the issuer 3 values (solid)');
console.log('            AND the reference a 3rd distinct value (so it stops classifying as "constant").');
console.log('            Both walls should fall on the SAME confirm, releasing the other 17.');
