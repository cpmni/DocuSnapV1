#!/usr/bin/env node
'use strict';

/**
 * scripts/logo-detail-backfill.js  (one-time enrolment backfill, owner-run)
 * -------------------------------------------------------------------------
 * ⚠ GATE RESULT (2026-07-23) — DO NOT --apply TO THE LIVE DB YET. The C5 activation A/B this
 * script exists to be gated by (starved vs backfilled COPY, 390 docs, stress_test/out/
 * act_{base,on}.md) measured: values byte-identical, M 9→3 (six poisoned-GT wrong-auto-files
 * healed) BUT would-auto-file 268→131 — with sparse sets (one detail per row) the activated
 * LOGO_DETAIL_PRIMARY picker abstains across the same-supplier drift tail (histogram: 27% of
 * genuine pairs exceed the veto distance). Blocked until a minimum-set-size guard lands in the
 * Python picker (own design round); then re-run this gate.
 *
 * Backfills logo_fingerprints.detail_hash (256-bit isolated-mark, mig 47) from each
 * supplier's CONFIRMED documents. Phillip R2 / Oracle C5 (2026-07-23): populating this table
 * ACTIVATES the anchor-path detail-primary supplier picker + veto (LOGO_DETAIL_PRIMARY /
 * LOGO_DETAIL_VETO, both default ON — inert today only because the table is starved 0/N), so
 * this runs as its OWN slice, report-then---apply, gated by a realdoc corpus A/B against a
 * backfilled COPY before the live DB is touched. The corpus-wide histogram (the C5
 * prerequisite) ran 2026-07-23: impostor min 86/256, same-mark drift p50=56 — multi-reference
 * sets are the load-bearing structure, hence per-ROW assignment below, not one hash per supplier.
 *
 * GUARDS per candidate doc (Phillip's three, all enforced):
 *   (a) TEXT CORROBORATION — the doc's own ocr_text must corroborate the supplier name
 *       (branding_fingerprint.nameCorroboratedByText); judgeable-and-uncorroborated docs are
 *       excluded, unjudgeable kept (the live plant gate's fail-open, so cold suppliers with no
 *       fingerprints still backfill).
 *   (b) MUTUAL CONSISTENCY — the supplier's candidate marks must form a coherent CORE: medoid +
 *       members within DRIFT_CEIL (56, the measured genuine-drift envelope) of it, core >= 2.
 *       A singleton or a scattered set backfills NOTHING (a historical wrong-supplier confirm
 *       would be the outlier, never the medoid).
 *   (c) CROSS-PLANT CHECK — learning.detailCrossPlantCloser refuses any mark that positively
 *       matches a RIVAL supplier's already-enrolled set (checked against the evolving state).
 * Assignment: each detail-less logo_fingerprints row gets the CORE doc whose 64-bit logo phash
 * is NEAREST that row's phash (falling back to the medoid) — preserving the multi-reference
 * structure instead of stamping one hash everywhere. Rows with a detail_hash are NEVER touched.
 *
 *   Preview:  ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/logo-detail-backfill.js
 *   Apply:    ... logo-detail-backfill.js --apply          (BACK UP THE DB FIRST)
 *   Undo:     ... logo-detail-backfill.js --undo <undo-file.json>
 *   Custom DB: --db "C:\\path\\to\\docusnap.db"
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const learning = require('../database/modules/learning');
const bf = require('../database/modules/branding_fingerprint');
const logoDetail = require('../database/modules/logoDetail');

const DRIFT_CEIL = 56;   // measured same-mark drift envelope (histogram p50=56; impostors >=86)

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

function phashDist(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return 64;
  let d = 0;
  for (let i = 0; i < h1.length; i++) d += ((parseInt(h1[i], 16) ^ parseInt(h2[i], 16)).toString(2).match(/1/g) || []).length;
  return d;
}

function main() {
  const args = parseArgs(process.argv);
  const dbPath = args.db || defaultDbPath();
  const writeMode = args.apply || !!args.undo;
  const db = new Database(dbPath, { readonly: !writeMode, fileMustExist: true });

  if (args.undo) {
    const u = JSON.parse(fs.readFileSync(args.undo, 'utf8'));
    const upd = db.prepare('UPDATE logo_fingerprints SET detail_hash = NULL WHERE id = ? AND detail_hash = ?');
    const tx = db.transaction((rows) => { let n = 0; for (const r of rows) n += upd.run(r.row_id, r.detail_hash).changes; return n; });
    const n = tx(u.rows || []);
    console.log(`UNDO: cleared ${n}/${(u.rows || []).length} backfilled detail hashes from ${args.undo}`);
    db.close();
    return;
  }

  console.log(`Logo detail-hash backfill — ${args.apply ? 'APPLY' : 'DRY RUN (read-only)'}`);
  console.log(`DB: ${dbPath} · drift ceiling ${DRIFT_CEIL} · veto dist ${logoDetail.vetoDist()}\n`);

  const suppliers = db.prepare(
    'SELECT DISTINCT supplier_name FROM logo_fingerprints WHERE detail_hash IS NULL OR detail_hash = \'\''
  ).all().map(r => r.supplier_name);

  const plan = [];   // { row_id, supplier, row_phash, detail_hash, from_doc, dist_to_medoid }
  const skipped = [];

  for (const sup of suppliers) {
    // (a) candidate pool: confirmed, detail-bearing docs of this supplier, text-corroborated.
    const docs = db.prepare(
      `SELECT id, logo_phash, logo_detail_hash, ocr_text FROM documents
        WHERE status = 'confirmed' AND supplier_name = ? AND logo_detail_hash IS NOT NULL AND logo_detail_hash != ''`
    ).all(sup);
    const fps = db.prepare(
      `SELECT keyword_fingerprint FROM templates
        WHERE keyword_fingerprint IS NOT NULL AND LOWER(TRIM(name)) = LOWER(TRIM(?))`
    ).all(sup).map(r => { try { return JSON.parse(r.keyword_fingerprint) || []; } catch { return []; } });
    const pool = docs.filter(d => {
      try {
        const v = bf.nameCorroboratedByText(sup, fps, d.ocr_text);
        return !(v.judgeable && !v.corroborated);   // exclude only POSITIVE contradiction (live plant-gate polarity)
      } catch { return true; }
    });
    if (pool.length < 2) { skipped.push(`  '${sup}': ${pool.length} corroborated candidate(s) — singleton/empty, nothing backfilled`); continue; }

    // (b) medoid + coherent core within the drift ceiling.
    let medoid = null, best = Infinity;
    for (const a of pool) {
      let tot = 0;
      for (const b of pool) tot += logoDetail.detailDistance(a.logo_detail_hash, b.logo_detail_hash) ?? 256;
      if (tot < best) { best = tot; medoid = a; }
    }
    const core = pool.filter(d => (logoDetail.detailDistance(d.logo_detail_hash, medoid.logo_detail_hash) ?? 999) <= DRIFT_CEIL);
    if (core.length < 2) { skipped.push(`  '${sup}': scattered set (core ${core.length} within ${DRIFT_CEIL} of the medoid) — nothing backfilled`); continue; }

    // Assign per detail-less row: the core doc whose logo phash is nearest the row's phash.
    const rows = db.prepare(
      "SELECT id, phash FROM logo_fingerprints WHERE supplier_name = ? AND (detail_hash IS NULL OR detail_hash = '')"
    ).all(sup);
    for (const row of rows) {
      let pick = medoid, pd = Infinity;
      for (const d of core) {
        const dd = phashDist(row.phash, d.logo_phash);
        if (dd < pd) { pd = dd; pick = d; }
      }
      // (c) final anti-poison check against the EVOLVING enrolled state.
      let refused = false;
      try { refused = learning.detailCrossPlantCloser(db, sup, pick.logo_detail_hash); } catch { refused = false; }
      if (refused) { skipped.push(`  '${sup}' row#${row.id}: cross-plant check refused doc#${pick.id}'s mark (closer to a rival)`); continue; }
      plan.push({ row_id: row.id, supplier: sup, row_phash: row.phash, detail_hash: pick.logo_detail_hash,
                  from_doc: pick.id, dist_to_medoid: logoDetail.detailDistance(pick.logo_detail_hash, medoid.logo_detail_hash) });
    }
  }

  console.log(`Backfill plan: ${plan.length} row(s)`);
  for (const p of plan) console.log(`  '${p.supplier}' row#${p.row_id} ← doc#${p.from_doc} (mark dist-to-medoid ${p.dist_to_medoid})`);
  if (skipped.length) { console.log(`\nSkipped (guards):`); for (const s of skipped) console.log(s); }

  if (!args.apply) {
    console.log('\nDRY RUN — nothing changed. Gate the activation with a corpus A/B on a backfilled COPY');
    console.log('(RR_DB=<copy> stress_test/realdoc_regression.js) BEFORE applying to the live DB.');
    db.close();
    return;
  }

  const undoPath = path.join(__dirname, '..', 'stress_test', 'out',
    `logo_detail_backfill_undo_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(undoPath, JSON.stringify({ db: dbPath, applied_at: new Date().toISOString(), rows: plan }, null, 2));
  const upd = db.prepare("UPDATE logo_fingerprints SET detail_hash = ? WHERE id = ? AND (detail_hash IS NULL OR detail_hash = '')");
  const tx = db.transaction((rows) => { let n = 0; for (const p of rows) n += upd.run(p.detail_hash, p.row_id).changes; return n; });
  const n = tx(plan);
  console.log(`\nAPPLIED: ${n}/${plan.length} rows backfilled (empty-only guard). Undo file: ${undoPath}`);
  db.close();
}

main();
