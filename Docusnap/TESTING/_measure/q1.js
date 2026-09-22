const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name);
console.log('tpl cols:', cols('templates').join(','));
console.log('TEMPLATES:');
for (const r of db.prepare("SELECT * FROM templates").all()) {
  const { keyword_fingerprint, ...rest } = r;
  console.log(JSON.stringify(rest));
}
console.log('FIXED FIELDS:');
for (const r of db.prepare("SELECT template_id, field_key, fixed_value, is_variable, fixed_locked, fixed_source, fixed_set_at FROM template_fields WHERE field_key IN ('supplier_name','customer_name') ORDER BY template_id").all())
  console.log(JSON.stringify(r));
console.log('SETTINGS:');
for (const r of db.prepare("SELECT key,value FROM settings WHERE key LIKE '%hold%' OR key LIKE '%near_match%' OR key IN ('auto_file_threshold')").all())
  console.log(JSON.stringify(r));
