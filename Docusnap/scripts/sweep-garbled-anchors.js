#!/usr/bin/env node
'use strict';
/**
 * scripts/sweep-garbled-anchors.js
 * Garbled-anchor remediation sweep (Oracle amended verdict 2026-07-31, ruling 3).
 *
 * The 2026-07-30-era teach label-detect bug (band decapitation, fixed for FUTURE teaches by
 * 934df8a) left STORED field_anchors rows whose anchor_label is an OCR garble of the printed
 * caption ('Inwotce No.' for 'Invoice No.'). A garbled label degrades every downstream rung
 * that keys off it (label-lock relocate matches fuzzily or not at all; the doc falls to the
 * blind registration read — the #121 'V-69523' clip class).
 *
 * Detection (precision-first): an alpha token (len>=4) of the label that is NOT a known
 * caption word but sits within edit distance 1-2 of one ('inwotce'~'invoice') is the
 * teach-garble signature. Unknown-but-not-near tokens (company names etc.) are NOT flagged.
 *
 *   1. Close ScanFinder (so the DB isn't locked) before --apply.
 *   2. node scripts/sweep-garbled-anchors.js            (dry run — report only)
 *      node scripts/sweep-garbled-anchors.js --apply    (backs up the DB, deletes flagged rows)
 *
 * Backup: docusnap.backup-<timestamp>.db beside the live DB; undo = copy it back.
 * After --apply: reprocess affected docs; re-teach the fields with the fixed teach wizard
 * (labels now read clean) if taught positions are still wanted — keyword carries the fields
 * meanwhile (fail toward review, never a clipped silent value).
 */
const path = require('path');
const fs = require('fs');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const APPLY = process.argv.includes('--apply');
const DB = path.join(process.env.APPDATA || '', 'ScanFinder', 'docusnap.db');
if (!fs.existsSync(DB)) { console.error('DB not found:', DB); process.exit(1); }

// Known caption vocabulary: generic document-caption words + every word used in the
// install's own field labels and doc-type names (so custom types extend it automatically).
const GENERIC = new Set([
  'invoice', 'date', 'no', 'number', 'ref', 'reference', 'order', 'delivery', 'note', 'notes',
  'docket', 'site', 'customer', 'client', 'supplier', 'vendor', 'deliver', 'ship', 'bill',
  'billing', 'sold', 'from', 'to', 'for', 'total', 'subtotal', 'amount', 'account', 'vat',
  'tax', 'net', 'gross', 'page', 'terms', 'due', 'paid', 'payment', 'received', 'job',
  'works', 'work', 'worksheet', 'sales', 'purchase', 'quote', 'quotation', 'statement',
  'receipt', 'remittance', 'advice', 'credit', 'issued', 'issue', 'your', 'our', 'attn',
  'attention', 'contact', 'name', 'address', 'phone', 'tel', 'email', 'code', 'id',
]);

function lev(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

const ro = new Database(DB, { readonly: true });
const vocab = new Set(GENERIC);
for (const r of ro.prepare('SELECT label FROM fields').all())
  for (const w of String(r.label || '').toLowerCase().split(/[^a-z]+/)) if (w.length >= 2) vocab.add(w);
for (const r of ro.prepare('SELECT name, title_aliases FROM document_types').all())
  for (const w of (String(r.name || '') + ' ' + String(r.title_aliases || '')).toLowerCase().split(/[^a-z]+/))
    if (w.length >= 2) vocab.add(w);

const anchors = ro.prepare(
  'SELECT id, supplier_name, document_type, field_key, anchor_label, direction, usage_count, confidence, last_authoritative_at FROM field_anchors ORDER BY supplier_name, field_key'
).all();
ro.close();

const flagged = [];
for (const a of anchors) {
  const tokens = String(a.anchor_label || '').toLowerCase().split(/[^a-z]+/).filter(t => t.length >= 4);
  for (const t of tokens) {
    if (vocab.has(t)) continue;
    let best = null;
    for (const v of vocab) {
      if (v.length < 4) continue;
      const d = lev(t, v, 2);
      if (d <= 2 && (!best || d < best.d)) best = { v, d };
    }
    if (best) { flagged.push({ ...a, garbled_token: t, nearest: best.v, distance: best.d }); break; }
  }
}

console.log(`Scanned ${anchors.length} anchor row(s); ${flagged.length} carry a GARBLED label token:`);
for (const f of flagged)
  console.log(`  #${f.id} [${f.supplier_name} / ${f.document_type} / ${f.field_key}] label=${JSON.stringify(f.anchor_label)}` +
              ` garble='${f.garbled_token}'~'${f.nearest}'(d${f.distance}) uses=${f.usage_count} taught=${f.last_authoritative_at || '-'}`);

if (!flagged.length) { console.log('Nothing to remediate.'); process.exit(0); }
if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to back up + delete the flagged rows.'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = DB.replace(/\.db$/, `.backup-${stamp}.db`);
fs.copyFileSync(DB, backup);
for (const ext of ['-wal', '-shm']) { try { if (fs.existsSync(DB + ext)) fs.copyFileSync(DB + ext, backup + ext); } catch {} }
fs.writeFileSync(backup.replace(/\.db$/, '.deleted-anchors.json'), JSON.stringify(flagged, null, 1));
console.log('Backed up DB to:', backup, '(+ deleted-rows JSON beside it)');

const db = new Database(DB);
db.pragma('busy_timeout = 4000');
const del = db.prepare('DELETE FROM field_anchors WHERE id = ?');
let n = 0;
const tx = db.transaction(rows => { for (const r of rows) n += del.run(r.id).changes; });
tx(flagged);
db.close();
console.log(`Deleted ${n} anchor row(s). Reprocess the affected suppliers' docs; re-teach with the fixed wizard if taught positions are wanted (labels now read clean).`);
console.log('Undo: copy the backup back over docusnap.db.');
