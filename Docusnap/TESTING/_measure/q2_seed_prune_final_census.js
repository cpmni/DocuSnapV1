#!/usr/bin/env node
'use strict';
/**
 * Q2 FINAL-RULE census (Oracle C7, 2026-08-22): the REAL helper templates.pruneSeedFingerprint
 * (G1 issuer-protect + G2 reward licence + floor + half-cap) OFF vs ON, on a scratch copy of a
 * sandbox DB reset to the cold state (every doc needs_review, template-less) so each document can
 * play the one-sample teach seed against the held pile. Reports same-supplier recall and
 * other-supplier hits at 0.75 per arm, plus the G2 refusal reasons.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron TESTING/_measure/q2_seed_prune_final_census.js <db>
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const templates = require(path.join(ROOT, 'database', 'modules', 'templates'));

const tmp = path.join(os.tmpdir(), `q2_final_${process.pid}.db`);
fs.copyFileSync(process.argv[2], tmp);
const db = new Database(tmp);
db.pragma('journal_mode = MEMORY');
db.prepare("UPDATE documents SET status = 'needs_review', template_id = NULL WHERE status <> 'deleted'").run();

const parse = (s) => { try { const v = JSON.parse(s || 'null'); return Array.isArray(v) ? v : []; } catch { return []; } };
const esc = (k) => String(k).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const score = (kws, lower) => { if (!kws.length) return 0; let h = 0; for (const k of kws) if (new RegExp(`(?<![a-z0-9])${esc(k)}(?![a-z0-9])`).test(lower)) h++; return h / kws.length; };
const gtSupplier = (fn, sup) => {
  const m = /^([A-Za-z\-]+)_[a-z_]+_\d+/.exec(fn || '');
  if (m) return { key: m[1].toLowerCase(), issuer: sup || m[1].replace(/-/g, ' ') };
  if (/^Worksheet\./.test(fn || '')) return { key: 'document solutions', issuer: 'DOCUMENT SOLUTIONS' };
  return null;
};
const docs = db.prepare("SELECT id, original_filename, supplier_name, document_type_id, keyword_fingerprint, ocr_text FROM documents WHERE ocr_text IS NOT NULL AND keyword_fingerprint IS NOT NULL AND status <> 'deleted'").all()
  .map(d => { const g = gtSupplier(d.original_filename, d.supplier_name); return g ? { id: d.id, sup: g.key, issuer: g.issuer, typeId: d.document_type_id, fp: parse(d.keyword_fingerprint), lower: String(d.ocr_text).toLowerCase() } : null; })
  .filter(d => d && d.fp.length);
console.log(`docs ${docs.length}`);
const tally = { OFF: { sibT: 0, sibH: 0, crossT: 0, crossH: 0 }, ON: { sibT: 0, sibH: 0, crossT: 0, crossH: 0 } };
const reasons = {};
let exhibit = null;
for (const seed of docs) {
  const on = templates.pruneSeedFingerprint(db, seed.fp, { docId: seed.id, issuer: seed.issuer, typeId: seed.typeId, enabled: true });
  reasons[on.reason.replace(/:\d+$/, '')] = (reasons[on.reason.replace(/:\d+$/, '')] || 0) + 1;
  if (seed.id === 10) exhibit = on;
  if (on.reason === 'pruned') {
    let cOff = 0, cOn = 0, sOff = 0, sOn = 0;
    for (const o of docs) { if (o.id === seed.id) continue; const a = score(seed.fp, o.lower) >= 0.75, b = score(on.fingerprint, o.lower) >= 0.75; if (o.sup === seed.sup) { sOff += a; sOn += b; } else { cOff += a; cOn += b; } }
    console.log(`  pruned seed #${seed.id} ${seed.sup}: ${JSON.stringify(seed.fp)} → ${JSON.stringify(on.fingerprint)} recovered=${on.recovered} · siblings ${sOff}→${sOn} · cross ${cOff}→${cOn}`);
  }
  for (const [arm, fp] of [['OFF', seed.fp], ['ON', on.fingerprint]]) {
    const t = tally[arm];
    for (const o of docs) {
      if (o.id === seed.id) continue;
      const s = score(fp, o.lower);
      if (o.sup === seed.sup) { t.sibT++; if (s >= 0.75) t.sibH++; } else { t.crossT++; if (s >= 0.75) t.crossH++; }
    }
  }
}
for (const [arm, t] of Object.entries(tally)) console.log(`${arm.padEnd(4)} sibling recall ${t.sibH}/${t.sibT} = ${(100 * t.sibH / t.sibT).toFixed(1)}% · cross hits ${t.crossH}/${t.crossT} = ${(100 * t.crossH / t.crossT).toFixed(2)}%`);
console.log('prune outcomes per seed:', JSON.stringify(reasons));
if (exhibit) console.log('exhibit (doc 10):', exhibit.reason, JSON.stringify(exhibit.fingerprint), 'dropped', JSON.stringify(exhibit.dropped), 'recovered', exhibit.recovered);
db.close(); try { fs.unlinkSync(tmp); } catch {}
