const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true });
const mv = require('../../../database/modules/machine_vias.js');
console.log('MACHINE_VIAS', JSON.stringify(mv.MACHINE_VIAS || mv));
const rows = db.prepare(`SELECT LOWER(TRIM(supplier_name)) k, MIN(supplier_name) name, COUNT(*) n,
  SUM(CASE WHEN confirmed_via IS NULL OR confirmed_via NOT IN (${(mv.MACHINE_VIAS||[]).map(()=>'?').join(',')}) THEN 1 ELSE 0 END) human
  FROM documents WHERE status='confirmed' AND supplier_name IS NOT NULL AND TRIM(supplier_name)<>'' GROUP BY k ORDER BY n DESC`).all(...(mv.MACHINE_VIAS||[]));
for (const r of rows) console.log(String(r.n).padStart(4), String(r.human).padStart(4), r.name);
console.log('--- templates (name, dominant_supplier, doc_type, frozen supplier field)');
for (const t of db.prepare(`SELECT t.id, t.name, t.dominant_supplier, t.document_type_slug, (SELECT value FROM template_fields f WHERE f.template_id=t.id AND f.field_key='supplier_name' AND f.is_variable=0) frozen FROM templates t`).all()) console.log(t.id, '|', t.name, '|', t.dominant_supplier, '|', t.document_type_slug, '|', t.frozen);
