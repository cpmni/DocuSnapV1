const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2],{readonly:true});
for (const r of db.prepare("SELECT d.id, d.status, e.extraction_method m, d.ocr_text t FROM documents d LEFT JOIN extractions e ON e.document_id=d.id AND e.field_key='supplier_name' WHERE d.supplier_name='DOCUMENT SOLUTIONS' ORDER BY d.id").all()) {
  const t=String(r.t||''); const head=t.split('\n').slice(0,6).map(s=>s.trim()).filter(Boolean).join(' | ').slice(0,140);
  console.log(`#${r.id} ${r.status.padEnd(12)} ${String(r.m||'').padEnd(26)} document=${/\bdocument\b/i.test(t)?'Y':'-'} solutions=${/\bsolutions\b/i.test(t)?'Y':'-'}  head: ${head}`);
}
