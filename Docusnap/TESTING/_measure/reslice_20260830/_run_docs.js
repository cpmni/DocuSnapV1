'use strict';
/* _run_docs.js — faithful single-shard replay of process_docs.py over a set of PDFs against a DB COPY.
 * Mirrors the app's import spawn: buildTrainingArgs(db) + _autoTitleEnv/_ocrDpiEnv/_anchorCropEnv/_reconcileEnv.
 * Usage (Electron-as-Node):
 *   ELECTRON_RUN_AS_NODE=1 electron _run_docs.js <db-copy> <outdir> <label> <pdf> [<pdf> ...]
 * Extra env from the caller is passed through (set switch arms there, e.g. CORROB_FORMAT_INVALID_WITNESS=0/1).
 * Writes <outdir>/<label>.jsonl (every stdout JSON line) + <outdir>/<label>_summary.json (per-doc fields). */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';

const [dbPath, outDir, label, ...rawFiles] = process.argv.slice(2);
// `@<listfile>` = one absolute path per line (paths with spaces survive cmd.exe argv splitting)
const files = rawFiles.flatMap(f => f.startsWith('@') ? fs.readFileSync(f.slice(1), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [f]);
if (!dbPath || !outDir || !label || !files.length) { console.log('usage: _run_docs.js <db> <outdir> <label> <pdf...|@listfile>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rd_'));
for (const f of files) fs.copyFileSync(f, path.join(folder, path.basename(f)));
const listFile = path.join(folder, '_files.json');
fs.writeFileSync(listFile, JSON.stringify(files.map(f => path.basename(f))));

const H = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
const db = new Database(dbPath, { fileMustExist: true });
const trainArgs = H.buildTrainingArgs(db, () => CFG).args;
// _ocrDpiEnv is not exported — replicate it (handler.js:91-97): setting ocr_dpi in [100,600], 300 ⇒ unset.
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const _dpiRaw = parseInt(learning.getSetting(db, 'ocr_dpi', '300'), 10);
const _dpi = (Number.isFinite(_dpiRaw) && _dpiRaw >= 100 && _dpiRaw <= 600) ? _dpiRaw : 300;
const dpiEnv = _dpi === 300 ? {} : { OCR_RENDER_DPI: String(_dpi) };
const env = { ...process.env, ...H._autoTitleEnv(db), ...dpiEnv, ...H._anchorCropEnv(db), ...H._reconcileEnv(db) };
console.log(`[env] ocr_dpi=${_dpi}; app vars=${Object.keys({ ...H._autoTitleEnv(db), ...H._anchorCropEnv(db), ...H._reconcileEnv(db) }).length}`);
// caller-supplied arms win over the DB-derived env (explicit '0' must be honoured — the != '0' idiom)
for (const k of Object.keys(process.env)) if (/^(CORROB_|FIELD_CORROBORATION_|RESLICE_|DESKEW_REVIEW|DESKEW_CORROB|OCR_RENDER_DPI|SFDEV|TEMPLATE_FORMAT_FAIL|XCHECK_DEMOTE_CENSUS)/.test(k)) env[k] = process.env[k];
db.close();
const sliceDir = path.join(outDir, label + '_slices'); fs.mkdirSync(sliceDir, { recursive: true });
const args = ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', listFile, '--mode', 'smart', '--tesseract', TESS,
  '--trace', '--slice-dir', sliceDir, ...trainArgs];
const t0 = Date.now();
const p = spawn('py', args, { windowsHide: true, env });
let out = '', err = '';
p.stdout.on('data', d => { out += d; });
p.stderr.on('data', d => { err += d; });
p.on('close', code => {
  fs.writeFileSync(path.join(outDir, label + '.jsonl'), out);
  if (err) fs.writeFileSync(path.join(outDir, label + '.stderr.txt'), err);
  const docs = {};
  for (const ln of out.split('\n')) {
    const t = ln.trim(); if (t[0] !== '{') continue;
    let m; try { m = JSON.parse(t); } catch { continue; }
    if (m.type !== 'file_done') continue;
    const ex = m.extractions || {};
    const fields = {};
    for (const [k, v] of Object.entries(ex)) {
      if (!v || typeof v !== 'object') continue;
      fields[k] = { value: v.value, confidence: v.confidence, method: v.method, note: v.validation_note || null,
                    corrected_to: v.corrected_to || null, corroboration: v.corroboration || null };
    }
    docs[m.original_filename] = { supplier: m.supplier_name, type: m.document_type, overall: m.overall_confidence,
      needs_review: m.needs_review, status: m.status, fields };
  }
  fs.writeFileSync(path.join(outDir, label + '_summary.json'), JSON.stringify(docs, null, 1));
  console.log(`${label}: exit ${code}, ${Object.keys(docs).length} docs, ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${outDir}`);
  try { fs.rmSync(folder, { recursive: true, force: true }); } catch {}
});
