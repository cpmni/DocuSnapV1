#!/usr/bin/env node
'use strict';

/**
 * stress_test/template_detail_veto_probe.js — Oracle C2+C4 verification gate for the
 * 256-bit detail-hash veto in templates.identifyByFingerprint (2026-07-23).
 *
 * READ-ONLY replay over the LIVE DB (the unit fixtures can't prove real-scan behaviour, and
 * realdoc_regression spawns process_docs.py directly — structurally BLIND to this JS layer).
 * For every document, runs identifyByFingerprint with the veto OFF and ON and reports:
 *   - every logo-arm match the veto NEWLY REFUSES, dispositioned keyword-recovered vs lost;
 *   - GATE A: no Copperfield-supplier doc may resolve a Thornbury template (the incident);
 *   - GATE B: 0 correct identities suppressed — a newly-vetoed match whose template's dominant
 *     supplier equals the doc's confirmed supplier, not recovered by the keyword arm, fails
 *     the gate (pre-agreed C2 decision rule: if this fires, the JS switches to the
 *     veto_by_detail positive-rival semantic instead — decided at sign-off, not re-litigated);
 *   - C4: existing documents.template_id links whose stored doc detail CONTRADICTS the linked
 *     template's non-empty detail set (> veto dist) — an owner remediation list, NO auto-fix.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron stress_test/template_detail_veto_probe.js
 */

const path = require('path');
const Database = require('better-sqlite3');
const templates = require(path.join(__dirname, '..', 'database', 'modules', 'templates.js'));
const logoDetail = require(path.join(__dirname, '..', 'database', 'modules', 'logoDetail.js'));

const DB_PATH = process.env.TEMPLATE_PROBE_DB
  || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const docs = db.prepare(`
  SELECT d.id, d.supplier_name, d.status, d.template_id, d.logo_phash, d.logo_detail_hash,
         d.ocr_text, dt.slug AS document_type_slug
    FROM documents d
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
   WHERE d.logo_phash IS NOT NULL AND d.status != 'deleted'
   ORDER BY d.id`).all();

function identify(doc, vetoOn) {
  const prev = process.env.TEMPLATE_LOGO_DETAIL_VETO;
  if (vetoOn) delete process.env.TEMPLATE_LOGO_DETAIL_VETO;
  else process.env.TEMPLATE_LOGO_DETAIL_VETO = '0';
  try {
    return templates.identifyByFingerprint(db, {
      logo_phash: doc.logo_phash, ocr_text: doc.ocr_text,
      document_type_slug: doc.document_type_slug, logo_detail_hash: doc.logo_detail_hash,
    });
  } finally {
    if (prev === undefined) delete process.env.TEMPLATE_LOGO_DETAIL_VETO;
    else process.env.TEMPLATE_LOGO_DETAIL_VETO = prev;
  }
}

// The identity a template asserts: its dominant CONFIRMED issuer ({value,count,total}), else —
// probe-reporting fallback only (matching/filing never consult it) — the cosmetic name.
const dominant = new Map();
function dom(tplId) {
  if (!dominant.has(tplId)) {
    let s = null;
    try { s = (templates.getDominantSupplier(db, tplId) || {}).value || null; } catch { s = null; }
    if (!s) {
      const t = db.prepare('SELECT name FROM templates WHERE id = ?').get(tplId);
      s = t ? t.name : null;
    }
    dominant.set(tplId, s);
  }
  return dominant.get(tplId);
}

let vetoFires = 0, keywordRecovered = 0, lostEntirely = 0, correctSuppressed = 0, incident = 0;
const vetoRows = [], suppressedRows = [], incidentRows = [];

for (const d of docs) {
  const off = identify(d, false);
  const on  = identify(d, true);

  const offLogo = off && off.method === 'logo' ? off : null;
  const onSame  = on && offLogo && on.template && on.template.id === offLogo.template.id;
  if (offLogo && (!on || !onSame || on.method !== 'logo')) {
    vetoFires++;
    const tplSup = dom(offLogo.template.id);
    const wasCorrect = tplSup && norm(tplSup) === norm(d.supplier_name);
    const recovered = on && on.method === 'keywords';
    if (recovered) keywordRecovered++; else lostEntirely++;
    // "Suppressed" = the doc HAD a correct-supplier match and the veto lost that IDENTITY —
    // recovering the same template, or any template asserting the same supplier, is fine.
    const recoveredOk = recovered && (on.template.id === offLogo.template.id
      || norm(dom(on.template.id) || '') === norm(d.supplier_name));
    if (wasCorrect && !recoveredOk) {
      correctSuppressed++;
      suppressedRows.push(`  #${d.id} ${d.supplier_name}: correct logo match '${offLogo.template.name}' vetoed, ${recovered ? 'keyword picked tpl#' + on.template.id : 'LOST'}`);
    }
    vetoRows.push(`  #${d.id} sup='${d.supplier_name}' OFF→'${offLogo.template.name}' (dom='${tplSup}') ON→${on ? `'${on.template.name}' via ${on.method}` : 'no match'}`);
  }

  // GATE A — the incident: with the veto ON, a Copperfield doc must never resolve a template
  // whose dominant supplier is Thornbury (and vice versa).
  if (on && on.template && norm(d.supplier_name)) {
    const tplSup = norm(dom(on.template.id) || '');
    if (tplSup && tplSup !== norm(d.supplier_name)
        && ((norm(d.supplier_name).includes('copperfield') && tplSup.includes('thornbury'))
            || (norm(d.supplier_name).includes('thornbury') && tplSup.includes('copperfield')))) {
      incident++;
      incidentRows.push(`  #${d.id} ${d.supplier_name} STILL resolves '${on.template.name}' via ${on.method}`);
    }
  }
}

// C4 — existing links whose doc detail contradicts the linked template's non-empty detail set.
const poisoned = [];
for (const d of docs) {
  if (!d.template_id || !d.logo_detail_hash) continue;
  const set = templates.getLogoDetailHashes(db, d.template_id);
  const min = logoDetail.minOverSet(d.logo_detail_hash, set);
  if (min !== null && min > logoDetail.vetoDist()) {
    const t = db.prepare('SELECT name FROM templates WHERE id = ?').get(d.template_id);
    poisoned.push(`  #${d.id} sup='${d.supplier_name}' linked to tpl#${d.template_id} '${t ? t.name : '?'}' — detail min-dist ${min} (> ${logoDetail.vetoDist()})`);
  }
}

console.log(`# template detail-veto probe — ${docs.length} docs replayed (read-only), veto dist ${logoDetail.vetoDist()}`);
console.log(`\nVeto fires (logo match newly refused): ${vetoFires} — keyword-recovered ${keywordRecovered}, lost-entirely ${lostEntirely}`);
for (const r of vetoRows.slice(0, 40)) console.log(r);
console.log(`\nGATE A — cross-incident resolutions with veto ON (must be 0): ${incident}`);
for (const r of incidentRows) console.log(r);
console.log(`\nGATE B — CORRECT identities suppressed (must be 0): ${correctSuppressed}`);
for (const r of suppressedRows) console.log(r);
console.log(`\nC4 — existing template_id links whose doc detail CONTRADICTS the linked template's set (owner remediation list, no auto-fix): ${poisoned.length}`);
for (const r of poisoned.slice(0, 40)) console.log(r);

db.close();
process.exit(incident > 0 || correctSuppressed > 0 ? 1 : 0);
