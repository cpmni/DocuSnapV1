const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const { runMigrations } = require(ROOT+'/database/index'); const learning=require(ROOT+'/database/modules/learning');
const db=new Database(':memory:'); runMigrations(db);
const keys=['auto_file_threshold','scope_sweep_enabled','scope_sweep_auto_accept','letterhead_fragment_abstain','quiet_reread_enabled','role_field_dominant_class','learning_exclude_machine_confirms','autofile_gate_unify','letterhead_issuer','letterhead_prefill','ref_class_fix_enabled','confirm_persist_values','format_corrections_dedupe','hint_band_ws_normalize','template_identity_geom_fragment_shed','graduation_window','letterhead_stack_abstain','letterhead_depth_guard','template_fixed_seed_fragment_keep','quiet_reread_kw_select','quiet_reread_on_ready'];
console.log('FRESH DB after migrations (max mig', db.prepare('SELECT MAX(version) v FROM migrations').get().v + '):');
for (const k of keys) console.log('  '+k.padEnd(38)+'= '+learning.getSetting(db,k,'(unset)'));
