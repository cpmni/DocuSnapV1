#!/usr/bin/env node
'use strict';
/* trace_single_doc.js — run ONE PDF through process_docs.py exactly as the app does (buildTrainingArgs + the app's
 * spawn env mirrored from the LIVE DB read-only) WITH --trace/--slice-dir, and save every stdout line to
 * trace_<tag>.jsonl (+ the log lines to trace_<tag>.log). Read-only on the DB; writes only to this folder + temp.
 *   ELECTRON_RUN_AS_NODE=1 OCR_RENDER_DPI=200 node_modules/electron/dist/electron.exe <this> <pdf> <tag> [ENV=val …] */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const OUT = path.join(REPO, 'TESTING', '_measure', 'teach_import_20260907');
const pdf = process.argv[2], tag = process.argv[3] || 'trace';
const overrides = {};
for (const kv of process.argv.slice(4)) { const i = kv.indexOf('='); if (i > 0) overrides[kv.slice(0, i)] = kv.slice(i + 1); }
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA || 'C:/Users/cmccu/AppData/Roaming', 'ScanFinder', 'docusnap.db');
const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
const H = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
const cfg = path.join(REPO, 'config', 'keyword_patterns.json');
const built = H.buildTrainingArgs(db, () => cfg, null);
const appEnv = { ...(H._autoTitleEnv ? H._autoTitleEnv(db) : {}), ...(H._anchorCropEnv ? H._anchorCropEnv(db) : {}), ...(H._reconcileEnv ? H._reconcileEnv(db) : {}) };
db.close();
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-trace-'));
fs.copyFileSync(pdf, path.join(folder, path.basename(pdf)));
const filesFile = path.join(folder, 'files.json');
fs.writeFileSync(filesFile, JSON.stringify([path.basename(pdf)]));
const sliceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-slices-'));
const args = ['-3.12', path.join(REPO, 'python_backend', 'process_docs.py'),
  '--folder', folder, '--files-file', filesFile, '--mode', 'smart', '--trace', '--slice-dir', sliceDir,
  '--tesseract', 'C:/Program Files/Tesseract-OCR/tesseract.exe', ...built.args];
const env = { ...process.env, ...appEnv, OCR_RENDER_DPI: process.env.OCR_RENDER_DPI || '200', ...overrides };
const t0 = Date.now();
let out = '', err = '';
const p = spawn('py', args, { env, windowsHide: true });
p.stdout.on('data', d => { out += d; });
p.stderr.on('data', d => { err += d; });
p.on('close', (code) => {
  const ms = Date.now() - t0;
  const lines = out.split('\n').filter(l => l.trim());
  const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } });
  const done = parsed.filter(x => x && x.type === 'file_done')[0];
  const logs = parsed.filter(x => x && x.type === 'log').map(x => x.text);
  fs.writeFileSync(path.join(OUT, `trace_${tag}.jsonl`), out);
  fs.writeFileSync(path.join(OUT, `trace_${tag}.log`), logs.join('\n') + '\n\nSTDERR:\n' + err);
  console.log(JSON.stringify({ tag, wall_ms: ms, exit: code, overrides, slices: sliceDir,
    result: done ? { type: done.document_type, supplier: done.supplier_name, conf: done.overall_confidence, needs_review: done.needs_review } : null }));
});
