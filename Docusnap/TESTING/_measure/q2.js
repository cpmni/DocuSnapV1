const db = require('better-sqlite3')(process.argv[2], {readonly:true});
console.log('PENDING TEMPLATES (live):');
for (const r of db.prepare("SELECT id,name,document_type_slug,confirmed_count,identity_unconfirmed,identity_unconfirmed_at,identity_supported_count FROM templates WHERE identity_unconfirmed=1 OR identity_supported_count>0").all())
  console.log(JSON.stringify(r));
console.log('hold switch:', JSON.stringify(db.prepare("SELECT value FROM settings WHERE key='template_identity_hold_siblings'").get()));
console.log('total templates:', db.prepare("SELECT COUNT(*) n FROM templates").get().n);
