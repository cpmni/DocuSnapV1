'use strict';
/*
 * scripts/backfill_logo_detail.js — ONE-TIME: activate the Slice-C logo veto on EXISTING data.
 *
 * Slice B only captures the isolated-mark detail hash on NEW confirms, so pre-existing confirmed docs
 * (and their template / supplier logo sets) have detail_hash = NULL and the veto stays inert. This
 * recomputes the detail hash for every confirmed doc that has a file + a stored logo_phash, and BACKFILLS
 * it onto the matching logo_fingerprints + template_logo_hashes rows (only where detail_hash IS NULL).
 *
 * SAFE: additive + non-destructive — it only fills NULLs (never overwrites, never touches phashes,
 * documents, filed files, or any value). Reversible by clearing the detail_hash columns.
 *
 * ⚠ Run with the app CLOSED (better-sqlite3 single-writer) and BACK UP docusnap.db first.
 * Usage: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/backfill_logo_detail.js [--dry]
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const DBP = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const HELPER = path.join(REPO, 'stress_test', '_logo_detail_hash.py');
const DRY = process.argv.includes('--dry');

const db = new Database(DBP, { readonly: DRY });
const rows = db.prepare(`
  SELECT id, supplier_name, template_id, logo_phash, working_path, stored_path, folder_path, stored_filename
  FROM documents
  WHERE status = 'confirmed' AND logo_phash IS NOT NULL AND logo_phash <> ''
`).all();

const resolveFile = d => {
  if (d.working_path && fs.existsSync(d.working_path)) return d.working_path;
  if (d.stored_path && fs.existsSync(d.stored_path)) return d.stored_path;
  if (d.folder_path && d.stored_filename) {
    const p = path.join(d.folder_path, d.stored_filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const withFile = [];
for (const d of rows) { const f = resolveFile(d); if (f) withFile.push({ ...d, file: f }); }
console.log(`${rows.length} confirmed docs with a phash · ${withFile.length} with a resolvable file`);
if (!withFile.length) { db.close(); process.exit(0); }

// Compute detail hashes in one Python pass (dedup identical files).
const uniqFiles = [...new Set(withFile.map(d => d.file))];
const inFile = path.join(os.tmpdir(), `bfld_${Date.now()}.json`);
fs.writeFileSync(inFile, JSON.stringify(uniqFiles));
console.log(`computing detail hashes for ${uniqFiles.length} files…`);
const r = spawnSync('py', ['-3.12', HELPER, inFile], { encoding: 'utf8', maxBuffer: 1 << 28 });
try { fs.unlinkSync(inFile); } catch {}
let detailByFile = {};
try { detailByFile = JSON.parse((r.stdout || '').trim().split('\n').pop()); }
catch { console.error('detail-hash helper failed:', (r.stderr || '').slice(0, 500)); db.close(); process.exit(1); }

const upTpl = db.prepare(`UPDATE template_logo_hashes SET detail_hash = ?
  WHERE template_id = ? AND phash = ? AND (detail_hash IS NULL OR detail_hash = '')`);
const upFp  = db.prepare(`UPDATE logo_fingerprints SET detail_hash = ?
  WHERE supplier_name = ? AND phash = ? AND (detail_hash IS NULL OR detail_hash = '')`);

let nTpl = 0, nFp = 0, nNoHash = 0;
const run = db.transaction(() => {
  for (const d of withFile) {
    const detail = (detailByFile[d.file] || {}).colour;   // colour = the raw-page detail the engine computes at match time
    if (!detail) { nNoHash++; continue; }
    if (d.template_id) nTpl += upTpl.run(detail, d.template_id, d.logo_phash).changes;
    if (d.supplier_name) nFp += upFp.run(detail, d.supplier_name, d.logo_phash).changes;
  }
});
if (!DRY) run(); else console.log('(dry run — no writes)');

console.log(`\ntemplate_logo_hashes rows backfilled: ${DRY ? '(dry)' : nTpl}`);
console.log(`logo_fingerprints rows backfilled:    ${DRY ? '(dry)' : nFp}`);
console.log(`docs whose mark could not be isolated (skipped): ${nNoHash}`);
const cov = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN detail_hash IS NOT NULL AND detail_hash <> '' THEN 1 ELSE 0 END) d FROM template_logo_hashes").get();
console.log(`\ntemplate_logo_hashes detail-hash coverage now: ${cov.d}/${cov.n}`);
db.close();
console.log(DRY ? '\nDRY RUN complete.' : '\nBackfill complete — the Slice-C veto is now active on enrolled suppliers.');
