#!/usr/bin/env node
'use strict';

/**
 * scripts/poisoned-template-link-sweep.js  (one-time remediation, owner-run)
 * --------------------------------------------------------------------------
 * Heals CROSS-SUPPLIER poisoned documents.template_id links — docs whose stored 256-bit
 * isolated-mark detail hash CONTRADICTS their linked template's enrolled detail set (min
 * distance > LOGO_DETAIL_VETO_DIST, default 72) AND whose confirmed supplier differs from the
 * template's identity (dominant confirmed issuer, else name). These links were written by the
 * Stage-0 logo-alone match before the 2026-07-23 detail-hash veto (the Thornbury⇄Copperfield
 * incident: 13 live links at detail distance 110-124); they pollute getDominantSupplier tallies
 * (the establishedIdentity other guards consume), live confirmed counts and matcher ordering.
 * FILING was NOT affected — every poisoned doc's supplier_name was confirmed correct; only the
 * link is wrong. Oracle C4 ruled: report + owner-run fix, never an auto-fix.
 *
 * Per poisoned doc, the fix is conservative:
 *   - RELINK when ≥1 same-type template exists whose identity MATCHES the doc's supplier AND
 *     whose detail set AGREES with the doc's mark (min ≤ veto dist) — picks the closest. All
 *     candidates assert the SAME supplier, so the choice among them is not a correctness risk.
 *   - else UNLINK (template_id NULL) — removes the poison without inventing a link; a confirmed
 *     doc's template_id feeds only tallies/ordering, so NULL is safe and reversible.
 * SAME-supplier links over the threshold (genuine drift tail, measured 74-90 live) are REPORTED
 * as context but NEVER touched.
 *
 * DRY RUN by default — reports, touches nothing.
 *   Preview:  ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/poisoned-template-link-sweep.js
 *   Apply:    ... poisoned-template-link-sweep.js --apply       (BACK UP THE DB FIRST)
 *   Undo:     ... poisoned-template-link-sweep.js --undo <undo-file.json>
 *   Custom DB: --db "C:\\path\\to\\docusnap.db"
 * --apply writes an UNDO file (doc_id -> old link) beside the DB report in stress_test/out/.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const templates = require('../database/modules/templates');
const logoDetail = require('../database/modules/logoDetail');

function parseArgs(argv) {
  const a = { apply: false, db: null, undo: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--apply') a.apply = true;
    else if (argv[i] === '--db') a.db = argv[++i];
    else if (argv[i] === '--undo') a.undo = argv[++i];
  }
  return a;
}

function defaultDbPath() {
  const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(base, 'ScanFinder', 'docusnap.db');
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function main() {
  const args = parseArgs(process.argv);
  const dbPath = args.db || defaultDbPath();
  const writeMode = args.apply || !!args.undo;
  const db = new Database(dbPath, { readonly: !writeMode, fileMustExist: true });

  // ── UNDO mode: restore old links from a previously-written undo file ──
  if (args.undo) {
    const u = JSON.parse(fs.readFileSync(args.undo, 'utf8'));
    const upd = db.prepare('UPDATE documents SET template_id = ? WHERE id = ?');
    const tx = db.transaction((rows) => { let n = 0; for (const r of rows) n += upd.run(r.old_template_id, r.doc_id).changes; return n; });
    const n = tx(u.rows || []);
    console.log(`UNDO: restored ${n}/${(u.rows || []).length} links from ${args.undo}`);
    db.close();
    return;
  }

  console.log(`Poisoned template-link sweep — ${args.apply ? 'APPLY (will update links)' : 'DRY RUN (read-only)'}`);
  console.log(`DB: ${dbPath} · veto dist ${logoDetail.vetoDist()}\n`);

  // Template identity: dominant CONFIRMED issuer, else the name (report fallback only).
  const identCache = new Map();
  const ident = (tplId) => {
    if (!identCache.has(tplId)) {
      let s = null;
      try { s = (templates.getDominantSupplier(db, tplId) || {}).value || null; } catch { s = null; }
      if (!s) { const t = db.prepare('SELECT name FROM templates WHERE id=?').get(tplId); s = t ? t.name : null; }
      identCache.set(tplId, s);
    }
    return identCache.get(tplId);
  };
  const detailSet = new Map();
  const dset = (tplId) => {
    if (!detailSet.has(tplId)) detailSet.set(tplId, templates.getLogoDetailHashes(db, tplId));
    return detailSet.get(tplId);
  };

  const allTpls = db.prepare('SELECT id, name, document_type_slug FROM templates').all();
  const docs = db.prepare(`
    SELECT d.id, d.supplier_name, d.status, d.template_id, d.logo_detail_hash,
           d.original_filename, dt.slug AS type_slug
      FROM documents d
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
     WHERE d.template_id IS NOT NULL AND d.logo_detail_hash IS NOT NULL AND d.status != 'deleted'
     ORDER BY d.id`).all();

  const plan = [];        // { doc, oldTpl, action:'relink'|'unlink', newTpl?, dist, newDist? }
  let sameSupplierDrift = 0;

  for (const d of docs) {
    const set = dset(d.template_id);
    const min = logoDetail.minOverSet(d.logo_detail_hash, set);
    if (min === null || min <= logoDetail.vetoDist()) continue;      // linked set agrees or unjudgeable
    const linkedIdent = ident(d.template_id);
    if (norm(linkedIdent) === norm(d.supplier_name)) { sameSupplierDrift++; continue; }   // drift tail — NEVER touched

    // Cross-supplier poisoned link. Find agreeing same-type templates asserting the DOC's supplier.
    let best = null;
    for (const t of allTpls) {
      if (t.id === d.template_id) continue;
      if (norm(t.document_type_slug || '') !== norm(d.type_slug || '')) continue;
      if (norm(ident(t.id)) !== norm(d.supplier_name)) continue;
      const cd = logoDetail.minOverSet(d.logo_detail_hash, dset(t.id));
      if (cd === null || cd > logoDetail.vetoDist()) continue;       // its mark must AGREE
      if (!best || cd < best.dist) best = { tpl: t, dist: cd };
    }
    plan.push({
      doc: d, oldTpl: { id: d.template_id, name: ident(d.template_id) }, dist: min,
      action: best ? 'relink' : 'unlink',
      newTpl: best ? { id: best.tpl.id, name: best.tpl.name } : null,
      newDist: best ? best.dist : null,
    });
  }

  console.log(`Cross-supplier POISONED links found: ${plan.length}`);
  console.log(`(context: ${sameSupplierDrift} SAME-supplier links sit over the threshold — genuine drift tail, untouched)\n`);
  for (const p of plan) {
    console.log(`  #${p.doc.id} '${p.doc.supplier_name}' [${p.doc.status}] ${p.doc.original_filename}`);
    console.log(`      linked tpl#${p.oldTpl.id} '${p.oldTpl.name}' (detail dist ${p.dist}) → ${p.action === 'relink'
      ? `RELINK tpl#${p.newTpl.id} '${p.newTpl.name}' (detail dist ${p.newDist})` : 'UNLINK (no agreeing same-supplier template)'}`);
  }

  if (!args.apply) {
    console.log('\nDRY RUN — nothing changed. BACK UP THE DB, close the app, then re-run with --apply.');
    db.close();
    return;
  }

  const undoPath = path.join(__dirname, '..', 'stress_test', 'out',
    `poisoned_link_undo_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(undoPath, JSON.stringify({
    db: dbPath, applied_at: new Date().toISOString(),
    rows: plan.map(p => ({ doc_id: p.doc.id, old_template_id: p.oldTpl.id,
                           new_template_id: p.action === 'relink' ? p.newTpl.id : null })),
  }, null, 2));

  const upd = db.prepare('UPDATE documents SET template_id = ? WHERE id = ? AND template_id = ?');
  const tx = db.transaction((rows) => {
    let n = 0;
    for (const p of rows) n += upd.run(p.action === 'relink' ? p.newTpl.id : null, p.doc.id, p.oldTpl.id).changes;
    return n;
  });
  const n = tx(plan);
  console.log(`\nAPPLIED: ${n}/${plan.length} links updated (guarded on the OLD link still being in place).`);
  console.log(`Undo file: ${undoPath}`);
  console.log('Dominant-supplier tallies and live confirmed counts heal automatically from the corrected links.');
  db.close();
}

main();
