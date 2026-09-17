const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true });
for (const t of db.prepare(`SELECT t.id, t.name, t.document_type_slug, t.confirmed_count,
  (SELECT fixed_value FROM template_fields f WHERE f.template_id=t.id AND f.field_key='supplier_name' AND f.is_variable=0 LIMIT 1) frozen
  FROM templates t ORDER BY frozen, t.document_type_slug`).all()) console.log(t.id, '|', t.name, '|', t.document_type_slug, '|', t.confirmed_count, '| frozen:', t.frozen);
