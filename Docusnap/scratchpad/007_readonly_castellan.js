// 007 read-only probe v2 — Castellan Security credit-note TOTAL teach data.
// Opens the LIVE DB strictly readonly. No writes anywhere.
const Database = require('better-sqlite3');
const path = 'C:/Users/cmccu/AppData/Roaming/ScanFinder/docusnap.db';
const db = new Database(path, { readonly: true, fileMustExist: true });
const out = {};
const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
try {
  out.templates_cols = cols('templates');
  out.mappings_cols = cols('template_field_mappings');
  out.anchors_cols = cols('field_anchors');
  const allTpl = db.prepare('SELECT * FROM templates').all();
  out.templates = allTpl.filter(t => /castellan/i.test(JSON.stringify(t)));
  out.template_count_total = allTpl.length;
  out.mappings = [];
  for (const t of out.templates) {
    const rows = db.prepare('SELECT * FROM template_field_mappings WHERE template_id = ?').all(t.id);
    out.mappings.push(...rows);
  }
  out.field_anchors = db.prepare(
    "SELECT * FROM field_anchors WHERE supplier_name LIKE '%astellan%'").all();
  out.switches = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('template_drift_row_pitch','registration_enabled','template_currency_edge_grow')").all();
} catch (e) {
  out.error = String(e && e.stack || e);
}
console.log(JSON.stringify(out, null, 1));
db.close();
