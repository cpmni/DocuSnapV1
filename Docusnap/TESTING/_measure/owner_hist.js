const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2],{readonly:true});
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
console.log(tables.filter(t=>/hist|audit|correct|quiet/.test(t)).join(', '));
if (tables.includes('field_value_history')) { console.log('FIELD VALUE HISTORY (supplier_name):'); for (const r of db.prepare("SELECT document_id, field_key, old_value, new_value, source, created_at FROM field_value_history WHERE field_key='supplier_name' ORDER BY id").all()) console.log('  ',JSON.stringify(r)); }
console.log('AUDIT timeline:'); for (const r of db.prepare("SELECT id, created_at, action, document_id, substr(details,1,200) m FROM audit_log WHERE action IN ('import_run','reprocess','review_confirmed','quiet_reprocess_job','scope_sweep_auto_accepted','scope_sweep_offered','supplier_resolved','field_updated') ORDER BY id").all()) console.log(`  ${r.id} ${r.created_at} ${r.action} doc=${r.document_id} ${r.m||''}`);
console.log('DOCS:'); for (const r of db.prepare("SELECT id, original_filename, status, supplier_name, template_id, overall_confidence, processed_at, confirmed_at FROM documents ORDER BY id").all()) console.log('  ',JSON.stringify(r));
