// Render the header labels the owner will actually see, from their live test DB.
const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const need = require('C:/GIT Projects/Docusnap/database/modules/learning.js').FORMAT_SOLID_MIN;
const rows = db.prepare(`SELECT d.supplier_name supplier, dt.slug, dt.name typeName, COUNT(*) queued
  FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
  WHERE d.status='needs_review' AND TRIM(COALESCE(d.supplier_name,''))<>'' GROUP BY 1,2`).all();
const cst = db.prepare(`SELECT COUNT(*) n FROM documents WHERE status='confirmed'
  AND document_type_id=(SELECT id FROM document_types WHERE slug=?) AND LOWER(TRIM(supplier_name))=LOWER(TRIM(?))`);
const bySup = {};
for (const r of rows) {
  const confirms = cst.get(r.slug, r.supplier).n;
  const graduated = !!(trust.scopeTrust(db, r.supplier, r.slug)||{}).trusted;
  (bySup[r.supplier] = bySup[r.supplier] || []).push({ ...r, confirms, graduated, ready: graduated || confirms >= need });
}
for (const [sup, mine] of Object.entries(bySup)) {
  const pending = mine.filter(m => !m.ready);
  const queued = mine.reduce((a,m)=>a+m.queued,0);
  let label;
  if (!pending.length) label = '✓ files by itself';
  else {
    const bits = pending.map(r=>({...r,left:Math.max(1,need-r.confirms)})).sort((a,b)=>a.left-b.left)
      .map(r => mine.length>1 && r.typeName ? `${r.left} more ${r.typeName.toLowerCase()}` : `${r.left} more`);
    label = bits.length===1 ? `${bits[0]} to file by itself` : `${bits.join(' · ')} to file by themselves`;
  }
  console.log(`${sup.slice(0,30).padEnd(30)} ${String(queued).padStart(3)} queued   →  ${label}`);
}
