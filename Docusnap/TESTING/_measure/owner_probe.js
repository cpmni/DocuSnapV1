const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2]); const trust=require(ROOT+'/database/modules/trust'); const learning=require(ROOT+'/database/modules/learning');
const formats=learning.getFieldFormats(db);
console.log('DOCS by status/supplier/via:'); for (const r of db.prepare("SELECT status, supplier_name s, confirmed_via via, COUNT(*) n FROM documents GROUP BY 1,2,3").all()) console.log('  ',JSON.stringify(r));
console.log('TEMPLATES:'); for (const r of db.prepare("SELECT id,name,document_type_slug,confirmed_count FROM templates").all()) console.log('  ',JSON.stringify(r));
console.log('FIXED:'); for (const r of db.prepare("SELECT template_id, field_key, fixed_value, fixed_source FROM template_fields WHERE field_key='supplier_name'").all()) console.log('  ',JSON.stringify(r));
console.log('FORMATS:'); for (const f of formats) console.log(`   ${f.supplier_name}|${f.document_type}|${f.field_key} distinct=${(f.sample_values||[]).length} conf=${f.confirmed_count}`);
console.log('AUDIT:'); for (const r of db.prepare("SELECT action, COUNT(*) n FROM audit_log WHERE action LIKE '%sweep%' OR action LIKE '%quiet%' OR action IN ('reprocess','review_confirmed') GROUP BY action").all()) console.log('  ',JSON.stringify(r));
const held=db.prepare("SELECT d.*, t.slug FROM documents d LEFT JOIN document_types t ON t.id=d.document_type_id WHERE d.status='needs_review' ORDER BY d.id").all();
for (const d of held){ const r=trust.isAutoFileEligible(db,d,{formats});
  console.log(`\n#${d.id} ${d.original_filename} oc=${d.overall_confidence} tpl=${d.template_id} sup='${d.supplier_name}' logo=${d.logo_phash?'y':'-'} → ${r.reason}`);
  for (const e of db.prepare("SELECT field_key, display_value, confidence, extraction_method, validation_note FROM extractions WHERE document_id=? ORDER BY field_key").all(d.id)) console.log(`     ${e.field_key.padEnd(18)} ${String(e.display_value||'').padEnd(24).slice(0,24)} c=${String(e.confidence).padStart(3)} ${(e.extraction_method||'').padEnd(30)} ${e.validation_note?'NOTE: '+e.validation_note.slice(0,110):''}`); }
const st=trust.scopeTrust(db,'DOCUMENT SOLUTIONS','service_worksheet',{formats}); console.log('\nscopeTrust', JSON.stringify({trusted:st.trusted,reason:st.reason,confirmedCount:st.confirmedCount,corrections:st.corrections}));
