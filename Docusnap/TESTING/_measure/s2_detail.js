const path=require('path');
const ROOT='C:/GIT Projects/Docusnap';
const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2]);
const learning=require(ROOT+'/database/modules/learning'); const trust=require(ROOT+'/database/modules/trust');
const formats=learning.getFieldFormats(db,{includeProvisional:true});
console.log('FORMAT GROUPS (what learning knows):');
for (const f of formats) console.log(`  ${f.supplier_name}|${f.document_type}|${f.field_key} distinct=${(f.sample_values||[]).length} confirmed=${f.confirmed_count} provisional=${!!f.provisional} samples=${JSON.stringify((f.sample_values||[]).slice(0,4))}`);
const docs=db.prepare("SELECT d.*, t.slug FROM documents d LEFT JOIN document_types t ON t.id=d.document_type_id WHERE d.status='needs_review' ORDER BY d.id").all();
for (const d of docs){
  const r=trust.isAutoFileEligible(db,d,{formats});
  const st=trust.scopeTrust(db,d.supplier_name,d.slug,{formats});
  console.log(`\n#${d.id} ${d.original_filename} | ${d.supplier_name}|${d.slug} overall=${d.overall_confidence} → ${r.reason} floor=${r.floor} scopeTrust=${JSON.stringify({trusted:st.trusted,reason:st.reason,confirmedCount:st.confirmedCount,corrections:st.corrections})}`);
  const fields=d.document_type_id?db.prepare('SELECT key,required FROM fields WHERE document_type_id=? AND enabled=1').all(d.document_type_id):[];
  const req=fields.filter(f=>f.required).map(f=>f.key);
  for (const e of db.prepare('SELECT field_key,display_value,confidence,validation_note,extraction_method FROM extractions WHERE document_id=? ORDER BY field_key').all(d.id))
    if (req.includes(e.field_key)) console.log(`   ${req.includes(e.field_key)?'*':' '} ${e.field_key.padEnd(16)} ${String(e.display_value||'').padEnd(30).slice(0,30)} c=${String(e.confidence).padStart(3)} ${e.extraction_method||''} ${e.validation_note?'NOTE: '+e.validation_note.slice(0,70):''}`);
}
