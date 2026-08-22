const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const T=require(ROOT+'/database/modules/templates');
const db=new Database(process.argv[2],{readonly:true});
const tpls=db.prepare("SELECT id, name, document_type_slug FROM templates").all();
const held=db.prepare("SELECT id, original_filename, status, supplier_name, template_id, ocr_text FROM documents WHERE status IN ('needs_review','confirmed') ORDER BY id").all();
for (const t of tpls) {
  let n=0, nn=0; const sel=[];
  for (const d of held) { if (!d.ocr_text) continue; const m=T.findByKeywordFingerprint(db, d.ocr_text, 75, t.document_type_slug); const mid = m ? (m.id ?? m.template_id ?? (m.template && m.template.id)) : null; const hit = mid===t.id; if (!d.template_id) { nn++; if (hit) n++; } if (process.argv[3]==='detail') console.log(`   #${d.id} ${d.status.padEnd(12)} tpl=${d.template_id} kw=${m?(m.id??m.template_id??(m.template&&m.template.id))+'@'+m.confidence:'-'} ${d.original_filename}`); if (hit && !d.template_id) sel.push(d.id); }
  console.log(`TEMPLATE ${t.id} "${t.name}": template-less docs=${nn} keyword-selected(>=75)=${n} (${nn?Math.round(100*n/nn):0}%) ${sel.slice(0,20).join(',')}`);
}
