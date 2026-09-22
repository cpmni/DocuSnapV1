const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
for (const p of process.argv.slice(2)) { try { const db=new Database(p,{readonly:true});
  const s=db.prepare("SELECT status, COUNT(*) n FROM documents GROUP BY status").all().map(r=>`${r.status}=${r.n}`).join(' ');
  const mx=db.prepare("SELECT MIN(id) lo, MAX(id) hi, COUNT(*) n FROM documents").get();
  const mig=db.prepare("SELECT MAX(version) v FROM migrations").get().v;
  console.log(`${p}\n   ids ${mx.lo}..${mx.hi} n=${mx.n} mig=${mig}  ${s}`); db.close(); } catch(e){ console.log(p,'ERR',e.message);} }
