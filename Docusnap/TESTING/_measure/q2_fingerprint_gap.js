#!/usr/bin/env node
'use strict';
/**
 * Q2 measurement (Oracle SEND BACK C2.1, 2026-08-22): why did the teach-time quiet re-read select 0
 * on the fresh DOCUMENT SOLUTIONS scope? Three numbers on the r14 sandbox copy:
 *   (i)   the teach-time quiet_reprocess_job audit row (reason, done_ids, dropped)
 *   (ii)  keyword-fingerprint hit rate over the scope's siblings at 0.75 — with the TAUGHT doc's own
 *         documents.keyword_fingerprint (the one-sample seed) vs the template's CURRENT fingerprint
 *   (iii) supplierSiblings.findSiblings from the taught seed — count now
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron TESTING/_measure/q2_fingerprint_gap.js <db> [supplier]
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const db = new Database(process.argv[2], { readonly: true });
const SUP = process.argv[3] || 'DOCUMENT SOLUTIONS';
const supN = SUP.toLowerCase();

const parse = (s) => { try { const v = JSON.parse(s || 'null'); return Array.isArray(v) ? v : []; } catch { return []; } };
const score = (keywords, ocrText) => {
  const ocrLower = String(ocrText || '').toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    const esc = String(kw).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(ocrLower)) hits++;
  }
  return keywords.length ? hits / keywords.length : 0;
};

console.log('(i) quiet_reprocess_job audit rows for the scope');
for (const r of db.prepare("SELECT id, created_at, metadata_json FROM audit_log WHERE action = 'quiet_reprocess_job' ORDER BY id").all()) {
  let m = {}; try { m = JSON.parse(r.metadata_json || '{}'); } catch {}
  if (String(m.supplier || '').toLowerCase() !== supN) continue;
  console.log(`  #${r.id} ${r.created_at} reason=${m.reason} done=${String(m.done_ids || '').split(',').filter(Boolean).length} dropped=${JSON.stringify(m.dropped || '').slice(0, 80)} failed=${m.failed || 0} changed=${String(m.changed_ids || '').split(',').filter(Boolean).length}`);
}

console.log('\n(ii) keyword-fingerprint hit rate over the scope\'s documents');
const tpls = db.prepare("SELECT t.id, t.name, t.keyword_fingerprint, t.document_type_slug, t.created_at FROM templates t WHERE LOWER(t.name) LIKE ? OR t.id IN (SELECT template_id FROM template_fields WHERE field_key='supplier_name' AND LOWER(TRIM(fixed_value)) = ?)").all(`%${supN.split(' ')[0]}%`, supN);
const docs = db.prepare("SELECT id, original_filename, supplier_name, template_id, keyword_fingerprint, ocr_text, processed_at FROM documents WHERE status <> 'deleted' AND (LOWER(TRIM(COALESCE(supplier_name,''))) = ? OR original_filename LIKE 'Worksheet%' OR original_filename LIKE 'Print-Tracker%') ORDER BY id").all(supN);
console.log(`  templates: ${tpls.map(t => `#${t.id} '${t.name}' fp=${parse(t.keyword_fingerprint).length} tokens`).join(' · ')}`);
console.log(`  scope docs: ${docs.length}`);
// the taught doc = the first confirmed doc of the scope with a template (by audit review_confirmed with taught_fields)
const taughtRow = db.prepare("SELECT id, created_at, metadata_json FROM audit_log WHERE action = 'review_confirmed' ORDER BY id").all()
  .map(r => { let m = {}; try { m = JSON.parse(r.metadata_json || '{}'); } catch {} return { ...r, m }; })
  .find(r => String(r.m.supplier_name || r.m.supplier || '').toLowerCase() === supN && Array.isArray(r.m.taught_fields) && r.m.taught_fields.length);
const taughtId = taughtRow ? (taughtRow.m.document_id || taughtRow.m.target_id) : null;
console.log(`  taught doc: ${taughtId} (${taughtRow ? taughtRow.created_at : 'n/a'}) taught_fields=${taughtRow ? JSON.stringify(taughtRow.m.taught_fields) : '-'}`);
const taught = docs.find(d => d.id === Number(taughtId));
const seedFp = taught ? parse(taught.keyword_fingerprint) : [];
console.log(`  one-sample seed fingerprint (the taught doc's own): ${seedFp.length} tokens → ${JSON.stringify(seedFp).slice(0, 300)}`);
for (const t of tpls) {
  const cur = parse(t.keyword_fingerprint);
  console.log(`  template #${t.id} CURRENT fingerprint: ${cur.length} tokens → ${JSON.stringify(cur).slice(0, 300)}`);
}
function hitRate(label, fp) {
  if (!fp.length) { console.log(`  ${label}: (empty fingerprint)`); return; }
  let hit = 0; const scores = [];
  for (const d of docs) { if (taught && d.id === taught.id) continue; const s = score(fp, d.ocr_text); scores.push(s); if (s >= 0.75) hit++; }
  scores.sort((a, b) => a - b);
  console.log(`  ${label}: ${hit}/${scores.length} siblings ≥0.75 · median ${scores[Math.floor(scores.length / 2)].toFixed(2)} · min ${scores[0].toFixed(2)} · max ${scores[scores.length - 1].toFixed(2)}`);
}
hitRate('one-sample SEED (taught doc fp)', seedFp);
for (const t of tpls) hitRate(`template #${t.id} CURRENT fp`, parse(t.keyword_fingerprint));
// per-token document frequency of the seed over the siblings — which tokens are per-document noise?
if (seedFp.length) {
  const df = seedFp.map(kw => ({ kw, n: docs.filter(d => !(taught && d.id === taught.id) && score([kw], d.ocr_text) > 0).length }));
  console.log('  seed token doc-frequency over siblings: ' + df.map(x => `${x.kw}:${x.n}`).join(' '));
}

console.log('\n(iii) findSiblings from the taught seed');
try {
  const sib = require(path.join(ROOT, 'database', 'modules', 'supplierSiblings'));
  if (taught) {
    const r = sib.findSiblings(db, taught.id, SUP);
    console.log(`  findSiblings(db, ${taught.id}, '${SUP}') → ${Array.isArray(r) ? r.length : JSON.stringify(r).slice(0, 120)}`);
  } else console.log('  no taught doc found');
} catch (e) { console.log('  findSiblings error: ' + e.message); }
