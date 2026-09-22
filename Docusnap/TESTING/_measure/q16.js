// For each doc blocked on supplier_name: if the issuer check passed, what would block NEXT?
// Re-walks the same verifiability rule over the doc's OTHER valued fields using trust's own
// exported helpers, and checks which evidence route (a) dominant literal / (b) taught frozen
// value would satisfy the issuer.
const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const fmtRows = learning.getFieldFormats(db, {includeProvisional:true}) || [];
const fmtFor = (sup, slug, key) => fmtRows.find(f =>
  String(f.field_key)===key && norm(f.supplier_name)===norm(sup) && String(f.document_type||'').toLowerCase()===String(slug||'').toLowerCase());
const docs = db.prepare("SELECT * FROM documents WHERE status='needs_review'").all();
const exAll = db.prepare('SELECT field_key, display_value, validation_note FROM extractions WHERE document_id=?');
const tf = db.prepare("SELECT fixed_value FROM template_fields WHERE template_id=? AND field_key='supplier_name'");
let n=0, routeA=0, routeB=0, secondWall=0; const walls={};
for (const d of docs) {
  const v = trust.isAutoFileEligible(db, d);
  if (v.eligible || v.reason !== 'unverifiable-value:supplier_name') continue;
  n++;
  const dt = db.prepare('SELECT slug, ref_field_key, date_field_key FROM document_types WHERE id=?').get(d.document_type_id) || {};
  const rows = exAll.all(d.id);
  const issuer = (rows.find(r=>r.field_key==='supplier_name')||{}).display_value;
  // route (a): dominant confirmed literal for this scope
  const confVals = db.prepare(`SELECT e.display_value val, COUNT(*) c FROM documents dd JOIN extractions e ON e.document_id=dd.id
      WHERE dd.status='confirmed' AND dd.document_type_id=? AND LOWER(TRIM(dd.supplier_name))=LOWER(TRIM(?))
        AND e.field_key='supplier_name' AND TRIM(COALESCE(e.display_value,''))<>'' GROUP BY 1 ORDER BY c DESC`).all(d.document_type_id, d.supplier_name);
  if (confVals.length && norm(confVals[0].val) === norm(issuer)) routeA++;
  const frozen = d.template_id ? (tf.get(d.template_id)||{}).fixed_value : null;
  if (frozen && norm(frozen) === norm(issuer)) routeB++;
  // second wall: any OTHER valued field that would fail the same rule
  const roleKeys = new Set(['supplier_name', dt.ref_field_key, dt.date_field_key].filter(Boolean));
  let wall = null;
  for (const r of rows) {
    if (r.field_key==='supplier_name' || !String(r.display_value||'').trim()) continue;
    const f = fmtFor(d.supplier_name, dt.slug, r.field_key);
    if (!f) continue;                                  // no history → the gate's own !f branch
    const cls = trust.classifyLearnedShape ? trust.classifyLearnedShape(f.sample_values || Object.keys(f.value_counts||{})) : null;
    if (!cls) continue;
    const ok = trust.valueMatchesShape(r.display_value, cls, f.sample_values || Object.keys(f.value_counts||{}));
    if (!ok && roleKeys.has(r.field_key)) { wall = r.field_key; break; }
  }
  if (wall) { secondWall++; walls[wall]=(walls[wall]||0)+1; }
}
console.log(`blocked on supplier_name            : ${n}`);
console.log(`  satisfied by (a) dominant literal : ${routeA}`);
console.log(`  satisfied by (b) taught frozen    : ${routeB}`);
console.log(`  would hit a SECOND role wall      : ${secondWall}`, Object.keys(walls).length?JSON.stringify(walls):'');
console.log(`  → would become filable            : ${n - secondWall}`);
