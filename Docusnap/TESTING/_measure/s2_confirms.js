const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2]);
console.log('CONFIRMED by scope/via:');
for (const r of db.prepare("SELECT d.supplier_name s, t.slug, d.confirmed_via via, COUNT(*) n FROM documents d LEFT JOIN document_types t ON t.id=d.document_type_id WHERE d.status='confirmed' GROUP BY 1,2,3 ORDER BY n DESC").all()) console.log(`  ${String(r.n).padStart(3)} ${r.s}|${r.slug} via=${r.via}`);
console.log('AUDIT actions:'); for (const r of db.prepare("SELECT action, COUNT(*) n FROM audit_log GROUP BY action ORDER BY n DESC LIMIT 15").all()) console.log(`  ${String(r.n).padStart(4)} ${r.action}`);
console.log('TEMPLATES:', db.prepare("SELECT COUNT(*) n FROM templates").get().n, ' anchors:', db.prepare("SELECT COUNT(*) n FROM field_anchors").get().n);
console.log('SETTINGS:'); for (const r of db.prepare("SELECT key,value FROM settings WHERE key IN ('auto_file_threshold','scope_sweep_enabled','learning_exclude_machine_confirms','confirm_persist_values','format_corrections_dedupe','letterhead_prefill','autofile_gate_unify','corrob_note_recompute_fc')").all()) console.log(`  ${r.key}=${r.value}`);
