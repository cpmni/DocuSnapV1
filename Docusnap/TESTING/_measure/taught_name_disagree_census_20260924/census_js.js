#!/usr/bin/env node
'use strict';
/**
 * census_js.js — the JS-TWIN census for mig 214 (Oracle gate (a), 2026-09-24): run the REAL trust.js predicate over every
 * confirmed document of a DB copy (read-only) and emit the (doc, field) SET the taught-name leg would hold, so the Python
 * census's 30 rows (census.py + RESULT.md) can be compared SET-wise: JS holds ⊆ Python-30, expected 25 (24 catches +
 * the pinned `Fembank`), `Make`×4 / `Studio` absent. Also: the (supplier, field) FLOOD table (Oracle C7), the
 * buyer_issued split, and the count of alnum-only-equal pairs among holds (Oracle C3: expect 0).
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe TESTING/_measure/taught_name_disagree_census_20260924/census_js.js <db copy> [...]
 */
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
const trust = require(path.join(ROOT, 'database', 'modules', 'trust.js'));
const { normaliseForTokens } = require(path.join(ROOT, 'database', 'modules', 'text_normalise.js'));
const alnum = (v) => String(normaliseForTokens(v) || '').replace(/[^0-9a-z]/gi, '').toLowerCase();

for (const dbPath of process.argv.slice(2)) {
  const db = new Database(dbPath, { readonly: true });
  const docs = db.prepare("SELECT d.id, d.supplier_name, d.document_type_id, d.confirmed_via, d.confirmed_by_username, d.template_id, t.slug FROM documents d JOIN document_types t ON t.id = d.document_type_id WHERE d.status = 'confirmed'").all();
  const hasBuyer = !!db.prepare("SELECT 1 FROM pragma_table_info('templates') WHERE name = 'buyer_issued'").get();
  const holds = [];
  for (const d of docs) {
    const rows = db.prepare('SELECT field_key, display_value, raw_value, validation_note, extraction_method, corroboration FROM extractions WHERE document_id = ?').all(d.id);
    // the taught-name leg in isolation: the at-100 branch with only the disagreement leg live
    const g = trust.docTrustGate(db, d.id, d.supplier_name, d.slug, { roleDisagreeOnly: true, roleDisagreementRefuse: true, taughtNameDisagreeRefuse: true, extractions: rows });
    if (g.ok || !/^disagreeing-read:/.test(g.reason)) continue;
    const key = g.reason.split(':')[1];
    const dt = db.prepare('SELECT ref_field_key, date_field_key FROM document_types WHERE id = ?').get(d.document_type_id) || {};
    if (key === dt.ref_field_key || key === dt.date_field_key) continue;   // the role leg — not this census
    const row = rows.find(r => r.field_key === key) || {};
    let rec = {}; try { rec = JSON.parse(row.corroboration || '{}'); } catch {}
    const hit = trust._pageFamilyDisagrees(rec) || {};
    const human = !String(d.confirmed_via || '').trim() && !/^Auto-filed/.test(String(d.confirmed_by_username || ''));
    const corr = db.prepare('SELECT original_value, corrected_value FROM corrections WHERE document_id = ? AND field_key = ?').get(d.id, key);
    const buyer = hasBuyer && d.template_id ? (db.prepare('SELECT buyer_issued FROM templates WHERE id = ?').get(d.template_id) || {}).buyer_issued : null;
    holds.push({ doc: d.id, field: key, supplier: d.supplier_name, via: d.confirmed_via, human, stored: row.display_value ?? row.raw_value, witness: hit.value,
                 alnum_equal: alnum(row.display_value ?? row.raw_value) === alnum(hit.value), corrected: corr ? corr.corrected_value : null, buyer_issued: buyer });
  }
  console.log(`\n== ${dbPath}: confirmed docs ${docs.length} · taught-name holds ${holds.length}`);
  for (const h of holds) console.log('   ', JSON.stringify(h));
  const flood = {};
  for (const h of holds) { const k = `${h.supplier}|${h.field}`; flood[k] = flood[k] || { n: 0, human_as_is: 0 }; flood[k].n++; if (h.human && !h.corrected) flood[k].human_as_is++; }
  console.log('   FLOOD table (supplier|field → holds, human-confirmed-as-is):', JSON.stringify(flood));
  console.log('   alnum-only-equal pairs among holds (expect 0):', holds.filter(h => h.alnum_equal).length,
              '· buyer_issued=1 holds:', holds.filter(h => h.buyer_issued === 1).length,
              '· lone-word witnesses (must be 0):', holds.filter(h => trust._nameWitnessTokens(h.witness) < 2).length);
  db.close();
}
