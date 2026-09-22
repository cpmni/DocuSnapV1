const ROOT='C:/GIT Projects/Docusnap'; const Database=require(ROOT+'/node_modules/better-sqlite3');
const db=new Database(process.argv[2],{readonly:true});
console.log(db.prepare("PRAGMA table_info(templates)").all().map(c=>c.name).join(','));
for (const r of db.prepare("SELECT id, name, document_type_slug, supplier_name FROM templates").all()) console.log(JSON.stringify(r));
