'use strict';
/*
 * first_fill_reliability_census.js — the audit-replay census for the first-fill reliability hold
 * (Chris round 18 A1; Oracle gate 2026-08-23). Read-only over a DB copy.
 *
 * For every quiet_reprocess_job audit row: per role field among its done_ids, count the witnesses the
 * hold keys on — S3-C5 notes still on the rows ("Read differently after learning"), engine taught-box
 * yield notes ("Kept the read value … — the taught/a taught …") — and the single-family
 * template_mapping role reads (independent_agree:false) that are the candidate first-fills (post hoc we
 * cannot see which were blank at import; this is the UPPER bound of docs the hold could touch). Reports
 * what K=1 vs K=2 would hold per job. Confirmed docs had their notes cleared at confirm, so witness
 * counts are LOWER bounds on jobs whose docs were since confirmed.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron TESTING/_measure/first_fill_reliability_census.js <db> [<db> …]
 */
const Database = require('better-sqlite3');
const YIELD_RE = /^Kept the read value .* — (the taught|a taught) /;
for (const file of process.argv.slice(2)) {
  const db = new Database(file, { readonly: true });
  console.log(`\n=== ${file}`);
  const jobs = db.prepare("SELECT created_at, metadata_json FROM audit_log WHERE action = 'quiet_reprocess_job' ORDER BY created_at").all();
  const typeRoles = new Map(db.prepare('SELECT id, ref_field_key, date_field_key FROM document_types').all().map(t => [t.id, [t.ref_field_key, t.date_field_key].filter(Boolean)]));
  for (const j of jobs) {
    let m; try { m = JSON.parse(j.metadata_json); } catch { continue; }
    const ids = String(m.done_ids || '').split(',').map(Number).filter(Boolean);
    if (!ids.length) continue;
    const ph = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT e.document_id, e.field_key, e.display_value, e.validation_note, e.extraction_method, e.corroboration, d.document_type_id, d.status
                               FROM extractions e JOIN documents d ON d.id = e.document_id WHERE e.document_id IN (${ph})`).all(...ids);
    const stats = new Map();
    const bump = (k, f) => { const s = stats.get(k) || { s3c5: 0, yield: 0, singleFamily: 0, docs: new Set() }; s[f]++; stats.set(k, s); };
    for (const r of rows) {
      const roles = new Set(['supplier_name', ...(typeRoles.get(r.document_type_id) || [])]);
      if (!roles.has(r.field_key)) continue;
      const note = String(r.validation_note || '').trim();
      if (/Read differently after learning/.test(note)) bump(r.field_key, 's3c5');
      if (YIELD_RE.test(note)) bump(r.field_key, 'yield');
      let single = false;
      try { const c = JSON.parse(r.corroboration || '{}'); single = r.extraction_method === 'template_mapping' && c && c.independent_agree === false; } catch {}
      if (single && String(r.display_value || '').trim()) { bump(r.field_key, 'singleFamily'); stats.get(r.field_key).docs.add(r.document_id); }
    }
    const confirmedN = db.prepare(`SELECT COUNT(*) c FROM documents WHERE id IN (${ph}) AND status = 'confirmed'`).get(...ids).c;
    console.log(`\n${j.created_at} ${m.supplier} / ${m.type_slug} reason=${m.reasons || m.reason} done=${ids.length} (since confirmed ${confirmedN}) changed=${String(m.changed_ids || '').split(',').filter(Boolean).length} first_fill=${String(m.first_fill_ids || '').split(',').filter(Boolean).length}`);
    for (const [k, s] of stats) {
      const w = s.s3c5 + s.yield;
      console.log(`   ${k.padEnd(18)} witnesses: s3c5=${s.s3c5} yield=${s.yield} (lower bound) · single-family mapping reads=${s.singleFamily} (upper bound of first-fills) → K=1 would hold ${w >= 1 ? `≤${s.singleFamily}` : 0} · K=2 would hold ${w >= 2 ? `≤${s.singleFamily}` : 0}`);
    }
  }
  db.close();
}
