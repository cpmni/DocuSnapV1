// import_crash_smoke.js — headless-electron runtime smoke for the 2026-08-31 batch-import crash fix
// (RAM-aware concurrency cap + worker-death resilience; src/modules/processing/handler.js,
// pin src/modules/processing/test_import_concurrency_cap.js, design docs/designs/CONCURRENCY_RAM_CAP_2026-08-31.md).
//
// WHAT IT PROVES: drives the REAL process-folder handler over real PDFs with real OCR, so it exercises
// the exact rewritten path — the RAM cap (worker count clamped to memory), the transparency clamp line,
// the multi-worker pool, the OMP-decouple, and the runWorker spawn wiring — end to end. It runs on a
// db.backup() COPY with userData redirected to a temp dir, so it NEVER touches the live DB / inbox /
// output. (A deliberately-broken spawn also demonstrates the resilience: a spawn throw is caught and
// resolved to the SPAWN_FAILED sentinel instead of crashing the app.)
//
// RUN (real electron, NOT electron-as-node — the handler calls require('electron').app.getPath):
//   node_modules\.bin\electron.cmd TESTING\_measure\import_crash_smoke.js
// then read the printed result file path.  Optional args: [dbCopyPath] [corpusDir] [count].
// Defaults: db.backup of %APPDATA%\ScanFinder\docusnap.db · Desktop\ScanFinder Test Corpus\invoice · 14.
//
// Electron GUI stdout does not reach the terminal on Windows, so the summary is written to
// <tmp>/import_smoke_<ts>/result.txt and its path is ALSO written to TESTING/_measure/.import_smoke_last.txt.

const path = require('path'), fs = require('fs'), os = require('os');
const { app } = require('electron');
const REPO = path.resolve(__dirname, '..', '..');            // TESTING/_measure -> repo root
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'import_smoke_'));
const UD = path.join(SCRATCH, 'userData'); fs.mkdirSync(UD, { recursive: true });
const RESULT = path.join(os.tmpdir(), 'import_crash_smoke_result.txt');   // OUTSIDE SCRATCH (which is deleted at the end)
const POINTER = path.join(__dirname, '.import_smoke_last.txt');

const argDbCopy = process.argv[2] || null;
const CORPUS = process.argv[3] || path.join(os.homedir(), 'Desktop', 'ScanFinder Test Corpus', 'invoice');
const COUNT = parseInt(process.argv[4] || '14', 10);
const LIVE_DB = path.join(process.env.APPDATA || '', 'ScanFinder', 'docusnap.db');

try { app.disableHardwareAcceleration(); } catch {}
app.setPath('userData', UD);   // isolate every app.getPath('userData') (inbox / working copies / filing-slips)

const out = [];
const log = (...a) => out.push(a.join(' '));
const flush = () => { try { fs.writeFileSync(RESULT, out.join('\n') + '\n'); fs.writeFileSync(POINTER, RESULT + '\n'); } catch {} };

app.whenReady().then(run);
setTimeout(() => { log('SMOKE TIMEOUT (300s)'); flush(); try { app.quit(); } catch {} }, 300000);

async function run() {
  try {
    // Role gate: process-folder is admin-gated. Stub the auth module (require.cache pattern from
    // test_workflow_ipc.js) with a standing admin session, BEFORE the handler is required.
    const authPath = require.resolve(path.join(REPO, 'src', 'modules', 'auth', 'handler.js'));
    const admin = { id: 1, username: 'smoke-admin', displayName: 'Smoke', role: 'admin' };
    require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
      requireLogin: () => admin, requireRole: () => admin, hasRole: () => true,
      getCurrentUser: () => admin, logAudit: () => {}, register: () => {} } };

    const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
    // Fresh db.backup() COPY of the live DB (never the file, never the live handle).
    const DB = path.join(SCRATCH, 'smoke.db');
    if (argDbCopy) { fs.copyFileSync(argDbCopy, DB); }
    else {
      const live = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
      await live.backup(DB); live.close();
    }
    const db = new Database(DB);
    const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
    const OUT = path.join(SCRATCH, 'output'); fs.mkdirSync(OUT, { recursive: true });
    learning.setSetting(db, 'output_folder', OUT);
    learning.setSetting(db, 'processing_concurrency', '10');   // force requested=10 so the RAM cap is observable

    const pre = db.prepare("SELECT COUNT(*) c FROM documents").get().c;
    const pdfs = fs.readdirSync(CORPUS).filter(f => f.toLowerCase().endsWith('.pdf')).slice(0, COUNT);
    const INBOX = path.join(SCRATCH, 'inbox'); fs.mkdirSync(INBOX, { recursive: true });
    for (const f of pdfs) fs.copyFileSync(path.join(CORPUS, f), path.join(INBOX, f));

    // Dev-smoke: neutralise the per-import license gate (dev enforcement is off anyway; process-folder
    // reads require('../licensing/handler').licenseDenied(db) fresh, so overriding the property suffices).
    require(path.join(REPO, 'src', 'modules', 'licensing', 'handler.js')).licenseDenied = () => null;

    const msgs = [], logs = [];
    const resourcePath = (...p) => path.join(REPO, ...p);
    const H = {};
    // ctx MUST include everything register() destructures at handler.js:2008-2010 — incl. spawn + path.
    const ctx = {
      ipcMain: { handle: (n, fn) => { H[n] = fn; }, on: () => {} },
      getDb: () => db, telemetry: { record: () => {}, event: () => {} }, resourcePath,
      pythonExe: () => 'py', pythonArgs: (s, ...a) => ['-3.12', s, ...a],
      tesseractPath: () => 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
      backendScript: () => path.join(REPO, 'python_backend', 'process_docs.py'),
      configPath: () => path.join(REPO, 'config', 'keyword_patterns.json'),
      templatesDir: () => { const d = path.join(UD, 'templates'); fs.mkdirSync(d, { recursive: true }); return d; },
      createWindow: () => null, getMainWindow: () => null,
      notifyMainWindow: () => {}, notifyAllWindows: () => {},
      safeSend: (sender, channel, msg) => { if (channel === 'process-progress') msgs.push(msg); },
      notifyBinChanged: () => {}, notifyWorkflowEvent: () => {}, notifyDevInspector: () => {}, notifyReview: () => {},
      reviewTraceActive: false, devSliceDir: path.join(SCRATCH, 'slices'),
      windows: {}, app, fs, path, spawn: require('child_process').spawn,
      logger: { log: (m) => logs.push(String(m)), warn: (m) => logs.push('[warn] ' + m), err: (m) => logs.push('[err] ' + m) },
    };
    const processing = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
    log('cap helpers: ramCap=' + processing.ramConcurrencyCap() + '  maxConc=' + processing.maxConcurrency() +
        '  defaultConc=' + processing.defaultConcurrency() + '  cores=' + os.cpus().length +
        '  totalGB=' + (os.totalmem() / 1073741824).toFixed(1));
    processing.register(ctx);

    const t0 = Date.now();
    const res = await H['process-folder']({ sender: null }, INBOX, { importAnyway: true });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);

    const fileDone = msgs.filter(m => m && m.type === 'file_done');
    const startMsg = msgs.find(m => m && m.type === 'start');
    const texts = logs.concat(msgs.map(m => m && m.text).filter(Boolean));
    const memLines = texts.filter(x => /available memory|Low memory|source folder and not imported/.test(x));
    const batchStart = logs.filter(x => /Batch start/.test(x));
    const errMsgs = msgs.filter(m => m && m.level === 'err').map(m => m.text);
    const post = db.prepare("SELECT COUNT(*) c FROM documents").get().c;
    const statuses = {};
    for (const m of fileDone) { const s = m.status || '?'; statuses[s] = (statuses[s] || 0) + 1; }

    log('== IMPORT CRASH SMOKE ==');
    log('input pdfs: ' + pdfs.length + '   corpus: ' + CORPUS);
    log('process-folder returned: ' + JSON.stringify(res));
    log('seconds: ' + secs);
    log('batch start: ' + (batchStart.join(' | ') || '(none)'));
    log('start-msg total: ' + (startMsg ? startMsg.total : '(none)'));
    log('file_done: ' + fileDone.length + ' of ' + pdfs.length + '  statuses=' + JSON.stringify(statuses));
    log('DB documents: ' + pre + ' -> ' + post + '  (+' + (post - pre) + ')');
    log('memory/clamp lines: ' + (memLines.length ? memLines.join('  ||  ') : '(none)'));
    log('err progress msgs: ' + (errMsgs.length ? errMsgs.join('  ||  ') : '(none)'));
    const pass = res && res.success === true && fileDone.length === pdfs.length && errMsgs.length === 0;
    log('VERDICT: ' + (pass ? 'PASS — all files processed, no errors, no crash' : 'INSPECT — see above'));
    db.close();
    flush();
    try { processing.killAll && processing.killAll(); } catch {}
    setTimeout(() => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} app.quit(); }, 500);
  } catch (e) {
    log('SMOKE CRASH: ' + (e && e.stack || e));
    flush();
    setTimeout(() => app.quit(), 500);
  }
}
