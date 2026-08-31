const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2]); const learning=require(ROOT+'/database/modules/learning');
const f=learning.getFieldFormats(db,{includeProvisional:true}).filter(x=>/veltrix|harrowgate/i.test(x.supplier_name||''));
for (const g of f) console.log(`${g.supplier_name}|${g.document_type}|${g.field_key} distinct=${(g.sample_values||[]).length} confirmed=${g.confirmed_count} provisional=${!!g.provisional} samples=${JSON.stringify((g.sample_values||[]).slice(0,5))}`);
console.log('--- Veltrix confirmed docs: sales_order_number rows');
for (const r of db.prepare("SELECT d.id, d.confirmed_via, e.display_value, e.extraction_method, e.was_corrected, e.corrected_to FROM documents d LEFT JOIN extractions e ON e.document_id=d.id AND e.field_key='sales_order_number' WHERE d.status='confirmed' AND d.supplier_name='Veltrix Automotive Parts' ORDER BY d.id").all()) console.log('  ',JSON.stringify(r));
console.log('--- settings'); for (const r of db.prepare("SELECT key,value FROM settings WHERE key IN ('graduation_window','learning_exclude_machine_confirms','confirm_persist_values','format_corrections_dedupe','learning_exclude_rewrite_markers')").all()) console.log('  ',r.key,'=',r.value);
console.log('--- corrections for Veltrix'); for (const r of db.prepare("SELECT field_key, original_value, corrected_value FROM corrections WHERE supplier_name='Veltrix Automotive Parts'").all()) console.log('  ',JSON.stringify(r));
