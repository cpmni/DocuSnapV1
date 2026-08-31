// COUNTERFACTUAL — "let a TAUGHT layout license auto-file on the FIRST import".
// Wave 1 of the round-8 sandbox (ids 11..210) is exactly that scenario: 200 fresh docs imported
// straight after teaching 10 layouts, with ZERO confirms banked. For each we ask:
//   would the proposed rule have filed it, and would that filing have been WRONG?
// Ground truth = the filename (Supplier-Token_doctype_NNNN.pdf) — the sender folder and the type,
// which are precisely what "incorrectly auto-filed" means to the operator.
// Docs later reprocessed are EXCLUDED (their stored values are no longer the import-time read).
const db = require('better-sqlite3')(process.argv[2], { readonly: true });
const LO = Number(process.argv[3] || 11), HI = Number(process.argv[4] || 210);

const GT_SUP = {
  'castellan-security': 'castellan', 'harrowgate-timber': 'harrowgate', 'ironclad-tool-hire': 'ironclad',
  'meadowvale-dairy': 'meadowvale', 'nordwind-refrigeration': 'nordwind', 'oakhaven-electrical': 'oakhaven',
  'pelican-office': 'pelican', 'quillstone-print': 'quillstone', 'silverbeck-cleaning': 'silverbeck',
  'veltrix-automotive': 'veltrix',
};
const TYPES = ['service_worksheet', 'sales_order', 'purchase_order', 'credit_note', 'delivery_note', 'invoice', 'quote', 'statement'];
function gtOf(fn) {
  const b = String(fn || '').replace(/\.pdf$/i, '').toLowerCase();
  const supKey = Object.keys(GT_SUP).find(k => b.startsWith(k));
  return { sup: supKey ? GT_SUP[supKey] : null, type: TYPES.find(t => b.includes('_' + t)) || null };
}

const rows = db.prepare(`SELECT d.id, d.original_filename, d.supplier_name, d.overall_confidence, d.template_id,
  dt.slug AS slug, dt.ref_field_key, dt.date_field_key
  FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
  WHERE d.id BETWEEN ? AND ? ORDER BY d.id`).all(LO, HI);
const reprocessed = new Set(db.prepare(
  "SELECT DISTINCT document_id FROM audit_log WHERE action='reprocess' AND document_id IS NOT NULL").all().map(r => r.document_id));
const exStmt = db.prepare('SELECT field_key, display_value, validation_note FROM extractions WHERE document_id = ?');

let elig = 0, wrongFolder = 0, wrongType = 0, heldFlag = 0, heldMissing = 0, noTemplate = 0, contaminated = 0;
const conf = [];
const wrongs = [];
for (const r of rows) {
  if (reprocessed.has(r.id)) { contaminated++; continue; }
  const ex = exStmt.all(r.id);
  const flagged = ex.some(e => String(e.validation_note || '').trim());
  const byKey = Object.fromEntries(ex.map(e => [e.field_key, String(e.display_value || '').trim()]));
  const roles = ['supplier_name', r.ref_field_key, r.date_field_key].filter(Boolean);
  const missing = roles.filter(k => !byKey[k]);
  if (!r.template_id) { noTemplate++; continue; }
  if (flagged) { heldFlag++; continue; }
  if (missing.length) { heldMissing++; continue; }
  elig++;
  conf.push(r.overall_confidence || 0);
  const gt = gtOf(r.original_filename);
  const supFold = String(r.supplier_name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (gt.sup && !supFold.includes(gt.sup)) { wrongFolder++; wrongs.push(`FOLDER ${r.original_filename} -> "${r.supplier_name}"`); }
  if (gt.type && String(r.slug || '') !== gt.type) { wrongType++; wrongs.push(`TYPE   ${r.original_filename} -> ${r.slug}`); }
}
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '—';
conf.sort((a, b) => a - b);
console.log(`wave-1 docs examined       : ${rows.length}   (excluded, later reprocessed: ${contaminated})`);
console.log(`WOULD AUTO-FILE on a teach : ${elig}  (${pct(elig, rows.length - contaminated)} of the batch)`);
console.log(`  WRONG FOLDER among them  : ${wrongFolder}  (${pct(wrongFolder, elig)})`);
console.log(`  WRONG TYPE among them    : ${wrongType}  (${pct(wrongType, elig)})`);
console.log(`  their confidence         : min ${conf[0]}  median ${conf[Math.floor(conf.length / 2)]}  max ${conf[conf.length - 1]}`);
console.log(`still HELD — a flag/note   : ${heldFlag}`);
console.log(`still HELD — empty role    : ${heldMissing}`);
console.log(`still HELD — no template   : ${noTemplate}`);
if (wrongs.length) { console.log('--- would-be misfilings:'); wrongs.slice(0, 30).forEach(w => console.log('   ' + w)); }
