const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3'); const fs=require('fs'); const path=require('path');
const db=new Database(process.argv[2],{readonly:true});
for (const r of db.prepare("SELECT id, original_filename, status, folder_path, stored_path, working_path FROM documents ORDER BY id").all()) {
  const src=path.join(r.folder_path||'', r.original_filename||'');
  console.log(`#${r.id} ${r.status.padEnd(12)} src=${fs.existsSync(src)?'Y':'-'} work=${r.working_path&&fs.existsSync(r.working_path)?'Y':'-'} stored=${r.stored_path?(fs.existsSync(r.stored_path)?'Y':'MISSING'):'-'}  ${r.original_filename}`);
}
console.log('folder:', db.prepare("SELECT DISTINCT folder_path FROM documents").all().map(r=>r.folder_path).join(' | '));
for (const r of db.prepare("SELECT id, action, details FROM audit_log WHERE document_id=10 OR details LIKE '%0195%' ORDER BY id").all()) console.log('  audit', r.id, r.action, (r.details||'').slice(0,200));
