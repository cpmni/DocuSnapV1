// Preview the headers using the CORRECTED rule (format-truth, not raw doc counts).
const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const need = learning.FORMAT_SOLID_MIN;
const k = (s,d)=>`${String(s).toLowerCase().trim()}|${String(d).toLowerCase().trim()}`;
const solid = new Set((learning.getFieldFormats(db)||[]).filter(f=>f.field_key==='supplier_name'&&String(f.supplier_name||'').trim()).map(f=>k(f.supplier_name,f.document_type)));
const counts = new Map((learning.getFieldFormats(db,{includeProvisional:true})||[]).filter(f=>f.field_key==='supplier_name'&&String(f.supplier_name||'').trim()).map(f=>[k(f.supplier_name,f.document_type),Number(f.confirmed_count)||0]));
const rows = db.prepare(`SELECT d.supplier_name supplier, dt.slug, dt.name typeName, COUNT(*) queued FROM documents d JOIN document_types dt ON dt.id=d.document_type_id WHERE d.status='needs_review' AND TRIM(COALESCE(d.supplier_name,''))<>'' GROUP BY 1,2`).all();
const bySup={};
for (const r of rows) {
  const key=k(r.supplier,r.slug);
  let grad=false; try{grad=!!(trust.scopeTrust(db,r.supplier,r.slug)||{}).trusted;}catch{}
  (bySup[r.supplier]=bySup[r.supplier]||[]).push({...r,confirms:counts.get(key)||0,needed:need,ready:grad||solid.has(key)});
}
for (const [sup,mine] of Object.entries(bySup)) {
  const pending=mine.filter(m=>!m.ready), queued=mine.reduce((a,m)=>a+m.queued,0);
  let label;
  if (!pending.length) label='✓ files by itself';
  else { const bits=pending.map(r=>({...r,left:Math.max(1,r.needed-r.confirms)})).sort((a,b)=>a.left-b.left)
      .map(r=>mine.length>1&&r.typeName?`${r.left} more ${r.typeName.toLowerCase()}`:`${r.left} more`);
    label = bits.length===1?`${bits[0]} to file by itself`:`${bits.join(' · ')} to file by themselves`; }
  console.log(`${sup.slice(0,30).padEnd(30)} ${String(queued).padStart(3)} queued  →  ${label}`);
}
