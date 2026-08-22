const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const T=require(ROOT+'/database/modules/templates');
const db=new Database(process.argv[2],{readonly:true});
const tpls=db.prepare("SELECT id, name, document_type_slug FROM templates").all();
const docs=db.prepare("SELECT id, original_filename, status, supplier_name, template_id, document_type_id, logo_phash FROM documents WHERE status IN ('needs_review','confirmed') ORDER BY id").all();
for (const t of tpls) {
  let hashes=T.getLogoHashes(db,t.id); const row=db.prepare('SELECT logo_phash FROM templates WHERE id=?').get(t.id); if(!hashes.length&&row.logo_phash) hashes=[row.logo_phash];
  const pool=docs.filter(d=>d.logo_phash);
  const dist=d=>{let m=64;for(const h of hashes){const x=T.hammingDistance(d.logo_phash,h);if(x<m)m=x;}return m;};
  const held=pool.filter(d=>d.status==='needs_review');
  const unnamedUntyped=held.filter(d=>!d.template_id);
  const near=unnamedUntyped.filter(d=>dist(d)<=6);
  console.log(`TEMPLATE ${t.id} "${t.name}" (${t.document_type_slug}) hashes=${hashes.length}: template-less held=${unnamedUntyped.length} within<=6: ${near.length} (${unnamedUntyped.length?Math.round(100*near.length/unnamedUntyped.length):0}%)`);
  if (process.argv[3]==='detail') for (const d of pool) console.log(`   #${d.id} ${d.status.padEnd(12)} tpl=${d.template_id} sup=${String(d.supplier_name).slice(0,22).padEnd(22)} dist=${dist(d)} ${d.original_filename}`);
}
