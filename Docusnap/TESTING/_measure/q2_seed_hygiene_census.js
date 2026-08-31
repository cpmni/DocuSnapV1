#!/usr/bin/env node
'use strict';
/**
 * Q2 census (Oracle C2.2, 2026-08-22): ONE-SAMPLE template fingerprints. For every supplier in a
 * sandbox DB, each document in turn is the "taught sample": its own documents.keyword_fingerprint
 * is the seed a promote would freeze. Per hygiene variant we measure, at the matcher's 0.75 bar:
 *   recall  — same-supplier siblings that hit the seed (the teach-time selection / binding rate)
 *   cross   — OTHER-supplier documents that hit it (false selection; must stay ~0)
 * Variants:
 *   RAW             — the seed as stored (today)
 *   VARSTRIP        — minus tokens appearing in the sample's own ref/date/customer values (Oracle's
 *                     suggested rule)
 *   SUPPORT         — minus tokens with document-frequency 0 over every OTHER document in the DB
 *                     (an OCR garble seen nowhere else cannot be branding) — floor-guarded
 *   SUPPORT+VARSTRIP
 * Supplier GT = the Demo-Docs filename prefix `<Sender>_…`; the owner's scans = DOCUMENT SOLUTIONS.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron TESTING/_measure/q2_seed_hygiene_census.js <db>
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const db = new Database(process.argv[2], { readonly: true });
const FLOOR = 4;   // templates.js FINGERPRINT_FLOOR class: never prune a seed below this many tokens

const parse = (s) => { try { const v = JSON.parse(s || 'null'); return Array.isArray(v) ? v : []; } catch { return []; } };
const esc = (k) => String(k).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (kw, lower) => new RegExp(`(?<![a-z0-9])${esc(kw)}(?![a-z0-9])`).test(lower);
const score = (kws, lower) => { if (!kws.length) return 0; let h = 0; for (const k of kws) if (has(k, lower)) h++; return h / kws.length; };
const gtSupplier = (fn) => {
  const m = /^([A-Za-z\-]+)_[a-z_]+_\d+/.exec(fn || '');
  if (m) return m[1].toLowerCase();
  if (/^Worksheet\./.test(fn || '')) return 'document solutions';
  return null;
};

const docs = db.prepare("SELECT id, original_filename, keyword_fingerprint, ocr_text FROM documents WHERE ocr_text IS NOT NULL AND keyword_fingerprint IS NOT NULL AND status <> 'deleted'").all()
  .map(d => ({ id: d.id, sup: gtSupplier(d.original_filename), fp: parse(d.keyword_fingerprint), lower: String(d.ocr_text).toLowerCase() }))
  .filter(d => d.sup && d.fp.length);
const exq = db.prepare("SELECT field_key, display_value FROM extractions WHERE document_id = ? AND field_key IN ('invoice_number','reference_number','sales_order_number','po_number','invoice_date','date','order_date','po_date','customer_name','total_amount')");
const bySup = new Map();
for (const d of docs) { if (!bySup.has(d.sup)) bySup.set(d.sup, []); bySup.get(d.sup).push(d); }
console.log(`docs ${docs.length} · suppliers ${bySup.size}`);

function variants(seedDoc) {
  const raw = seedDoc.fp.slice();
  const varToks = new Set(exq.all(seedDoc.id).flatMap(r => (String(r.display_value || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [])));
  const supToks = new Set(seedDoc.sup.split(/[^a-z0-9]+/));
  const varstrip = raw.filter(k => !(varToks.has(k.toLowerCase()) && !supToks.has(k.toLowerCase())));
  const support = raw.filter(k => docs.some(o => o.id !== seedDoc.id && has(k, o.lower)));
  const supportF = support.length >= FLOOR ? support : raw;
  const both = supportF.filter(k => !(varToks.has(k.toLowerCase()) && !supToks.has(k.toLowerCase())));
  return { RAW: raw, VARSTRIP: varstrip.length >= FLOOR ? varstrip : raw, SUPPORT: supportF, 'SUPPORT+VARSTRIP': both.length >= FLOOR ? both : supportF };
}

const tally = {};
const crossDetail = {};
for (const [sup, list] of bySup) {
  if (list.length < 2) continue;
  for (const seed of list) {
    const vs = variants(seed);
    for (const [name, fp] of Object.entries(vs)) {
      const t = tally[name] || (tally[name] = { seeds: 0, sibTotal: 0, sibHit: 0, crossTotal: 0, crossHit: 0, tokens: 0 });
      t.seeds++; t.tokens += fp.length;
      for (const o of docs) {
        if (o.id === seed.id) continue;
        const s = score(fp, o.lower);
        if (o.sup === sup) { t.sibTotal++; if (s >= 0.75) t.sibHit++; }
        else { t.crossTotal++; if (s >= 0.75) { t.crossHit++; const k = `${name} ${sup}→${o.sup}`; crossDetail[k] = (crossDetail[k] || 0) + 1; } }
      }
    }
  }
}
for (const [name, t] of Object.entries(tally)) {
  console.log(`${name.padEnd(18)} seeds=${t.seeds} avg tokens=${(t.tokens / t.seeds).toFixed(1)} · sibling recall ${t.sibHit}/${t.sibTotal} = ${(100 * t.sibHit / t.sibTotal).toFixed(1)}% · cross hits ${t.crossHit}/${t.crossTotal} = ${(100 * t.crossHit / t.crossTotal).toFixed(2)}%`);
}
console.log('\ncross-supplier hit pairs (variant supplier→other: count):');
for (const [k, v] of Object.entries(crossDetail).sort((a, b) => b[1] - a[1]).slice(0, 24)) console.log('  ' + k + ': ' + v);
// the exhibit
const ds = bySup.get('document solutions') || [];
const seed10 = ds.find(d => d.id === 10);
if (seed10) {
  const vs = variants(seed10);
  for (const [name, fp] of Object.entries(vs)) {
    const hits = ds.filter(o => o.id !== 10 && score(fp, o.lower) >= 0.75).length;
    console.log(`exhibit doc 10 ${name.padEnd(18)} ${JSON.stringify(fp)} → ${hits}/${ds.length - 1} siblings`);
  }
}
