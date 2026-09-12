'use strict';
/**
 * build_warm_db.js — build a self-contained WARM test DB from a synthetic corpus + ground_truth.json,
 * so the flip-gate harness (realdoc_regression.js, RR_DB) runs UNCHANGED against controlled data instead
 * of the poisonable live DB. (2026-09-12; gary corpus design; docs/DARK_SWITCH_LEDGER.md is the fix list.)
 *
 * Per (issuer, type):
 *   - teach ONE Stage-0.5 template from a digital "manually confirmed" doc (teach_from_gt.py), stored so
 *     Stage 0.5 fires on the test docs via realdoc's manifest (known_template_id);
 *   - HISTORY docs (manual, digital): status='confirmed', learning-ON, extractions + hints = GT → this is
 *     what builds the WARM learned state (getFieldFormats / graduation);
 *   - TEST docs (live, scan — exercise skew): status='confirmed', learning_excluded_at STAMPED, template_id
 *     set, and reference_number/doc_date/supplier_name columns + total extraction = the synthetic GT
 *     realdoc scores against. Visible to realdoc (RR_IDS), invisible to the warm state.
 *
 * The DB is built RELEASE-shaped (all dark switches OFF, no arm marker) so the census arms exactly ONE
 * switch per arm on a COPY. Prints `RR_IDS=<test ids>` for the census run.
 *
 * Usage (Electron-as-Node):
 *   CORPUS="<corpus root>" OUT_DB="<out.db>" GRAD_WINDOW=3 TESS="<tesseract.exe>" \
 *     ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/build_warm_db.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const docTypes = require(path.join(ROOT, 'database', 'modules', 'document_types'));
const learning = require(path.join(ROOT, 'database', 'modules', 'learning'));
const templates = require(path.join(ROOT, 'database', 'modules', 'templates'));

const CORPUS = process.env.CORPUS || path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', 'Flip Corpus Pilot');
const OUT = process.env.OUT_DB || path.join(CORPUS, 'warm_snapshot.db');
const TESS = process.env.TESS || 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const GRAD = parseInt(process.env.GRAD_WINDOW || '3', 10);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'warmdb-'));

const OCR_TYPE = { date: 'date', currency: 'currency', number: 'currency', reference: 'alphanumeric',
                   reference_code: 'reference_code', vat_gb: 'text', alphanumeric: 'alphanumeric' };

function log(...a) { console.log('[warmdb]', ...a); }

// ── load GT ────────────────────────────────────────────────────────────────
const gtPath = path.join(CORPUS, 'ground_truth.json');
if (!fs.existsSync(gtPath)) { console.error('no ground_truth.json at ' + gtPath); process.exit(2); }
const gt = JSON.parse(fs.readFileSync(gtPath, 'utf8'));
log(`corpus ${CORPUS}: ${gt.length} GT rows`);

// ── fresh RELEASE-shaped DB (switches OFF, no marker) ────────────────────────
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(OUT + ext); } catch {} }
const db = new Database(OUT);
runMigrations(db, { identity: { testBuild: false, buildRev: 'warmdb' } });
docTypes.seedBuiltInTypes(db);
try { docTypes.addPresetTypes(db, ['delivery_note', 'quote', 'credit_note', 'statement']); } catch (e) { log('preset add:', e.message); }
if (!db.prepare(`SELECT 1 FROM document_types WHERE slug='service_worksheet'`).get()) {
  const r = docTypes.addType(db, { name: 'Service Worksheet' });
  docTypes.addField(db, { document_type_id: r.lastInsertRowid, key: 'worksheet_number', label: 'Worksheet No', type: 'reference' });
  docTypes.addField(db, { document_type_id: r.lastInsertRowid, key: 'worksheet_date', label: 'Date', type: 'date' });
  docTypes.ensureStructuralRoles(db, r.lastInsertRowid);
  db.prepare(`UPDATE document_types SET ref_field_key='worksheet_number', date_field_key='worksheet_date' WHERE id=?`).run(r.lastInsertRowid);
}
const EXTRAS = [['vat_no', 'VAT No', 'vat_gb'], ['account_no', 'Account No', 'reference'],
                ['job_ref', 'Job Ref', 'reference'], ['po_ref', 'Your PO', 'reference'],
                ['customer_name', 'Customer', 'text'], ['total_amount', 'Total', 'currency']];
for (const dt of db.prepare('SELECT id, slug FROM document_types').all()) {
  for (const [key, label, type] of EXTRAS) {
    if (!db.prepare('SELECT 1 FROM fields WHERE document_type_id=? AND key=?').get(dt.id, key)) {
      try { docTypes.addField(db, { document_type_id: dt.id, key, label, type }); } catch {}
    }
  }
}
learning.setSetting(db, 'graduation_window', String(GRAD));

const dts = db.prepare('SELECT * FROM document_types').all();
const refKeyBySlug = {}, dateKeyBySlug = {}, dtIdBySlug = {}, typeByKeyBySlug = {};
for (const dt of dts) { refKeyBySlug[dt.slug] = dt.ref_field_key; dateKeyBySlug[dt.slug] = dt.date_field_key; dtIdBySlug[dt.slug] = dt.id; }
for (const f of db.prepare('SELECT dt.slug, f.key, f.type FROM fields f JOIN document_types dt ON dt.id=f.document_type_id').all())
  (typeByKeyBySlug[f.slug] || (typeByKeyBySlug[f.slug] = {}))[f.key] = (f.type || '').toLowerCase();

// ── GT row → extraction rows / teach fields ──────────────────────────────────
function fieldPairs(r, slug) {
  const rk = refKeyBySlug[slug], dk = dateKeyBySlug[slug];
  const out = [];
  const add = (key, val, conf, meth) => { if (key && val != null && String(val).trim() !== '') out.push({ field_key: key, value: String(val), confidence: conf, method: meth }); };
  add(rk, r.ref, 95, 'template_mapping');
  add(dk, r.date, 95, 'template_mapping');
  add('supplier_name', r.issuer, 95, 'template_fixed');
  add('customer_name', r.customer, 90, 'template_mapping');
  add('total_amount', r.total, 95, 'template_mapping');
  for (const x of ['vat_no', 'account_no', 'job_ref', 'po_ref']) add(x, r[x], 90, 'keyword');
  return out;
}

// ── group by (issuer, type): history = manual+digital, test = live+scan, teach = one digital manual ──
const pairs = {};
for (const r of gt) {
  const k = `${r.issuer}|${r.type_slug}`;
  const P = pairs[k] || (pairs[k] = { issuer: r.issuer, slug: r.type_slug, history: [], test: [], teach: null });
  const manual = String(r.set || '').toLowerCase() === 'manual' || /manually confirmed/i.test(r.file || '');
  const digital = String(r.rendition || '').toLowerCase().startsWith('digital');
  if (manual && digital) { P.history.push(r); if (!P.teach) P.teach = r; }
  else if (!manual && !digital) P.test.push(r);   // live + scan → the held-out test docs (exercise skew)
}

// ── build ────────────────────────────────────────────────────────────────────
const insDoc = db.prepare(`INSERT INTO documents
  (original_filename, folder_path, working_path, document_type_id, supplier_name, reference_number, doc_date,
   status, overall_confidence, page_count, confirmed_at)
  VALUES (?,?,?,?,?,?,?, 'confirmed', 100, 1, datetime('now'))`);
const stampExcluded = db.prepare(`UPDATE documents SET learning_excluded_at = datetime('now') WHERE id = ?`);
const setTid = db.prepare(`UPDATE documents SET template_id = ? WHERE id = ?`);

function insertDoc(r, slug, { excluded, templateId }) {
  const abs = path.join(CORPUS, r.file);
  const rk = refKeyBySlug[slug], dk = dateKeyBySlug[slug];
  const id = insDoc.run(path.basename(r.file), path.dirname(abs), abs, dtIdBySlug[slug], r.issuer,
                        (rk && r.ref != null) ? String(r.ref) : null,
                        (dk && r.date != null) ? String(r.date) : null).lastInsertRowid;
  if (excluded) stampExcluded.run(id);
  if (templateId) setTid.run(templateId, id);
  const rows = fieldPairs(r, slug).map(p => ({ field_key: p.field_key, raw_value: p.value, display_value: p.value,
                                               confidence: p.confidence, extraction_method: p.method, validation_note: null }));
  try { learning.insertExtractions(db, id, rows); } catch (e) { log(`insertExtractions #${id}:`, e.message); }
  if (!excluded) for (const row of rows) { try { learning.saveHint(db, r.issuer, slug, row.field_key, row.display_value); } catch {} }
  return id;
}

function teachTemplate(P) {
  const r = P.teach, slug = P.slug;
  const fields = {};
  for (const p of fieldPairs(r, slug)) fields[p.field_key] = p.value;
  const job = path.join(TMP, `job_${slug}_${P.issuer.replace(/[^a-z0-9]+/gi, '')}.json`);
  fs.writeFileSync(job, JSON.stringify({ pdf: path.join(CORPUS, r.file), fields }));
  const res = spawnSync('py', ['-3.12', path.join(ROOT, 'stress_test', 'teach_from_gt.py'), '--job', job, '--tesseract', TESS],
                        { encoding: 'utf8', windowsHide: true });
  let out; try { out = JSON.parse(res.stdout); } catch { log(`teach FAILED ${P.issuer}|${slug}: ${(res.stderr || res.stdout || '').slice(0, 160)}`); return null; }
  if (!out.mappings || !out.mappings.length) { log(`teach no mappings ${P.issuer}|${slug}`); return null; }
  const info = db.prepare(`INSERT INTO templates (name, slug, document_type_slug, confirmed_count, sample_deskew_angle)
                           VALUES (?,?,?,?,?)`).run(P.issuer,
    `warm_${(P.issuer + '_' + slug).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, slug, GRAD,
    (typeof out.sample_angle === 'number' ? out.sample_angle : null));
  const tid = info.lastInsertRowid;
  const typeByKey = typeByKeyBySlug[slug] || {};
  let n = 0;
  for (const m of out.mappings) {
    if (!(m.field_key in typeByKey)) continue;
    // Failure-mode injector — CODE-CLIP class (fires mig 141/151/161): cut the taught REF box so it clips a
    // leading (TEACH_JITTER_LEFT) or trailing (TEACH_JITTER) glyph, exactly the human cutting-draw disease the
    // corpus scorer uses. Scoped to the ref key so the class is clean. OFF ⇒ a shape-invalid clipped read held;
    // ON ⇒ the widen/left-grow re-read rescues it. Unset ⇒ GT-perfect boxes (byte-identical).
    if (m.field_key === refKeyBySlug[slug]) {
      const JL = parseFloat(process.env.TEACH_JITTER_LEFT || '0');
      if (JL > 0) { const cut = m.target.w * JL; m.target.x += cut; m.target.w -= cut; }
      const JR = parseFloat(process.env.TEACH_JITTER || '0');
      if (JR > 0) m.target.w = m.target.w * (1 - JR);
    }
    templates.saveMapping(db, tid, {
      field_key: m.field_key, page_number: 0, anchor_text: m.anchor_text,
      anchor_x_norm: m.anchor.x, anchor_y_norm: m.anchor.y, anchor_w_norm: m.anchor.w, anchor_h_norm: m.anchor.h,
      target_x_norm: m.target.x, target_y_norm: m.target.y, target_w_norm: m.target.w, target_h_norm: m.target.h,
      ocr_type: OCR_TYPE[typeByKey[m.field_key]] || 'text',
    });
    n++;
  }
  return { tid, n };
}

const testIds = [];
let tmplOk = 0, histN = 0, testN = 0;
for (const k of Object.keys(pairs).sort()) {
  const P = pairs[k];
  if (!dtIdBySlug[P.slug]) { log(`skip ${k}: unknown type`); continue; }
  const t = P.teach ? teachTemplate(P) : null;
  if (t) tmplOk++;
  for (const r of P.history) { insertDoc(r, P.slug, { excluded: false, templateId: t ? t.tid : null }); histN++; }
  for (const r of P.test) { testIds.push(insertDoc(r, P.slug, { excluded: true, templateId: t ? t.tid : null })); testN++; }
  log(`${k}: template ${t ? t.tid + ' (' + t.n + ' fields)' : 'NONE'} · history ${P.history.length} · test ${P.test.length}`);
}

db.close();
log(`DONE → ${OUT}`);
log(`templates ${tmplOk} · history(confirmed, learning-on) ${histN} · test(confirmed, learning-excluded) ${testN}`);
console.log('RR_IDS=' + testIds.join(','));
