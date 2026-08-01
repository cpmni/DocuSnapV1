#!/usr/bin/env node
'use strict';
/**
 * scripts/link-confirmed-templates.js
 * One-off, REVERSIBLE retro-heal for the type-refuse learning deadlock (Oracle condition ii,
 * 2026-08-01 — the docs confirmed BEFORE R1 link-on-confirm shipped still carry template_id
 * NULL, so they never taught their template).
 *
 * For every CONFIRMED doc with template_id NULL, resolves the same Oracle-signed name-primary
 * reuse R1 now runs live (templates.reuseByEstablishedName — EXACT normalised established
 * identity + same type slug), links the doc, and runs learnTemplateOnCommit so the template
 * warms (hash append + fingerprint intersect). Machine 'scope_sweep' confirms are skipped.
 *
 *   1. Close ScanFinder (so the DB isn't locked).
 *   2. node scripts/link-confirmed-templates.js            (dry run — shows what it WOULD link)
 *      node scripts/link-confirmed-templates.js --apply    (backs up the DB, then links + enriches)
 *
 * Backup: docusnap.backup-<timestamp>.db beside the live DB; undo = copy it back.
 * After --apply: Reprocess-all in Review heals any still-queued docs of the same classes.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const templates = require(path.join(ROOT, 'database', 'modules', 'templates'));

const APPLY = process.argv.includes('--apply');
const DB = path.join(process.env.APPDATA || '', 'ScanFinder', 'docusnap.db');
if (!fs.existsSync(DB)) { console.error('DB not found:', DB); process.exit(1); }

const ro = new Database(DB, { readonly: true });
let hasVia = true;
try { ro.prepare('SELECT confirmed_via FROM documents LIMIT 0'); } catch { hasVia = false; }
const rows = ro.prepare(`
  SELECT d.id, d.original_filename, d.supplier_name, dt.slug AS type_slug
    FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
   WHERE d.status = 'confirmed' AND d.template_id IS NULL
     AND TRIM(COALESCE(d.supplier_name, '')) <> ''
     ${hasVia ? "AND COALESCE(d.confirmed_via, '') <> 'scope_sweep'" : ''}
   ORDER BY d.id`).all();
const plan = [];
for (const r of rows) {
  const tid = templates.reuseByEstablishedName(ro, r.supplier_name, r.type_slug, r.id);
  if (tid) plan.push({ ...r, tid });
}
ro.close();

console.log(`Confirmed docs with no template link: ${rows.length}; resolvable by established identity: ${plan.length}`);
for (const p of plan) console.log(`  #${p.id} ${p.original_filename} [${p.supplier_name} / ${p.type_slug}] -> template ${p.tid}`);
if (!plan.length) { console.log('Nothing to link.'); process.exit(0); }
if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to back up + link + enrich.'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = DB.replace(/\.db$/, `.backup-${stamp}.db`);
fs.copyFileSync(DB, backup);
for (const ext of ['-wal', '-shm']) { try { if (fs.existsSync(DB + ext)) fs.copyFileSync(DB + ext, backup + ext); } catch {} }
console.log('Backed up to:', backup);

const db = new Database(DB);
db.pragma('busy_timeout = 4000');
let linked = 0;
for (const p of plan) {
  db.prepare('UPDATE documents SET template_id = ? WHERE id = ? AND template_id IS NULL').run(p.tid, p.id);
  try { templates.learnTemplateOnCommit(db, p.id, { document_type_slug: p.type_slug, supplier_name: p.supplier_name }); } catch (e) { console.warn(`  #${p.id} enrich: ${e.message}`); }
  linked++;
}
db.close();
console.log(`Linked + enriched ${linked} doc(s). Reopen ScanFinder; Reprocess-all heals any still-queued siblings.`);
console.log('Undo: copy the backup back over docusnap.db.');
