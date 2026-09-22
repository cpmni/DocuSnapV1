const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const fmtRows = learning.getFieldFormats(db, {includeProvisional:true}) || [];
const fmtFor = (sup, slug, key) => fmtRows.find(f => String(f.field_key)===key
  && norm(f.supplier_name)===norm(sup) && String(f.document_type||'').toLowerCase()===String(slug||'').toLowerCase());
const TYPED = new Set(['date','iban','vat_gb','currency']);   // handled by their own validators, then `continue`
const docs = db.prepare("SELECT * FROM documents WHERE status='needs_review'").all();
const exAll = db.prepare('SELECT field_key, display_value FROM extractions WHERE document_id=?');
let n=0, secondWall=0; const walls={};
for (const d of docs) {
  const v = trust.isAutoFileEligible(db, d);
  if (v.eligible || v.reason !== 'unverifiable-value:supplier_name') continue;
  n++;
  const dt = db.prepare('SELECT slug, ref_field_key, date_field_key FROM document_types WHERE id=?').get(d.document_type_id) || {};
  const ftypes = new Map(db.prepare('SELECT key, type FROM fields WHERE document_type_id=?').all(d.document_type_id).map(r=>[r.key,String(r.type||'').toLowerCase()]));
  const roleKeys = new Set(['supplier_name', dt.ref_field_key, dt.date_field_key].filter(Boolean));
  let wall = null;
  for (const r of exAll.all(d.id)) {
    const val = String(r.display_value||'').trim();
    if (!val || r.field_key==='supplier_name') continue;
    if (!ftypes.has(r.field_key)) continue;                 // foreign key → gate skips it
    if (TYPED.has(ftypes.get(r.field_key))) continue;       // own validator, then continue
    const f = fmtFor(d.supplier_name, dt.slug, r.field_key);
    const samples = f ? (f.sample_values || Object.keys(f.value_counts||{})) : null;
    if (!f) { if (roleKeys.has(r.field_key)) { wall = r.field_key + '(no-history)'; break; } continue; }
    const cls = trust.classifyLearnedShape(samples);
    if (cls === 'none') { if (roleKeys.has(r.field_key)) { wall = r.field_key + '(cls-none)'; break; } continue; }
    const isRole = roleKeys.has(r.field_key);
    const ok = isRole ? trust.valueMatchesShape(val, cls, samples)
                      : (['constant','digits','date','currency','code'].includes(cls)
                          ? trust.valueMatchesShape(val, cls, samples) : true);
    if (!ok && isRole) { wall = `${r.field_key}(${cls})`; break; }
  }
  if (wall) { secondWall++; walls[wall]=(walls[wall]||0)+1; }
}
console.log(`blocked on supplier_name       : ${n}`);
console.log(`  hit a SECOND role wall       : ${secondWall}`, Object.keys(walls).length?JSON.stringify(walls):'');
console.log(`  → released by the issuer fix : ${n - secondWall}`);
