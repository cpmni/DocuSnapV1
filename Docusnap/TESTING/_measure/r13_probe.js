const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2]); const trust=require(ROOT+'/database/modules/trust'); const learning=require(ROOT+'/database/modules/learning');
const formats=learning.getFieldFormats(db);
console.log('CONFIRMED by scope/via:');
for (const r of db.prepare("SELECT d.supplier_name s, t.slug, d.confirmed_via via, COUNT(*) n FROM documents d LEFT JOIN document_types t ON t.id=d.document_type_id WHERE d.status='confirmed' GROUP BY 1,2,3 ORDER BY 1").all()) console.log(`  ${String(r.n).padStart(3)} ${r.s}|${r.slug} via=${r.via}`);
console.log('AUDIT:'); for (const r of db.prepare("SELECT action, COUNT(*) n FROM audit_log WHERE action LIKE '%sweep%' OR action LIKE '%quiet%' OR action='reprocess' GROUP BY action").all()) console.log(`  ${r.n} ${r.action}`);
for (const sup of ['Harrowgate Timber Supplies','Veltrix Automotive Parts','Copperfield Electrical','Pelican Office Interiors']) {
  const held=db.prepare("SELECT d.*, t.slug FROM documents d LEFT JOIN document_types t ON t.id=d.document_type_id WHERE d.status='needs_review' AND d.supplier_name=? ORDER BY d.id").all(sup);
  const st=trust.scopeTrust(db,sup,held[0]?held[0].slug:'sales_order',{formats});
  console.log(`\n== ${sup}: held ${held.length}; scopeTrust ${JSON.stringify({trusted:st.trusted,reason:st.reason,confirmedCount:st.confirmedCount,corrections:st.corrections})}`);
  const reasons={}; let shown=0;
  for (const d of held){ const r=trust.isAutoFileEligible(db,d,{formats}); reasons[r.reason]=(reasons[r.reason]||0)+1;
    if (shown<2){ shown++; const ex=db.prepare("SELECT field_key, display_value, confidence, extraction_method, validation_note FROM extractions WHERE document_id=? AND field_key IN ('supplier_name','invoice_number','sales_order_number','order_date','invoice_date')").all(d.id);
      console.log(`  #${d.id} ${d.original_filename} oc=${d.overall_confidence} tpl=${d.template_id} → ${r.reason}`); for (const e of ex) console.log(`     ${e.field_key.padEnd(18)} ${String(e.display_value||'').padEnd(28)} c=${e.confidence} ${e.extraction_method||''} ${e.validation_note?'NOTE: '+e.validation_note.slice(0,90):''}`); } }
  console.log('  reasons', JSON.stringify(reasons));
}
