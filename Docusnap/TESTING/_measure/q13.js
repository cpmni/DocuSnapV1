const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const docs = db.prepare("SELECT * FROM documents WHERE status='needs_review'").all();
let blocked = 0, hasTpl = 0, frozenMatches = 0, methodFixed = 0;
const ex = db.prepare("SELECT display_value, extraction_method FROM extractions WHERE document_id=? AND field_key='supplier_name'");
const tf = db.prepare("SELECT fixed_value FROM template_fields WHERE template_id=? AND field_key='supplier_name'");
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
for (const d of docs) {
  const v = trust.isAutoFileEligible(db, d);
  if (v.eligible || v.reason !== 'unverifiable-value:supplier_name') continue;
  blocked++;
  if (!d.template_id) continue;
  hasTpl++;
  const row = ex.get(d.id) || {};
  const frozen = (tf.get(d.template_id) || {}).fixed_value;
  if (frozen && norm(frozen) === norm(row.display_value)) frozenMatches++;
  if (String(row.extraction_method||'').includes('template_fixed')) methodFixed++;
}
console.log(`blocked by unverifiable-value:supplier_name : ${blocked}`);
console.log(`  ...with a MATCHED template                : ${hasTpl}`);
console.log(`  ...whose issuer == the template's FROZEN value (what the human taught): ${frozenMatches}`);
console.log(`  ...whose issuer method is template_fixed* : ${methodFixed}`);
