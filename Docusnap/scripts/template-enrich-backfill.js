#!/usr/bin/env node
'use strict';
/**
 * scripts/template-enrich-backfill.js
 * ===================================
 * Slice 1 (learn-on-commit) BACKFILL — heals templates that FROZE at their first sample.
 *
 * Enrichment (keyword-fingerprint INTERSECT + logo-set convergence) historically ran ONLY on a
 * taught confirm, so graduation-born / matched templates kept a customer-token-polluted fingerprint
 * and a single logo hash. This script replays the SAME convergence the live learn-on-commit hook
 * now performs, over each template's ALREADY-confirmed linked documents (oldest→newest), so an
 * install's existing templates converge WITHOUT re-teaching. The owner then reprocesses the held
 * docs and they match their own-type template.
 *
 * SAFETY — the backfill IS the live hook: it calls templates.learnTemplateOnCommit (forced on),
 * which is TYPE-SCOPED + SUPPLIER-VALIDATED + appendLogoOnly (Oracle C-A: never seeds a NEW primary
 * logo — a keyword-only C3 template stays logo-less). It NEVER writes a template file and NEVER
 * touches documents. Close ScanFinder first (the DB must be unlocked).
 *
 * Usage (RUN VIA ELECTRON-AS-NODE — better-sqlite3 is built for the Electron ABI, so plain `node`
 * fails with NODE_MODULE_VERSION mismatch; prefix every command with `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron`):
 *   … electron scripts/template-enrich-backfill.js                  DRY RUN — reports the diff on a temp copy, no writes
 *   … electron scripts/template-enrich-backfill.js --apply          back up DB + write a snapshot, then enrich
 *   … electron scripts/template-enrich-backfill.js --revert [file]  restore identity state from a snapshot (newest if omitted)
 *   … electron scripts/template-enrich-backfill.js --verify         C-D round-trip proof (apply→revert byte-identical on a TEMP COPY)
 *   --db <path>   override the DB path (default %APPDATA%\ScanFinder\docusnap.db)
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
const templates = require(path.join(__dirname, '..', 'database', 'modules', 'templates'));

const argv = process.argv.slice(2);
const has  = (flag) => argv.includes(flag);
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const APPLY = has('--apply'), REVERT = has('--revert'), VERIFY = has('--verify');
const DB = argOf('--db') || path.join(process.env.APPDATA || '', 'ScanFinder', 'docusnap.db');

// ── identity snapshot: the COMPLETE set of state enrichment can touch ─────────────────
// (templates.keyword_fingerprint, templates.logo_phash [never mutated under appendLogoOnly,
// captured anyway], and every template_logo_hashes row incl. detail_hash — cap-eviction can
// drop a pre-existing non-primary hash, so all rows must be captured for a byte-identical revert).
function snapshotIdentity(db) {
  const tmpls = db.prepare('SELECT id, logo_phash, keyword_fingerprint FROM templates ORDER BY id').all();
  return tmpls.map(t => ({
    id: t.id,
    logo_phash: t.logo_phash,
    keyword_fingerprint: t.keyword_fingerprint,
    hashes: db.prepare('SELECT phash, detail_hash FROM template_logo_hashes WHERE template_id = ? ORDER BY id').all(t.id),
  }));
}

function restoreIdentity(db, snap) {
  const tx = db.transaction(() => {
    for (const t of snap) {
      db.prepare('UPDATE templates SET logo_phash = ?, keyword_fingerprint = ? WHERE id = ?')
        .run(t.logo_phash, t.keyword_fingerprint, t.id);
      db.prepare('DELETE FROM template_logo_hashes WHERE template_id = ?').run(t.id);
      const ins = db.prepare('INSERT INTO template_logo_hashes (template_id, phash, detail_hash) VALUES (?, ?, ?)');
      for (const h of t.hashes) ins.run(t.id, h.phash, h.detail_hash);
    }
  });
  tx();
}

// Replay the live hook over every template's confirmed linked docs (oldest→newest).
function enrichAll(db) {
  process.env.TEMPLATE_LEARN_ON_CONFIRM = '1';   // the backfill IS the live hook, forced on
  const tmpls = db.prepare('SELECT id, name FROM templates ORDER BY id').all();
  let touched = 0, docsSeen = 0;
  for (const t of tmpls) {
    const docs = db.prepare(
      `SELECT d.id, d.supplier_name, dt.slug AS document_type_slug
         FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
        WHERE d.template_id = ? AND d.status = 'confirmed' ORDER BY d.id`
    ).all(t.id);
    for (const d of docs) {
      docsSeen++;
      templates.learnTemplateOnCommit(db, d.id, { document_type_slug: d.document_type_slug, supplier_name: d.supplier_name });
    }
    if (docs.length) touched++;
  }
  return { templates: tmpls.length, touched, docsSeen };
}

// Human-readable per-template diff of two identity snapshots.
function diff(before, after) {
  const byId = new Map(before.map(t => [t.id, t]));
  const changes = [];
  for (const a of after) {
    const b = byId.get(a.id);
    const fpB = JSON.parse(b.keyword_fingerprint || '[]'), fpA = JSON.parse(a.keyword_fingerprint || '[]');
    const dropped = fpB.filter(x => !fpA.includes(x));
    const hashDelta = a.hashes.length - b.hashes.length;
    const logoSeed = (b.logo_phash == null) !== (a.logo_phash == null);
    if (dropped.length || hashDelta !== 0 || logoSeed) {
      changes.push({ id: a.id, dropped, fp: `${fpB.length}→${fpA.length}`, hashes: `${b.hashes.length}→${a.hashes.length}`, logoSeed });
    }
  }
  return changes;
}

function printDiff(changes) {
  if (!changes.length) { console.log('  No identity changes — templates already converged.'); return; }
  for (const c of changes) {
    console.log(`  template ${c.id}: fingerprint ${c.fp}${c.dropped.length ? ' (dropped: ' + c.dropped.join(', ') + ')' : ''}, logo-hashes ${c.hashes}` +
      (c.logoSeed ? '  ⚠ LOGO SEEDED (C-A VIOLATION — investigate!)' : ''));
  }
  console.log(`\n  ${changes.length} template(s) would change.`);
}

function copyToTemp(src) {
  if (!fs.existsSync(src)) { console.error('DB not found:', src); process.exit(1); }
  const tmp = path.join(os.tmpdir(), `enrich-backfill-${Date.now()}.db`);
  fs.copyFileSync(src, tmp);
  return tmp;
}

function main() {
  if (!fs.existsSync(DB) && !VERIFY) { console.error('DB not found:', DB, '\nPass --db <path> or close+point at the live DB.'); process.exit(1); }
  console.log('DB:', DB);

  // ── REVERT ──────────────────────────────────────────────────────────────────
  if (REVERT) {
    let snapFile = argOf('--revert');
    if (!snapFile || snapFile.startsWith('--')) {
      const dir = path.dirname(DB);
      const snaps = fs.readdirSync(dir).filter(f => /^template-enrich-snapshot-.*\.json$/.test(f)).sort();
      snapFile = snaps.length ? path.join(dir, snaps[snaps.length - 1]) : null;
    }
    if (!snapFile || !fs.existsSync(snapFile)) { console.error('No snapshot to revert from. Pass --revert <file>.'); process.exit(1); }
    const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    const db = new Database(DB); db.pragma('busy_timeout = 4000');
    restoreIdentity(db, snap); db.close();
    console.log(`Reverted identity state from ${snapFile} (${snap.length} templates).`);
    return;
  }

  // ── VERIFY (C-D round-trip on a TEMP COPY) ────────────────────────────────────
  if (VERIFY) {
    const tmp = copyToTemp(DB);
    const db = new Database(tmp); db.pragma('busy_timeout = 4000');
    const before = snapshotIdentity(db);
    const stats = enrichAll(db);
    const after = snapshotIdentity(db);
    const changes = diff(before, after);
    restoreIdentity(db, before);                       // revert…
    const restored = snapshotIdentity(db);
    db.close(); fs.unlinkSync(tmp);
    const identical = JSON.stringify(before) === JSON.stringify(restored);
    const noLogoSeed = !changes.some(c => c.logoSeed);
    console.log(`\n[verify] ${stats.docsSeen} confirmed docs over ${stats.templates} templates; ${changes.length} would change.`);
    printDiff(changes);
    console.log(`\n[verify] C-A (no logo seeded automatically): ${noLogoSeed ? 'PASS' : 'FAIL'}`);
    console.log(`[verify] C-D (apply→revert byte-identical): ${identical ? 'PASS' : 'FAIL'}`);
    process.exit(identical && noLogoSeed ? 0 : 1);
  }

  // ── DRY RUN (on a temp copy — the live DB is never touched) ────────────────────
  if (!APPLY) {
    const tmp = copyToTemp(DB);
    const db = new Database(tmp);
    const before = snapshotIdentity(db);
    const stats = enrichAll(db);
    const changes = diff(before, snapshotIdentity(db));
    db.close(); fs.unlinkSync(tmp);
    console.log(`\nDRY RUN — ${stats.docsSeen} confirmed docs over ${stats.templates} templates:`);
    printDiff(changes);
    console.log('\nRe-run with --apply to back up + snapshot + enrich, or --verify for the C-D round-trip proof.');
    return;
  }

  // ── APPLY (back up the DB + write a snapshot, then enrich in place) ────────────
  const stamp  = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = DB.replace(/\.db$/, `.backup-${stamp}.db`);
  fs.copyFileSync(DB, backup);
  console.log('Backed up DB to:', backup);

  const db = new Database(DB); db.pragma('busy_timeout = 4000');
  const before = snapshotIdentity(db);
  const snapFile = path.join(path.dirname(DB), `template-enrich-snapshot-${stamp}.json`);
  fs.writeFileSync(snapFile, JSON.stringify(before), 'utf8');
  console.log('Wrote revert snapshot:', snapFile);

  const stats = enrichAll(db);
  const changes = diff(before, snapshotIdentity(db));
  db.close();
  printDiff(changes);
  if (changes.some(c => c.logoSeed)) {
    console.error('\n⚠ A logo was SEEDED automatically — this is a C-A violation. Revert immediately:');
    console.error(`   node scripts/template-enrich-backfill.js --revert "${snapFile}"`);
    process.exit(1);
  }
  console.log(`\nApplied. ${stats.docsSeen} confirmed docs replayed over ${stats.templates} templates.`);
  console.log('Reopen ScanFinder and reprocess the held documents — they should now match their own-type template.');
  console.log(`Undo (surgical): node scripts/template-enrich-backfill.js --revert "${snapFile}"`);
  console.log(`Undo (full):     copy ${backup} back over the live DB.`);
}

main();
