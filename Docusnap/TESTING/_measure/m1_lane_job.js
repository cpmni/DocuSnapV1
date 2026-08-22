const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2],{readonly:true});
for (const r of db.prepare("SELECT id, created_at, action, details FROM audit_log WHERE action IN ('quiet_reprocess_job','import_run') ORDER BY id").all()) console.log(r.id, r.created_at, r.action, (r.details||'').slice(0,600));
console.log('--- findSiblings from doc 22 (the taught doc) for DOCUMENT SOLUTIONS:');
const sib=require(ROOT+'/database/modules/supplierSiblings');
try { const s=sib.findSiblings(db, 22, 'DOCUMENT SOLUTIONS', {cap:500}); console.log(' ', s.map(x=>`${x.id}:${x.ratio}`).join(' ')); } catch(e){ console.log('ERR',e.message); }
console.log('--- fingerprint presence (logo / keyword) per held doc:');
for (const r of db.prepare("SELECT id, status, supplier_name, logo_phash IS NOT NULL lp, keyword_fingerprint IS NOT NULL kf, length(ocr_text) ol FROM documents ORDER BY id").all()) console.log(`  #${r.id} ${r.status.padEnd(12)} sup=${String(r.supplier_name)} logo=${r.lp} kw=${r.kf} ocr=${r.ol}`);
