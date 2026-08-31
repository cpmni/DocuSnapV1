const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const keys=['ref_prefix_confusable_adopt','raw_witness_vacuous_suppress','filing_sanity_page_match_v2','vat_reg_symbol_confusable','money_sign_capture'];
for (const p of process.argv.slice(2)) { const db=new Database(p,{readonly:true}); console.log(p); for (const k of keys) { const r=db.prepare('SELECT value v FROM settings WHERE key=?').get(k); console.log('  '+k.padEnd(32)+'= '+(r?r.v:'(unset)')); } db.close(); }
