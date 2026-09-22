'use strict';
/*
 * profile_single_doc.js — where do the seconds go in a single-document import? Spawns process_docs.py the way
 * the app does (buildTrainingArgs + the app's own spawn env, mirrored from the LIVE DB read-only) under
 * cProfile, for ONE PDF, with optional env overrides for A/B arms. Read-only on the DB; writes only to the
 * arm's temp folder + the profile file.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe TESTING/_measure/teach_import_20260907/profile_single_doc.js <pdf> <tag> [KEY=VAL ...]
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const OUT = path.join(REPO, 'TESTING', '_measure', 'teach_import_20260907');
const pdf = process.argv[2], tag = process.argv[3] || 'base';
const overrides = {};
for (const kv of process.argv.slice(4)) { const i = kv.indexOf('='); if (i > 0) overrides[kv.slice(0, i)] = kv.slice(i + 1); }
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
const H = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
const cfg = path.join(REPO, 'config', 'keyword_patterns.json');
const built = H.buildTrainingArgs(db, () => cfg, null);
const appEnv = { ...(H._autoTitleEnv ? H._autoTitleEnv(db) : {}), ...(H._anchorCropEnv ? H._anchorCropEnv(db) : {}), ...(H._reconcileEnv ? H._reconcileEnv(db) : {}) };
db.close();
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-prof-'));
fs.copyFileSync(pdf, path.join(folder, path.basename(pdf)));
const filesFile = path.join(folder, 'files.json');
fs.writeFileSync(filesFile, JSON.stringify([path.basename(pdf)]));
const prof = path.join(OUT, `prof_${tag}.out`);
const args = ['-3.12', '-m', 'cProfile', '-o', prof, path.join(REPO, 'python_backend', 'process_docs.py'),
  '--folder', folder, '--files-file', filesFile, '--mode', 'smart', '--tesseract', 'C:/Program Files/Tesseract-OCR/tesseract.exe', ...built.args];
const env = { ...process.env, ...appEnv, OCR_RENDER_DPI: process.env.OCR_RENDER_DPI || '200', ...overrides };
const t0 = Date.now();
let out = '', err = '';
const p = spawn('py', args, { env, windowsHide: true });
p.stdout.on('data', d => { out += d; });
p.stderr.on('data', d => { err += d; });
p.on('close', (code) => {
  const ms = Date.now() - t0;
  const lines = out.split('\n').filter(l => l.trim());
  const done = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x && x.type === 'file_done')[0];
  const logs = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x && x.type === 'log').map(x => x.text);
  fs.writeFileSync(path.join(OUT, `run_${tag}.log`), logs.join('\n') + '\n\nSTDERR:\n' + err);
  console.log(JSON.stringify({ tag, wall_ms: ms, exit: code, overrides, appEnvKeys: Object.keys(appEnv).length,
    result: done ? { type: done.document_type, supplier: done.supplier_name, conf: done.overall_confidence, needs_review: done.needs_review } : null }));
  for (const f of built.tempFiles || []) { try { fs.unlinkSync(f); } catch {} }
  try { fs.rmSync(folder, { recursive: true, force: true }); } catch {}
});
