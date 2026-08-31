// Flip the teach→file arc switches ON in a SANDBOX DB (never the live DB). Usage: flip_arc.js <db>
const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2]);
const mig=db.prepare('SELECT MAX(version) v FROM migrations').get().v;
const up=db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
for (const k of ['scope_sweep_enabled','scope_sweep_auto_accept','letterhead_fragment_abstain','quiet_reread_enabled','learning_exclude_machine_confirms','autofile_gate_unify','letterhead_issuer','letterhead_prefill','ref_class_fix_enabled']) up.run(k,'true');
const show=db.prepare("SELECT key,value FROM settings WHERE key IN ('scope_sweep_enabled','scope_sweep_auto_accept','letterhead_fragment_abstain','quiet_reread_enabled','learning_exclude_machine_confirms','autofile_gate_unify','letterhead_issuer','letterhead_prefill','auto_file_threshold','confirm_persist_values','format_corrections_dedupe','ref_class_fix_enabled') ORDER BY key").all();
console.log('mig',mig); for (const r of show) console.log(`  ${r.key}=${r.value}`);
