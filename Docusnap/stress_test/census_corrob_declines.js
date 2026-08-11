/** census_corrob_declines.js — the DECLINED census for the corroborated auto-file route
 *  (Oracle C4/C5, 2026-08-11): prove the gate DISCRIMINATES rather than sitting inert-open or
 *  inert-shut. For every needs_review doc: where exactly the armed route stops it.
 *
 *  READ-ONLY. Run against a SNAPSHOT, never the live DB under the app:
 *  CENSUS_DB=<snapshot> ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/census_corrob_declines.js
 */
const path = require('path');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));

const DB = process.env.CENSUS_DB;
if (!DB) { console.error('CENSUS_DB=<snapshot path> required (never the live DB).'); process.exit(2); }
const db = new Database(DB, { readonly: true });

const docs = db.prepare(`
  SELECT d.id, d.supplier_name, d.overall_confidence conf, d.document_type_id,
         dt.slug, dt.ref_field_key, dt.date_field_key
  FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
  WHERE d.status = 'needs_review' ORDER BY d.id`).all();

const buckets = {};
const add = (b, id) => { (buckets[b] ||= []).push(id); };

for (const d of docs) {
  // conf band first (the micro-guard's own order)
  if ((d.conf || 0) < trust.TRUSTED_FLOOR) { add('below-95-conf', d.id); continue; }
  if (!d.ref_field_key || !d.date_field_key) { add('dangling-role-key', d.id); continue; }
  const t = trust.scopeTrust(db, d.supplier_name, d.slug, { corrobProbe: true });
  if (t.trusted) { add('scope-already-graduated', d.id); continue; }
  if (t.reason !== 'volume') { add(`scope-${t.reason}`, d.id); continue; }
  if (t.cleanButForVolume !== true) { add('scope-dirty-or-cold', d.id); continue; }
  const rows = db.prepare(
    'SELECT field_key, display_value, raw_value, validation_note, corrected_to, corroboration FROM extractions WHERE document_id = ?'
  ).all(d.id);
  const byKey = new Map(rows.map(r => [r.field_key, r]));
  const roles = ['supplier_name', d.ref_field_key, d.date_field_key];
  let verdict = null;
  for (const k of roles) {
    const e = byKey.get(k);
    if (!e || !String(e.display_value ?? e.raw_value ?? '').trim()) { verdict = `role-empty:${k}`; break; }
    let rec = e.corroboration;
    if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch { rec = null; } }
    if (!rec) { verdict = `record-missing:${k}`; break; }
    if (rec.independent_agree !== true) { verdict = `no-independent-agree:${k}`; break; }
    if (Array.isArray(rec.disagree) && rec.disagree.length) { verdict = `disagree:${k}`; break; }
    if (!trust._corrobLicensed(e.corroboration)) { verdict = `pair-refused(memory+hint):${k}`; break; }
  }
  if (verdict) { add(verdict.split(':')[0], d.id); continue; }
  const flagged = rows.some(r => String(r.validation_note || '').trim() || String(r.corrected_to || '').trim());
  add(flagged ? 'would-corroborate-but-FLAGGED' : 'CORROB-ELIGIBLE(pre-docTrustGate)', d.id);
}

console.log(`declined census over ${docs.length} needs_review docs (${path.basename(DB)}):`);
for (const [b, ids] of Object.entries(buckets).sort((a, z) => z[1].length - a[1].length)) {
  console.log(`  ${String(ids.length).padStart(4)}  ${b}${ids.length <= 12 ? '   [' + ids.join(',') + ']' : ''}`);
}
db.close();
