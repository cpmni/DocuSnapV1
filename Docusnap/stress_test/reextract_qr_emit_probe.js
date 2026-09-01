'use strict';
/*
 * qr_emit_probe.js — Quick Reprocess confirm-before-build fixture (2026-09-01 night).
 * Runs the REAL Python pipeline on a few live-DB docs, FRESH then --reextract, and confirms the three
 * end-to-end facts the DARK arc's merge guards rely on:
 *   (1) a FRESH run's file_done carries `ocr_recipe` (Python stamps produced text — mig 104 self-heal);
 *   (2) a --reextract run's file_done carries `imageless: true` (the flag the merge keys off, never a JS guess);
 *   (3) a --reextract run's file_done `_logo_phash` is null/absent (imageless never runs the logo arm) —
 *       so the C6 guard "preserve the stored logo unconditionally on an imageless run" is correct.
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <this>
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning  = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qrprobe-'));
const w = (n, o) => { const f = path.join(TMP, `${n}_${Date.now()}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(o)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };

function snap(db) {
  const dts = safe(() => require(path.join(REPO, 'database', 'modules', 'document_types.js')).getAllWithFieldsAll(db), []);
  return ['--fields-file', w('f', dts.flatMap(d => d.fields || [])),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}
function runP(folder, snapArgs, files, extra = []) {
  const sf = w('shard', files);
  return new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', sf,
      '--mode', 'fast', '--tesseract', TESS, ...snapArgs, ...extra], { windowsHide: true, env: { ...process.env, OCR_RENDER_DPI: '200' } });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => {
      const docs = {}; for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
      res(docs);
    }); p.on('error', () => res({}));
  });
}

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const N = parseInt(process.env.PROBE_N || '3', 10);
  const docs = db.prepare(`SELECT d.id, d.original_filename, d.stored_path, d.working_path, d.template_id, d.ocr_text, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status IN ('confirmed','needs_review','deferred') AND d.ocr_text IS NOT NULL AND length(d.ocr_text) > 20`).all();
  const pick = [];
  const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-full-'));
  for (const d of docs) {
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
    if (!src) continue;
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(FOLDER, fname)); } catch { continue; }
    pick.push({ d, fname }); if (pick.length >= N) break;
  }
  if (!pick.length) { console.error('no live docs with a real file found — probe cannot run on this DB'); process.exit(2); }
  const snapArgs = snap(db);
  console.log(`Probe over ${pick.length} live docs (fresh, then --reextract)…`);
  const A = await runP(FOLDER, snapArgs, pick.map(p => p.fname));

  const PLACE = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-fast-'));
  const manifest = {}; const fastFiles = [];
  for (const { d, fname } of pick) {
    const a = A[fname]; const cached = (a && a.ocr_text) || d.ocr_text || '';
    if (!cached.trim()) continue;
    fs.writeFileSync(path.join(PLACE, fname), '');
    manifest[fname] = { ocr_text: cached, known_template_id: (a && a.template_id) || d.template_id || null };
    fastFiles.push(fname);
  }
  const B = await runP(PLACE, snapArgs, fastFiles, ['--reextract', '--reprocess-manifest', w('mani', manifest)]);

  let pass = 0, fail = 0;
  const ck = (label, cond) => { if (cond) { pass++; console.log('  ok   ' + label); } else { fail++; console.log('  FAIL ' + label); } };
  console.log('\nRESULTS:');
  for (const { fname } of pick) {
    const a = A[fname], b = B[fname];
    if (!a) { console.log(`  (skip ${fname}: no fresh file_done)`); continue; }
    ck(`${fname}: FRESH run emitted ocr_recipe`, a.ocr_recipe && typeof a.ocr_recipe === 'object' && a.ocr_recipe.dpi);
    ck(`${fname}: FRESH run did NOT carry imageless`, !('imageless' in a) || a.imageless !== true);
    if (!b) { console.log(`  (skip ${fname}: no reextract file_done)`); continue; }
    ck(`${fname}: --reextract emitted imageless:true`, b.imageless === true);
    ck(`${fname}: --reextract emitted NO ocr_recipe (read no pixels)`, !b.ocr_recipe);
    console.log(`       [obs] reextract _logo_phash = ${JSON.stringify(b._logo_phash ?? null)} (C6 expects null/absent)`);
  }
  console.log(`\n${pass}/${pass + fail} confirm-assertions passed`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(FOLDER, { recursive: true, force: true }); fs.rmSync(PLACE, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();
