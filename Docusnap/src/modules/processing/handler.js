'use strict';

/**
 * modules/processing/handler.js
 * Handles folder import, single-file reprocess, OCR region, logo ops.
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const diaglog = require('../diaglog');

// Coerce the stored processing_mode to a value the backend accepts. A stale/legacy value
// (e.g. an old "light", or one from a restored settings backup) must never reach
// process_docs.py's --mode and break the whole batch on an arg-parse error.
const _validMode = (m) => (m === 'fast' || m === 'smart' || m === 'ai') ? m : 'smart';

// Deep diagnostic logging is ON when the env override says so, or the admin
// setting is 'true'. When on we (a) ask the extractor for the full --trace +
// --slice-dir even with no inspector window open, and (b) tee every trace event
// to the JSONL diagnostic file. Off by default → no --trace → byte-identical
// pipeline. Env mirrors the licensing escape-hatch convention.
function _diagEnabled(db) {
  const env = (process.env.DOCUSNAP_DIAGNOSTIC_LOG || '').toLowerCase();
  if (env === 'on'  || env === 'true'  || env === '1') return true;
  if (env === 'off' || env === 'false' || env === '0') return false;
  try {
    return require('../../../database/modules/learning').getSetting(db, 'diagnostic_logging') === 'true';
  } catch { return false; }
}

let _currentBatchProcs = [];     // all running Python worker processes for the active batch (bounded pool)
let _singleReprocessActive = false;  // a single reprocess-document is in flight (NOT in the pool array)
// ANY OCR/extraction work is in flight — a batch (import / reprocess-all) OR a single reprocess.
// Used to SERIALISE heavy work: starting a second reprocess while one is running oversubscribes
// the CPU (every worker + the single proc OCR at once) and can race two merges into the same doc,
// which presents as the app "freezing". Reprocess entry points refuse when busy; the watch folder
// already defers on this signal.
function _anyProcessingBusy() { return _currentBatchProcs.length > 0 || _singleReprocessActive; }
let _cancelRequested   = false;  // set true when stop is requested; suppresses buffered stdout
let _pendingDrains     = [];     // originals to move to Processed/Errors AFTER the worker exits (pdfium holds the PDF open mid-run, so a mid-batch rename is locked)

// Dev-inspector ONLY: in-memory, session-scoped registry of docs processed while
// the app runs, plus their captured trace events. Never persisted (no SQLite, no
// settings); starts empty on every app launch (module load).
const _devSession = { docs: [], traceByDoc: new Map() };
function _recordDevDoc(msg) {
  const key = msg && (msg.original_filename || msg.filename);
  if (!key) return;
  const meta = { key, filename: key, supplier: msg.supplier_name || null,
                 docType: msg.document_type || null, status: msg.status || null,
                 confidence: msg.overall_confidence ?? null, ts: Date.now() };
  const existing = _devSession.docs.find(d => d.key === key);
  if (existing) Object.assign(existing, meta); else _devSession.docs.push(meta);
}
function _recordDevTrace(ev) {
  const key = ev && ev.doc;
  if (!key) return;
  let arr = _devSession.traceByDoc.get(key);
  if (!arr) { arr = []; _devSession.traceByDoc.set(key, arr); }
  arr.push(ev);
  if (arr.length > 4000) arr.shift();   // bound per-doc memory
}

// Supported input extensions — mirrors python_backend ocr.tesseract.SUPPORTED_EXTENSIONS
// and watch/handler.js. Used only to enumerate + shard files for the parallel
// worker pool; the per-document pipeline (and its file detection) is unchanged.
const BATCH_SUPPORTED_EXTS = new Set(
  ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp']
);

// Round-robin split so worker file counts stay balanced regardless of order.
function partitionRoundRobin(items, n) {
  const parts = Array.from({ length: n }, () => []);
  items.forEach((it, i) => parts[i % n].push(it));
  return parts.filter(p => p.length > 0);
}

// ── Write temp JSON files ─────────────────────────────────────────────────────
// Module-level (not register()-scoped closures) so other modules — e.g. the
// watch-folder handler — can reuse the exact same pipeline-setup machinery
// instead of duplicating it on a parallel import path.
let _tmpSeq = 0;
function writeTempJson(name, data) {
  // Process-unique suffix (pid + monotonic counter) so concurrent callers — the
  // bounded import pool and parallel Reprocess All — never collide on the same
  // temp filename within a single millisecond (Date.now() alone is not enough).
  const file = path.join(os.tmpdir(), `ds_${name}_${Date.now()}_${process.pid}_${_tmpSeq++}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch {}
  }
}

function buildTrainingArgs(db, configPath, logger = null) {
  const docTypes  = require('../../../database/modules/document_types');
  const learning  = require('../../../database/modules/learning');
  const templates = require('../../../database/modules/templates');

  const allDocTypes  = docTypes.getAllWithFields(db);
  const allHints     = learning.getHints(db);
  const allAnchors   = learning.getAllAnchors(db);
  const allLogos     = learning.getAllLogos(db);
  const allTemplates = templates.getAll(db);
  // Format model is the source of the qualification gate. The catch was SILENT,
  // which hid the cause when 0 formats reach the extractor despite many confirms
  // — log a throw (so a real failure is visible) and the resulting group count.
  let allFormats = [];
  try { allFormats = learning.getFieldFormats(db); }
  catch (e) { logger?.warn?.(`[training] getFieldFormats failed: ${e && e.message}`); }
  // Admin keyword label overrides (per-installation; merged onto the shipped
  // patterns at processing time, scoped to the doc-type slug). Guarded so an
  // older DB without migration 19 still processes (just with no overrides).
  let allLabelOverrides = [];
  try { allLabelOverrides = require('../../../database/modules/label_overrides').getForExtraction(db); }
  catch (e) { logger?.warn?.(`[training] label overrides load failed: ${e && e.message}`); }

  // Operator-taught field cleanup rules (Review right-click toolkit). Guarded so an
  // older DB without migration 36 still processes (just with no rules).
  let allFieldRules = [];
  try { allFieldRules = learning.getFieldRules(db); }
  catch (e) { logger?.warn?.(`[training] field rules load failed: ${e && e.message}`); }

  // Visible in processing.log so "0 formats loaded" can be traced to its source
  // (a throw above vs genuinely no qualifying confirmed history yet).
  logger?.log?.(`[training] ${allTemplates.length} templates, ${allFormats.length} format groups, ` +
                `${allAnchors.length} anchors, ${allHints.length} hints, ${allLabelOverrides.length} label overrides`);
  // Enumerate the learned format groups (key = supplier|doctype|field, with the
  // distinct-value count). This is the fastest way to see whether a given field
  // (e.g. 'date') is being learned at all — a field with no group here can't be
  // qualified/recovered, no matter what the anchor reads.
  if (allFormats.length) {
    const groups = allFormats
      .map(g => `${g.supplier_name || '∅'}|${g.document_type}|${g.field_key}(${(g.sample_values || []).length})`)
      .join(', ');
    logger?.log?.(`[training] format groups: ${groups}`);
  }
  diaglog.write({ ev: 'training_load',
    templates: allTemplates.length, anchors: allAnchors.length, hints: allHints.length,
    label_overrides: allLabelOverrides.length,
    format_groups: allFormats.map(g => ({
      key: `${g.supplier_name || ''}|${g.document_type}|${g.field_key}`,
      distinct: (g.sample_values || []).length,
      samples: (g.sample_values || []).slice(0, 5),
    })),
  });

  const fieldsFile    = writeTempJson('fields',    allDocTypes.flatMap(dt => dt.fields));
  const hintsFile     = writeTempJson('hints',     allHints);
  const anchorsFile   = writeTempJson('anchors',   allAnchors);
  const logosFile     = writeTempJson('logos',     allLogos);
  const dtFile        = writeTempJson('doctypes',  allDocTypes);
  const formatsFile   = writeTempJson('formats',   allFormats);
  const templatesFile = writeTempJson('templates', allTemplates);
  const overridesFile = writeTempJson('labeloverrides', allLabelOverrides);
  const fieldRulesFile = writeTempJson('fieldrules', allFieldRules);
  const cfgFile       = configPath();

  // Registration-invariant anchoring ("register, then read"): ON unless an admin
  // explicitly disables it (setting 'registration_enabled' = 'false'). It is inert
  // until a template actually has taught landmarks (template_landmarks), so the
  // default-on is safe — templates without landmarks behave exactly as before.
  let registrationOn = true;
  try { registrationOn = learning.getSetting(db, 'registration_enabled') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Born-digital text-layer extraction: ON unless an admin disables it
  // ('born_digital_enabled' = 'false'). Inert for image-only/scanned PDFs (no
  // text layer), so the default-on is safe — those pages still go through OCR.
  let bornDigitalOn = true;
  try { bornDigitalOn = learning.getSetting(db, 'born_digital_enabled') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Full-page OCR engine selection (Stage 1). DEFAULT 'tesseract' = byte-identical:
  // only the opt-in 'rapidocr' adds a flag, so an existing install's command line is
  // unchanged. Governs full-page OCR ONLY and falls back to Tesseract in Python if the
  // RapidOCR runtime/models aren't bundled. Crop/zone/anchor OCR is unaffected.
  let ocrEngine = 'tesseract';
  try { if (learning.getSetting(db, 'ocr_engine') === 'rapidocr') ocrEngine = 'rapidocr'; }
  catch { /* older DB without the setting -> default tesseract */ }

  // Free-text NAME wordness review flag: ON unless an admin disables it
  // ('name_wordness_flag' = 'false'). FLAG-ONLY — flags supplier/customer reads that
  // don't read like a name (document chrome / ref-code bleed / OCR garble / truncation)
  // so they surface for review; never rejects or rewrites a value. Inert unless the
  // char-trigram table ships (extraction/data/char_trigrams.json). See extraction/wordness.py.
  let nameWordnessOn = true;
  try { nameWordnessOn = learning.getSetting(db, 'name_wordness_flag') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Multi-line continuation reads (default ON; disabled by 'multiline_enabled' = 'false').
  // Inert without a multiline_continue field rule, so single-line reads stay byte-identical.
  let multilineOn = true;
  try { multilineOn = learning.getSetting(db, 'multiline_enabled') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  // Auto-rotate a sideways/upside-down scanned page (default ON; disabled by
  // 'auto_rotate_enabled' = 'false'). Inert for born-digital + confident-upright pages; the
  // per-page angles come back in file_done.page_rotations and the working copy is rotated to match.
  let autoRotateOn = true;
  try { autoRotateOn = learning.getSetting(db, 'auto_rotate_enabled') !== 'false'; }
  catch { /* older DB without the setting -> default on */ }

  const args = [
    '--fields-file',    fieldsFile,
    '--hints-file',     hintsFile,
    '--anchors-file',   anchorsFile,
    '--logos-file',     logosFile,
    '--doc-types-file', dtFile,
    '--formats-file',   formatsFile,
    '--templates-file', templatesFile,
    '--label-overrides-file', overridesFile,
    '--field-rules-file', fieldRulesFile,
    '--config-file',    cfgFile,
  ];
  if (registrationOn) args.push('--registration');
  if (bornDigitalOn) args.push('--born-digital');
  if (nameWordnessOn) args.push('--name-wordness');
  if (multilineOn) args.push('--multiline');
  if (autoRotateOn) args.push('--auto-rotate');
  if (ocrEngine === 'rapidocr') args.push('--ocr-engine', 'rapidocr');

  return {
    args,
    ocrEngine,   // 'tesseract' | 'rapidocr' — lets callers add RapidOCR-only speed flags
    tempFiles: [fieldsFile, hintsFile, anchorsFile, logosFile, dtFile, formatsFile, templatesFile, overridesFile, fieldRulesFile],
  };
}

// ── Safe path policy for "open in default app / reveal in Explorer" (F-06) ────
// shell.openPath launches a path with its OS handler — for an .exe/.lnk/UNC path
// that means code execution. The open-file / show-in-explorer IPC channels accept
// a renderer-supplied path, so it is constrained to (a) a known document/preview
// file type, (b) no UNC path, and (c) located inside an app-managed root OR a path
// recorded against a document row. Uses the module-level `path`/`fs` (Node core).
const ALLOWED_OPEN_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.xml']);

function _allowedOpenRoots(db) {
  const roots = [];
  try {
    const out = require('../../../database/modules/learning').getSetting(db, 'output_folder', null);
    if (out) roots.push(path.resolve(out));
  } catch { /* ignore */ }
  try {
    const { app } = require('electron');
    roots.push(path.resolve(path.join(app.getPath('userData'), 'inbox')));
  } catch { /* ignore (e.g. unit tests without an electron app) */ }
  return roots;
}

function _withinAnyRoot(resolved, roots) {
  return roots.some(r => resolved === r || resolved.startsWith(r + path.sep));
}

// True only when `rawPath` is safe to hand to shell.openPath / showItemInFolder.
function _isOpenablePath(db, rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return false;
  if (/^[\\/]{2}/.test(rawPath)) return false;                  // reject UNC (\\host or //host)
  let resolved;
  try { resolved = path.resolve(rawPath); } catch { return false; }
  if (/^[\\/]{2}/.test(resolved)) return false;                 // UNC after resolution too
  if (!ALLOWED_OPEN_EXTS.has(path.extname(resolved).toLowerCase())) return false;
  if (_withinAnyRoot(resolved, _allowedOpenRoots(db))) return true;
  // Otherwise allow only an exact path the app itself recorded for a document
  // (covers an original source file that legitimately lives outside the roots).
  try {
    const base = path.basename(resolved);
    const rows = db.prepare(
      `SELECT working_path, stored_path, folder_path, original_filename FROM documents
        WHERE working_path = ? OR stored_path = ? OR original_filename = ?`
    ).all(resolved, resolved, base);
    for (const row of rows) {
      if (row.working_path && path.resolve(row.working_path) === resolved) return true;
      if (row.stored_path && path.resolve(row.stored_path) === resolved) return true;
      if (row.folder_path && row.original_filename &&
          path.resolve(path.join(row.folder_path, row.original_filename)) === resolved) return true;
    }
  } catch { /* ignore */ }
  return false;
}

// Captured at register() so the module-level _handleFileMessage can spawn standalone helper
// scripts (e.g. pdf_rotate.py) without threading ctx through every caller.
let _pyHelpers = null;

function register(ctx) {
  const { ipcMain, getDb, pythonExe, pythonArgs, tesseractPath,
          backendScript, configPath, notifyMainWindow, notifyDevInspector,
          notifyReview, safeSend, spawn, path, fs, logger } = ctx;
  _pyHelpers = { pythonExe, pythonArgs, backendScript };

  // Startup holding-area reconciliation — GC crash debris (.part / orphaned /
  // already-confirmed inbox copies) so the holding queue agrees with the DB on
  // launch. Deferred so it never blocks module registration; best-effort.
  setImmediate(() => {
    try {
      const db = getDb();
      runHoldingReconcile(db, logger);
      notifyMainWindow?.('stuck-count-changed',
        require('../../../database/modules/documents').getStuckCount(db));
    } catch (e) { logger?.warn(`[reconcile] startup sweep skipped: ${e.message}`); }
  });

  // Additive read-only telemetry mirror: send a progress message to the invoking
  // renderer exactly as before, then ALSO to the hidden dev inspector if it is
  // open (no-op otherwise). Does not change message shape, ordering, or any
  // processing logic — it is a pure tee.
  // `sender` is event.sender (a webContents) captured at invoke time; it can be
  // DESTROYED while the Python child still streams after its window closed, so it
  // MUST go through safeSend (was a raw sender.send → uncaught "Object has been
  // destroyed" crash on closing the window mid-run). notifyDevInspector already
  // routes through safeSend in main.js.
  const mirror = (sender, channel, msg) => {
    safeSend(sender, channel, msg);
    notifyDevInspector?.(channel, msg);
  };

  // Should the Python child emit the dev trace stream this run? True when the
  // hidden inspector window is open, OR diagnostic logging is on (passed in, since
  // it's computed per-handler), OR the in-Review dev console requested it
  // (ctx.reviewTraceActive, set by review-trace-set).
  const traceWanted = (diagOn) => !!(ctx.windows && ctx.windows['dev-inspector'])
    || !!diagOn || !!ctx.reviewTraceActive;

  // Route a trace event to every active sink: the session registry (so the
  // inspector/Review console can PULL it via dev-get-session-doc), the inspector
  // window, the Review window (only when its console is active), and the diag log.
  // Each sink self-gates (notify* are no-ops when their window is absent), so this
  // is safe to call unconditionally on any received trace message.
  const routeTrace = (msg) => {
    _recordDevTrace(msg);
    notifyDevInspector?.('process-trace', msg);
    if (ctx.reviewTraceActive) notifyReview?.('process-trace', msg);
    diaglog.write(msg);
  };

  const { requireRole, getCurrentUser, logAudit } = require('../auth/handler');

  // ── Folder picker ───────────────────────────────────────────────────────────
  const { dialog, shell } = require('electron');

  // Dev-inspector read-only session getters (no mutation; in-memory only).
  ipcMain.handle('dev-get-session-docs', () => _devSession.docs.slice().reverse());
  ipcMain.handle('dev-get-session-doc',  (_e, key) => _devSession.traceByDoc.get(key) || []);

  // Source folder for "Process Documents" — part of the daily Admin/Edit workflow.
  ipcMain.handle('pick-folder', async (e) => {
    requireRole('admin', 'edit');
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select folder containing scanned documents',
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // Single-file import for the Teach wizard: pick ONE PDF and stage it in a FRESH temp folder
  // so the existing process-folder path imports just that one file into the review queue
  // (so a doc can be taught even when the queue is empty). Returns {folder, filename} for the
  // renderer to processFolder() then select; null if cancelled, {error} on a copy failure.
  ipcMain.handle('stage-pdf-for-teach', async (e) => {
    requireRole('admin', 'edit');
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'Select a PDF to teach',
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      // Sweep leftover staging folders from previous teaches first (teach-imports are
      // sequential, so any prior sf-teach-* is finished) — bounds the temp clutter to ≤1.
      try {
        const tmpRoot = os.tmpdir();
        for (const name of fs.readdirSync(tmpRoot)) {
          if (name.startsWith('sf-teach-')) {
            try { fs.rmSync(path.join(tmpRoot, name), { recursive: true, force: true }); } catch {}
          }
        }
      } catch {}
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teach-'));
      const base   = path.basename(r.filePaths[0]);
      fs.copyFileSync(r.filePaths[0], path.join(tmpDir, base));
      return { folder: tmpDir, filename: base };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Output folder is an app-wide filing-destination setting — "access all
  // settings" is the Admin-exclusive line drawn for Settings, and this picker
  // only ever appears inside that Admin-gated window.
  ipcMain.handle('pick-output-folder', async (e) => {
    requireRole('admin');
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select output folder for processed documents',
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // Opening a filed document in Explorer/its default app is part of "search/view
  // documents" — available to every signed-in role, including Read Only.
  ipcMain.on('show-in-explorer', (_e, filePath) => {
    if (!getCurrentUser()) return;
    if (!_isOpenablePath(getDb(), filePath)) {
      logger?.warn?.('[security] blocked show-in-explorer for a disallowed path');
      return;
    }
    shell.showItemInFolder(filePath);
  });
  ipcMain.on('open-file', (_e, filePath) => {
    if (!getCurrentUser()) return;
    if (!_isOpenablePath(getDb(), filePath)) {
      logger?.warn?.('[security] blocked open-file for a disallowed path');
      return;
    }
    shell.openPath(filePath);
  });
  // Open a FOLDER (not a file) — the file allowlist requires an extension, so folders
  // need their own check: must be an app-managed root (e.g. the output folder), no UNC.
  ipcMain.on('open-folder', (_e, dir) => {
    if (!getCurrentUser()) return;
    let resolved;
    try { resolved = path.resolve(dir); } catch { return; }
    if (!dir || typeof dir !== 'string' || /^[\\/]{2}/.test(dir) || /^[\\/]{2}/.test(resolved)) return;
    if (!_withinAnyRoot(resolved, _allowedOpenRoots(getDb()))) {
      logger?.warn?.('[security] blocked open-folder for a disallowed path');
      return;
    }
    shell.openPath(resolved);
  });

  // Diagnostic-only: record a ⊕ teach action — the box coordinates STORED for the
  // anchor plus the value the live zone-OCR read at teach time, and the preview
  // image dimensions used. Comparing this "teach-time read at coords X" against
  // the extraction-time read at the same coords pinpoints a review-preview vs
  // extraction-render coordinate-space mismatch. No-op unless diagnostic logging
  // is on. Fire-and-forget from the review renderer.
  ipcMain.on('diag-teach', (_e, data) => {
    try {
      if (!_diagEnabled(getDb())) return;
      diaglog.enable();
      diaglog.write({ ev: 'teach_anchor', ...(data || {}) });
    } catch { /* diagnostics never disrupt */ }
  });

  // ── Stop processing ─────────────────────────────────────────────────────────
  ipcMain.handle('stop-processing', () => {
    requireRole('admin', 'edit');
    // ALWAYS set the cancel flag, even if no child is running this instant — a stop
    // pressed in the gap between two pre-pass detection spawns must still take, or the
    // loop keeps going and "Stopping…" hangs.
    _cancelRequested = true;
    if (_currentBatchProcs.length) {
      // Kill every worker's full process tree: in dev mode `py.exe` (Python
      // Launcher) is spawned and proc.kill() only kills the launcher, leaving
      // python.exe alive and writing to the inherited pipe. taskkill /T kills
      // all descendants so the pipe closes and proc.on('close') fires promptly.
      for (const proc of _currentBatchProcs) {
        try {
          require('child_process').spawnSync(
            'taskkill', ['/F', '/T', '/PID', String(proc.pid)],
            { windowsHide: true, stdio: 'ignore' }
          );
        } catch {}
        try { proc.kill(); } catch {}
      }
      _currentBatchProcs = [];
    }
    return true;
  });

  // ── Batch document SEPARATION (Stage 1) ───────────────────────────────────────
  // Split a multi-DOCUMENT PDF (e.g. ten one-page alerts generated into one file) into
  // separate documents BEFORE the worker pool runs, so each is OCR'd/extracted/filed on
  // its own instead of as a single document. Conservative + fail-safe: the detector
  // (segment_docs.py → ocr/segmentation.py) only proposes a split for a confident multi-
  // first-page batch; a normal multi-page invoice (or any error/timeout) yields ONE
  // segment and nothing changes. Splits in place (reusing pdf_splitter.py) and moves the
  // original into a recoverable subfolder the NON-recursive folder scan ignores.
  const SEPARATED_DIR = '.sf_separated_originals';
  const runPyJson = (script, args, env) => new Promise((resolve) => {
    let out = '';
    let proc;
    try { proc = spawn(pythonExe(), pythonArgs(script, ...args), { windowsHide: true, env: env || process.env }); }
    catch { return resolve(null); }
    // Track the pre-pass child in the shared batch list so Stop kills it IMMEDIATELY
    // (otherwise stop only takes effect after the current detection finishes).
    _currentBatchProcs.push(proc);
    const done = (val) => { _currentBatchProcs = _currentBatchProcs.filter(p => p !== proc); resolve(val); };
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => { try { done(JSON.parse(out.trim())); } catch { done(null); } });
    proc.on('error', () => done(null));
  });

  async function _separateBatchDocuments(folderPath, templatesFile, log, onPhase, parallelism) {
    let pdfs = [];
    try {
      pdfs = fs.readdirSync(folderPath, { withFileTypes: true })
        .filter(e => e.isFile() && path.extname(e.name).toLowerCase() === '.pdf')
        .map(e => e.name);
    } catch { return 0; }
    if (!pdfs.length) return 0;

    const segScript   = path.join(path.dirname(backendScript()), 'segment_docs.py');
    const splitScript = path.join(path.dirname(backendScript()), 'pdf_splitter.py');
    let separated = 0, done = 0, next = 0;

    // Bounded parallelism for the detection pre-pass. Each detection spawns Tesseract
    // (itself multithreaded), so cap each worker's OpenMP threads to cores/P to keep
    // total threads ≈ cores rather than P×cores of thrash. Each PDF is independent
    // (detection reads its own file; split writes its own basenames + moves its own
    // original), so this is safe to run concurrently.
    const P = Math.max(1, parallelism || 1);
    const cores = os.cpus().length || 1;
    const threadCap = Math.max(1, Math.floor(cores / P));
    const env = P > 1 ? { ...process.env, OMP_THREAD_LIMIT: String(threadCap) } : process.env;

    onPhase?.(`Preparing — scanning ${pdfs.length} document(s) for multi-page splits…`);

    async function worker() {
      while (!_cancelRequested) {
        const i = next++;
        if (i >= pdfs.length) return;
        const name = pdfs[i];
        const filePath = path.join(folderPath, name);
        const det = await runPyJson(segScript,
          ['--file', filePath, '--templates-file', templatesFile, '--tesseract', tesseractPath()], env);
        done += 1;
        onPhase?.(`Preparing ${done}/${pdfs.length}…`);
        if (_cancelRequested) return;
        const segments = det && det.success && Array.isArray(det.segments) ? det.segments : null;
        if (!segments || segments.length < 2) continue;   // one document → leave it untouched

        // 0-based inclusive [start,end] → pdf_splitter's 1-based "a-b,c,…".
        const ranges = segments.map(([s, e]) => (s === e ? `${s + 1}` : `${s + 1}-${e + 1}`)).join(',');
        const split  = await runPyJson(splitScript,
          ['--file', filePath, '--ranges', ranges, '--outdir', folderPath], env);
        const made   = (split && split.success && Array.isArray(split.files))
          ? split.files.filter(f => fs.existsSync(f)) : [];
        if (made.length < 2) continue;   // splitter failed → leave the original as one doc

        // Move the original OUT of the (non-recursive) scan so it isn't ALSO processed,
        // while keeping it recoverable.
        try {
          const keepDir = path.join(folderPath, SEPARATED_DIR);
          fs.mkdirSync(keepDir, { recursive: true });
          fs.renameSync(filePath, path.join(keepDir, name));
        } catch (e) {
          // Original not movable → delete the new segments so we never process BOTH the
          // original and its parts (duplicates). Leave it as a single document.
          for (const f of made) { try { fs.unlinkSync(f); } catch {} }
          log?.(`Could not separate ${name} (original locked) — left as one document`, 'warn');
          continue;
        }
        separated += 1;
        log?.(`Detected ${made.length} documents in ${name} — separated`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(P, pdfs.length) }, worker));
    return separated;
  }

  // ── Process folder ──────────────────────────────────────────────────────────
  ipcMain.handle('process-folder', async (event, folderPath, opts) => {
    requireRole('admin', 'edit');
    // The Teach wizard imports a single PDF with {autoFile:false} so a 100%-confidence doc is
    // NOT auto-filed out of the review queue before the teach picker can select it.
    const autoFileRun = !opts || opts.autoFile !== false;
    const db = getDb();
    // Multi-point licensing enforcement (F-01): bulk import is the highest-value
    // extraction write path. Network-free cached-license re-check before any work.
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { success: false, error: 'A valid license is required to process documents. Please re-activate ScanFinder.', ...licenseDenial };
    logAudit(db, { action: 'import_run', action_category: 'processing', target_type: 'folder',
      outcome: 'success', metadata: { folder: folderPath } });
    const diagOn = _diagEnabled(db);
    if (diagOn) { diaglog.enable(); diaglog.write({ ev: 'batch_start', folder: folderPath }); }
    let trainingArgs, tempFiles, ocrEngine;
    try {
      ({ args: trainingArgs, tempFiles, ocrEngine } = buildTrainingArgs(db, configPath, logger));
    } catch (e) {
      console.error('[process-folder] buildTrainingArgs failed:', e);
      mirror(event.sender, 'process-progress', {
        type: 'log', text: `Setup error: ${e.message}`, level: 'err'
      });
      return { success: false, error: e.message };
    }

    const learning  = require('../../../database/modules/learning');
    const procMode  = _validMode(learning.getSetting(db, 'processing_mode', 'smart'));

    // Bounded cross-document parallelism. Each worker is a separate Python
    // process handling a disjoint slice of the folder; ALL DB writes still flow
    // through _handleFileMessage on the single-threaded JS event loop (better-
    // sqlite3 is synchronous), so concurrency only parallelizes the CPU-bound
    // OCR/extraction, never DB/learning state. Default 1 = unchanged sequential.
    let concurrency = parseInt(learning.getSetting(db, 'processing_concurrency', '1'), 10);
    if (!Number.isFinite(concurrency)) concurrency = 1;
    // Cap at 5: cross-document parallelism only helps up to ~the CPU core count;
    // above that the per-proc Tesseract/threadCap split starves and the batch thrashes
    // rather than speeds up. Default is 1.
    concurrency = Math.max(1, Math.min(5, concurrency));

    _cancelRequested   = false;
    _currentBatchProcs = [];
    let fileCount   = 0;
    const shardFiles = [];   // per-worker --files-file temp paths to clean up

    // Spawn one Python worker. filesFile=null → it scans the whole folder (the
    // original single-process behaviour). suppressStart hides the worker's own
    // {type:'start'} so a pool can emit ONE aggregate total to the renderer
    // instead of N competing ones (the renderer keys its progress bar off it).
    const runWorker = (filesFile, suppressStart, threadCap = 0) => new Promise((resolve) => {
      const py = pythonExe();
      const scriptArgs = [
        '--folder',    folderPath,
        '--tesseract', tesseractPath(),
        '--mode',      procMode,
        ...trainingArgs,
      ];
      // RapidOCR-only speed flags (default Tesseract command line stays unchanged):
      // Fast mode skips the angle classifier; parallel workers cap onnxruntime
      // threads to cores/workers so they don't oversubscribe the CPU.
      if (ocrEngine === 'rapidocr') {
        if (procMode === 'fast') scriptArgs.push('--ocr-fast');
        if (threadCap > 0) scriptArgs.push('--ocr-threads', String(threadCap));
      }
      if (filesFile) scriptArgs.push('--files-file', filesFile);
      // Emit the dev trace stream + capture OCR slices while the hidden inspector
      // is open OR diagnostic logging is on (so the diagnostic file gets the full
      // per-stage trace + crop bboxes even with no window). Slice dir is created
      // on demand and cleaned by main.
      if (traceWanted(diagOn)) {
        scriptArgs.push('--trace');
        try { fs.mkdirSync(ctx.devSliceDir, { recursive: true }); scriptArgs.push('--slice-dir', ctx.devSliceDir); } catch {}
      }

      // Cap Tesseract's OpenMP threads per worker. Tesseract IS internally
      // multithreaded (OpenMP) and by default grabs ~all cores PER PROCESS — so N
      // parallel workers each spawn ~cores threads (≈ N×cores) and thrash an
      // oversubscribed CPU (the real reason a 10-worker Reprocess All crawled). The
      // worker POOL is the parallelism; per-process OMP threading fights it. Capping
      // to cores/workers (threadCap) keeps total threads ≈ cores. threadCap=0 (the
      // single-worker path) leaves Tesseract free to use every core for the one proc.
      const env = threadCap > 0
        ? { ...process.env, OMP_THREAD_LIMIT: String(threadCap) }
        : process.env;
      const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
        { windowsHide: true, env });
      _currentBatchProcs.push(proc);
      let buf = '';

      proc.stdout.on('data', (data) => {
        if (_cancelRequested) return;
        buf += data.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            // Dev-only trace stream: retain for the session registry, route to the
            // inspector and (when its console is active) the Review window — never
            // to user-facing progress or the DB handler.
            if (msg.type === 'trace') { routeTrace(msg); continue; }
            if (suppressStart && msg.type === 'start') continue;
            if (msg.type === 'file_done') {
              // Persist SYNCHRONOUSLY (better-sqlite3 is sync anyway) so msg.db_id is set
              // BEFORE we mirror — the renderer's results table needs the doc id to open
              // THAT document in Review (not the first in the queue). Guard the call so a
              // per-doc DB error can't skip the progress mirror + count below (which would
              // stall the bar and drop the doc from the results table); db_id just stays
              // unset → the row link falls back to opening Review at the first doc.
              _recordDevDoc(msg);
              try { _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger, autoFileRun); }
              catch (e) { logger?.err?.(`_handleFileMessage failed: ${msg.original_filename || '?'} — ${e && e.message}`); }
              fileCount++;
            } else {
              setImmediate(() => _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger));
            }
            if (msg.type === 'log') {
              if      (msg.level === 'err')  logger?.err(`Python: ${msg.text}`);
              else if (msg.level === 'warn') logger?.warn(`Python: ${msg.text}`);
              else                           logger?.log(`Python: ${msg.text}`);
            }
            mirror(event.sender, 'process-progress', msg);
          } catch {
            mirror(event.sender, 'process-progress', { type: 'log', text: trimmed });
          }
        }
      });

      proc.stderr.on('data', d => {
        if (_cancelRequested) return;
        const text = d.toString().trim();
        if (text) logger?.warn(`Python stderr: ${text}`);
        mirror(event.sender, 'process-progress', { type: 'log', text });
      });

      proc.on('close', (code) => {
        _currentBatchProcs = _currentBatchProcs.filter(p => p !== proc);
        resolve(code);
      });
    });

    // ── Auto document separation (Stage 1) ── runs BEFORE the worker set is built, so
    // both the single-worker (scans the folder) and multi-worker (enumerates it) paths
    // pick up the per-document segments. Gated by a setting (default on); fail-safe, so a
    // detector/splitter failure just leaves the folder unchanged. See _separateBatchDocuments.
    if (learning.getSetting(db, 'auto_separate_enabled', 'true') === 'true') {
      const tIdx = trainingArgs.indexOf('--templates-file');
      const templatesFile = tIdx >= 0 ? trainingArgs[tIdx + 1] : null;
      if (templatesFile) {
        // Run detection concurrently (each PDF is independent) so the pre-pass doesn't
        // serialise a Python cold-start per document. Cap at the CPU core count (≤6).
        const sepP = Math.max(1, Math.min(os.cpus().length || 1, 6));
        try {
          const n = await _separateBatchDocuments(folderPath, templatesFile,
            (text, level) => mirror(event.sender, 'process-progress', { type: 'log', text, level: level || '' }),
            (text) => mirror(event.sender, 'process-progress', { type: 'log', text, phase: true }),
            sepP);
          if (n) logger?.log(`[separation] separated ${n} multi-document PDF(s) before processing`);
        } catch (e) {
          logger?.warn(`[separation] pre-pass failed (continuing without split): ${e.message}`);
        }
      }
    }

    // Stop pressed DURING the pre-pass → bail before spawning processing workers,
    // otherwise the worker would launch and "Stopping…" would hang until it finished.
    if (_cancelRequested) {
      _cancelRequested = false;
      _currentBatchProcs = [];
      cleanupFiles(tempFiles);
      cleanupFiles(shardFiles);
      mirror(event.sender, 'process-progress', { type: 'log', text: 'Stopped before processing.', level: 'warn' });
      return { success: true, stopped: true };
    }

    // Build the worker set. concurrency<=1 keeps the EXACT original path (one
    // worker scans the folder; its own start/total flows straight through).
    let workerPromises;
    if (concurrency <= 1) {
      logger?.log(`Batch start: folder="${folderPath}" mode=${procMode} concurrency=1`);
      workerPromises = [runWorker(null, false)];
    } else {
      let allFiles = [];
      try {
        allFiles = fs.readdirSync(folderPath, { withFileTypes: true })
          .filter(e => e.isFile() && BATCH_SUPPORTED_EXTS.has(path.extname(e.name).toLowerCase()))
          .map(e => e.name)
          .sort();
      } catch (e) {
        logger?.warn(`Could not enumerate folder for parallel split: ${e.message}`);
      }
      if (allFiles.length <= 1) {
        // Nothing to parallelize — fall back to the single-worker path.
        logger?.log(`Batch start: folder="${folderPath}" mode=${procMode} concurrency=1 (only ${allFiles.length} file)`);
        workerPromises = [runWorker(null, false)];
      } else {
        const shards = partitionRoundRobin(allFiles, Math.min(concurrency, allFiles.length));
        logger?.log(`Batch start: folder="${folderPath}" mode=${procMode} concurrency=${concurrency} → ${shards.length} workers, ${allFiles.length} files`);
        // Per-worker thread cap = cores / workers, so the pool never oversubscribes
        // the CPU. Applies to BOTH engines: it caps Tesseract's OpenMP threads (via
        // OMP_THREAD_LIMIT in runWorker — the default engine, previously UNCAPPED and
        // the cause of N×cores thread thrash) AND RapidOCR's onnxruntime threads (via
        // --ocr-threads). Single-worker path passes 0 (no cap → use all cores).
        const threadCap = Math.max(1, Math.floor((os.cpus().length || 1) / shards.length));
        // One aggregate start for the whole batch; per-worker starts suppressed.
        mirror(event.sender, 'process-progress', { type: 'start', total: allFiles.length });
        workerPromises = shards.map(shard => {
          const f = writeTempJson('files', shard);
          shardFiles.push(f);
          return runWorker(f, true, threadCap);
        });
      }
    }

    const codes   = await Promise.all(workerPromises);
    const stopped = _cancelRequested;
    _cancelRequested   = false;
    _currentBatchProcs = [];
    // Let any still-pending per-file setImmediate(_handleFileMessage) callbacks run so
    // their drains are queued, THEN flush — the workers have exited, so the source PDFs
    // are unlocked and the moves into Processed/ now succeed.
    await new Promise((resolve) => setImmediate(resolve));
    _flushPendingDrains(db, logger);
    cleanupFiles(tempFiles);
    cleanupFiles(shardFiles);
    // Remove any *_ocr.txt plaintext artifacts left by earlier versions of the
    // pipeline that wrote raw OCR text to the source folder as an audit file.
    // The current pipeline no longer creates these; this sweep cleans up
    // residual files from prior runs so none linger in user-visible paths.
    try {
      for (const entry of fs.readdirSync(folderPath)) {
        if (entry.endsWith('_ocr.txt')) {
          try { fs.unlinkSync(path.join(folderPath, entry)); } catch {}
        }
      }
    } catch {}
    // Tidy the holding area after each batch (dead/confirmed copies + .part debris)
    // and refresh the stuck-doc count for the launchpad surface.
    runHoldingReconcile(db, logger);
    try {
      notifyMainWindow?.('stuck-count-changed',
        require('../../../database/modules/documents').getStuckCount(db));
    } catch {}
    const success = !stopped && codes.every(c => c === 0);
    logger?.log(`Batch ${stopped ? 'stopped' : 'complete'}: ${fileCount} files, exit=${codes.join(',')}`);
    return { success, stopped };
  });

  // ── Stuck (failed) documents — the launchpad "couldn't be read" surface ──────
  // Ungated reads (a count/list is not sensitive); the "Try again" action reuses
  // the role-gated reprocess-document IPC below.
  ipcMain.handle('get-stuck-count', () =>
    require('../../../database/modules/documents').getStuckCount(getDb()));
  ipcMain.handle('get-stuck-docs', () =>
    require('../../../database/modules/documents').getStuckQueue(getDb()));

  // ── Reprocess single document ───────────────────────────────────────────────
  // Merge a fresh reprocess result into a document's stored extractions + identity,
  // then persist. Shared by single-doc reprocess AND batched Reprocess All (one
  // process_docs spawn → many file_done events, each applied here by docId). The
  // freshly-recomputed value WINS whenever present; a prior value is preserved only
  // when the new run found nothing for that field, and a field the new run didn't
  // return at all is kept (so reprocess never silently drops a good first-pass read).
  function applyReprocessResult(db, docId, existing, result, filename, diagOn) {
    const existingMap = {};
    for (const e of existing) existingMap[e.field_key] = e;

    const newRows = Object.entries(result.extractions).map(([key, data]) => ({
      field_key:         key,
      raw_value:         data.value != null ? String(data.value) : null,
      display_value:     data.value != null ? String(data.value) : null,
      confidence:        data.confidence ?? null,
      extraction_method: data.method || null,
      validation_note:   data.validation_note || null,
      corrected_to:      data.corrected_to || null,
      anchor_label:      data.anchor || null,
    }));

    const _emitMerge = (field, decision, oldV, newV) => {
      if (!traceWanted(diagOn)) return;
      routeTrace({ type: 'trace', doc: filename, event: 'reprocess_merge',
                   field, decision, old: oldV ?? null, new: newV ?? null });
    };

    const mergedRows = newRows.map(row => {
      const ex = existingMap[row.field_key];
      if (!ex) return row;
      if (ex.display_value && !row.display_value) {
        _emitMerge(row.field_key, 'kept_existing', ex.display_value, row.display_value);
        return {
          ...row, raw_value: ex.raw_value,
          display_value: ex.display_value, confidence: ex.confidence,
          validation_note: ex.validation_note || null,
          corrected_to: ex.corrected_to || null,
        };
      }
      if (ex.display_value) _emitMerge(row.field_key, 'used_new', ex.display_value, row.display_value);
      return row;
    });

    const newFieldKeys = new Set(newRows.map(r => r.field_key));
    for (const ex of existing) {
      if (!newFieldKeys.has(ex.field_key) && ex.display_value) {
        mergedRows.push({
          field_key:         ex.field_key,
          raw_value:         ex.raw_value,
          display_value:     ex.display_value,
          confidence:        ex.confidence,
          extraction_method: ex.extraction_method,
          validation_note:   ex.validation_note || null,
          corrected_to:      ex.corrected_to || null,
        });
      }
    }

    const learning = require('../../../database/modules/learning');
    learning.deleteExtractions(db, docId);
    learning.insertExtractions(db, docId, mergedRows);

    let reprocDocTypeId = null;
    if (result.document_type) {
      const docTypesMod = require('../../../database/modules/document_types');
      const reMatch = docTypesMod.getAllWithFields(db).find(
        dt => dt.name.toLowerCase() === result.document_type.toLowerCase()
      );
      if (reMatch) reprocDocTypeId = reMatch.id;
    }

    db.prepare(
      `UPDATE documents SET
         overall_confidence  = ?,
         status              = 'needs_review',
         document_type_id    = COALESCE(?, document_type_id),
         template_id         = ?,
         logo_phash          = ?,
         keyword_fingerprint = ?,
         supplier_name       = COALESCE(?, supplier_name),
         ocr_text            = COALESCE(?, ocr_text),
         review_acknowledged_at = NULL
       WHERE id = ?`
    ).run(
      result.overall_confidence || null,
      reprocDocTypeId,
      result.template_id        || null,
      result.logo_phash         || null,
      result.keyword_fingerprint ? JSON.stringify(result.keyword_fingerprint) : null,
      result.supplier_name      || null,
      result.ocr_text           || null,
      docId
    );

    const mergedMap = {};
    for (const r of mergedRows) mergedMap[r.field_key] = { value: r.display_value, confidence: r.confidence };

    if (logger) {
      logger.log(`Reprocess done: ${filename}`);
      for (const r of mergedRows) {
        if (r.display_value) logger.log(`  FOUND   ${r.field_key}: ${JSON.stringify(r.display_value)} (${r.confidence}% via ${r.extraction_method || '?'})`);
        else                 logger.log(`  MISSED  ${r.field_key}`);
      }
    }

    return { extractions: mergedMap, overall_confidence: result.overall_confidence };
  }

  ipcMain.handle('reprocess-document', async (event, { docId, folderPath, filename, enhanceParams }) => {
    requireRole('admin', 'edit');
    const db      = getDb();
    // Multi-point licensing enforcement (F-01): reprocess re-runs the extraction
    // pipeline — same network-free cached-license re-check as bulk import.
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { success: false, error: 'A valid license is required to reprocess documents. Please re-activate ScanFinder.', ...licenseDenial };
    // Serialise heavy work: refuse if a batch (import / reprocess-all) OR another single reprocess
    // is already running — running both at once oversubscribes the CPU and can race two merges into
    // the same document, which presents as the app freezing.
    if (_anyProcessingBusy()) {
      return { success: false, busy: true, error: 'A reprocess is already running — please wait for it to finish.' };
    }
    logAudit(db, { action: 'reprocess', target_type: 'document', target_id: docId, document_id: docId,
      outcome: 'success', metadata: { enhanced: !!enhanceParams } });
    // Prefer the app-managed working copy so reprocess doesn't depend on the
    // user's source folder still holding the file; fall back to the source path.
    // Prefer the working copy; then — for an already-FILED (confirmed) doc, e.g. one the
    // backend auto-filed and the operator re-surfaced — the FILED copy (stored_path), which
    // always exists (mirrors documents.resolveFilePath); finally the caller's source path.
    const wpRow   = db.prepare('SELECT working_path, stored_path, status FROM documents WHERE id = ?').get(docId);
    const srcFile = (wpRow && wpRow.working_path && fs.existsSync(wpRow.working_path))
                  ? wpRow.working_path
                  : (wpRow && wpRow.status === 'confirmed' && wpRow.stored_path && fs.existsSync(wpRow.stored_path))
                    ? wpRow.stored_path
                    : path.join(folderPath, filename);
    if (!fs.existsSync(srcFile)) {
      return { success: false, error: 'File not found: ' + srcFile };
    }

    // Snapshot existing extractions
    const existing = db.prepare(
      'SELECT * FROM extractions WHERE document_id = ?'
    ).all(docId);

    // Copy to temp dir with unique name
    const tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-'));
    const ext         = path.extname(filename);
    const tmpFilename = `reprocess_${Date.now()}${ext}`;
    fs.copyFileSync(srcFile, path.join(tmpDir, tmpFilename));

    const diagOn = _diagEnabled(db);
    if (diagOn) { diaglog.enable(); diaglog.write({ ev: 'reprocess_start', filename, doc_id: docId }); }
    const { args: trainingArgs, tempFiles, ocrEngine } = buildTrainingArgs(db, configPath, logger);
    const learning2  = require('../../../database/modules/learning');
    const templates2 = require('../../../database/modules/templates');
    const reprMode   = _validMode(learning2.getSetting(db, 'processing_mode', 'smart'));

    // Resolve the OCR preprocessing params to actually use:
    //  - manual params (sent only while OCR Preview is active for this
    //    document, see review/renderer.js) are a one-shot override for THIS
    //    reprocess and — if the document has a known template — become that
    //    template's learned auto-processing baseline going forward;
    //  - otherwise, fall back to the matched template's own learned baseline
    //    (if any and enabled), so recurring templates benefit automatically
    //    even when preview is off.
    const docRow     = db.prepare('SELECT template_id FROM documents WHERE id = ?').get(docId);
    const templateId = docRow ? docRow.template_id : null;
    let effectiveEnhanceParams = null;
    let ruleCreatedFor          = null;
    if (enhanceParams && typeof enhanceParams === 'object') {
      effectiveEnhanceParams = enhanceParams;
      if (templateId) {
        const updated = templates2.setOcrAutoParams(db, templateId, enhanceParams);
        ruleCreatedFor = updated ? updated.name : null;
      }
    } else if (templateId) {
      const tmpl = templates2.getById(db, templateId);
      if (tmpl && tmpl.ocr_auto_enabled && tmpl.ocr_auto_params) {
        effectiveEnhanceParams = tmpl.ocr_auto_params;
      }
    }

    const scriptArgs    = [
      '--folder',     tmpDir,
      '--tesseract',  tesseractPath(),
      '--mode',       reprMode,
      ...trainingArgs,
    ];
    // RapidOCR Fast-mode speed flag (single doc -> no thread cap). Tesseract default unchanged.
    if (ocrEngine === 'rapidocr' && reprMode === 'fast') scriptArgs.push('--ocr-fast');
    // Honour the template this doc is already linked to as a Stage 0 fallback,
    // so its admin-drawn field mappings still apply on reprocess even when live
    // re-identification is borderline (see engine.extract known_template_id).
    if (templateId) {
      scriptArgs.push('--known-template-id', String(templateId));
    }
    // Honour the document's ALREADY-ASSIGNED doc type on reprocess instead of
    // re-detecting it from the (possibly clipped/degraded) OCR text. Re-detection
    // fails when a scan's identifying band is cut off → null document_slug →
    // the learned-format / qualification gates silently disable → wrong-row crops
    // commit and drift relocation never fires. A reprocessed doc already knows
    // its type; pass that slug as the authoritative document_slug.
    try {
      const dtRow = db.prepare(
        `SELECT dt.slug AS slug FROM documents d
         LEFT JOIN document_types dt ON dt.id = d.document_type_id
         WHERE d.id = ?`).get(docId);
      if (dtRow && dtRow.slug) scriptArgs.push('--known-doc-slug', String(dtRow.slug));
    } catch {}
    // Dev trace stream + OCR slice capture while the inspector is open OR
    // diagnostic logging is on (so the diagnostic file captures reprocess too).
    if (traceWanted(diagOn)) {
      scriptArgs.push('--trace');
      try { fs.mkdirSync(ctx.devSliceDir, { recursive: true }); scriptArgs.push('--slice-dir', ctx.devSliceDir); } catch {}
    }
    const allTempFiles = [...tempFiles];
    if (effectiveEnhanceParams) {
      const enhanceFile = writeTempJson('enhance', effectiveEnhanceParams);
      allTempFiles.push(enhanceFile);
      scriptArgs.push('--enhance-file', enhanceFile);
    } else {
      // Reprocess optimisation: reuse this doc's already-stored full-page OCR text so
      // the ~1.9s/page full-page OCR is skipped (the pixels don't change on reprocess —
      // only the learned data — and per-field crop reads still re-run, so accuracy is
      // unchanged). ONLY when no manual/template ENHANCE is active (that would change
      // the read) and the stored text is non-empty. Written into tmpDir (cleaned with it).
      try {
        const otRow = db.prepare('SELECT ocr_text FROM documents WHERE id = ?').get(docId);
        if (otRow && otRow.ocr_text && otRow.ocr_text.trim()) {
          const cachedFile = path.join(tmpDir, 'cached_ocr.txt');
          fs.writeFileSync(cachedFile, otRow.ocr_text, 'utf8');
          scriptArgs.push('--cached-ocr-file', cachedFile);
        }
      } catch { /* fall back to full OCR */ }
    }

    _singleReprocessActive = true;   // mark busy now we're committed to spawning (cleared in finish())
    return new Promise((resolve) => {
      const py   = pythonExe();
      const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
        { windowsHide: true });
      let buf = '', result = null;
      let settled  = false;
      let watchdog = null;

      // Settle exactly once and clean temp artefacts no matter which event
      // fires (close / spawn error / watchdog). Without this a spawn failure or
      // a stalled Python worker would never resolve, deadlocking Reprocess and
      // Reprocess All until the app is restarted.
      const finish = (value) => {
        if (settled) return;
        settled = true;
        _singleReprocessActive = false;   // release the serialise lock
        if (watchdog) clearTimeout(watchdog);
        try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
        cleanupFiles(allTempFiles);
        resolve(value);
      };

      // A single document should never take this long; if it does the worker
      // has hung. Kill its whole process tree (in dev py.exe launches a child
      // python.exe — proc.kill() alone leaves it alive) and fail this doc so the
      // caller's batch can continue rather than deadlocking on Promise.all.
      const REPROCESS_TIMEOUT_MS = 5 * 60 * 1000;
      watchdog = setTimeout(() => {
        logger?.err(`Reprocess timed out: ${filename}`);
        try {
          require('child_process').spawnSync(
            'taskkill', ['/F', '/T', '/PID', String(proc.pid)],
            { windowsHide: true, stdio: 'ignore' }
          );
        } catch {}
        try { proc.kill(); } catch {}
        finish({ success: false, error: 'Reprocess timed out' });
      }, REPROCESS_TIMEOUT_MS);

      proc.stdout.on('data', (data) => {
        buf += data.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'trace') { routeTrace(msg); continue; }
            if (msg.type === 'file_done') _recordDevDoc(msg);
            mirror(event.sender, 'reprocess-progress', msg);
            if (msg.type === 'file_done') result = msg;
          } catch {
            mirror(event.sender, 'reprocess-progress', { type: 'log', text: trimmed });
          }
        }
      });

      proc.stderr.on('data', d => {
        const text = d.toString().trim();
        if (text) logger?.warn(`Reprocess stderr: ${text}`);
        mirror(event.sender, 'reprocess-progress', { type: 'log', text });
      });

      proc.on('error', (err) => {
        logger?.err(`Reprocess spawn error: ${filename} — ${err.message}`);
        finish({ success: false, error: err.message });
      });

      proc.on('close', () => {
        if (settled) return;          // error/timeout already settled it
        if (!result?.success || !result?.extractions) {
          logger?.err(`Reprocess failed: ${filename} — no data returned`);
          return finish({ success: false, error: 'No data returned' });
        }

        const applied = applyReprocessResult(db, docId, existing, result, filename, diagOn);
        finish({ success: true, ...applied, ruleCreated: ruleCreatedFor });
      });
    });
  });

  // ── Reprocess All (batched) ───────────────────────────────────────────────
  // Reprocess many queued documents through a BOUNDED POOL of Python workers, each
  // handling a SHARD of docs in ONE process — so the Python/Tesseract startup cost is
  // paid once per worker, not once per document (the per-doc reprocess-document spawn
  // is what made a large Reprocess All "slow to start"). Accuracy is preserved: each
  // doc carries its OWN overrides (template / doc-slug / enhance) via the
  // --reprocess-manifest, exactly as single-doc reprocess passes them. All DB writes
  // stay on the single-threaded JS event loop (applyReprocessResult), so there is no
  // SQLite contention. Stop kills every worker tree (shared _currentBatchProcs).
  ipcMain.handle('reprocess-batch', async (event, docs) => {
    requireRole('admin', 'edit');
    const db = getDb();
    const licenseDenial = require('../licensing/handler').licenseDenied(db);
    if (licenseDenial) return { success: false, error: 'A valid license is required to reprocess documents. Please re-activate ScanFinder.', ...licenseDenial };
    // Serialise: refuse Reprocess All while a single reprocess (or another batch/import) is running —
    // running both at once oversubscribes the CPU and races merges, which presents as a freeze.
    if (_anyProcessingBusy()) {
      return { success: false, busy: true, error: 'A reprocess is already running — please wait for it to finish.' };
    }
    if (!Array.isArray(docs) || !docs.length) return { success: true, done: 0, failed: 0 };

    const learning2  = require('../../../database/modules/learning');
    const templates2 = require('../../../database/modules/templates');
    const reprMode   = _validMode(learning2.getSetting(db, 'processing_mode', 'smart'));
    const diagOn     = _diagEnabled(db);
    if (diagOn) diaglog.enable();
    const { args: trainingArgs, tempFiles, ocrEngine } = buildTrainingArgs(db, configPath, logger);

    // Stage every doc into ONE temp folder under a unique name, snapshot its existing
    // extractions, and build its per-doc manifest overrides (mirrors single-doc
    // reprocess: template baseline enhance + known template-id + known doc-slug).
    const tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-rb-'));
    const manifest  = {};   // tmpName -> { known_template_id, known_doc_slug, enhance_params }
    const nameToDoc = {};   // tmpName -> { docId, filename, existing }
    const tmpNames  = [];
    for (const d of docs) {
      try {
        const row = db.prepare('SELECT working_path, template_id, ocr_text FROM documents WHERE id = ?').get(d.docId);
        const srcFile = (row && row.working_path && fs.existsSync(row.working_path))
          ? row.working_path
          : path.join(d.folderPath || '', d.filename || '');
        if (!srcFile || !fs.existsSync(srcFile)) { continue; }
        const ext     = path.extname(d.filename || '') || '.pdf';
        const tmpName = `rb_${d.docId}${ext}`;
        fs.copyFileSync(srcFile, path.join(tmpDir, tmpName));
        const existing = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(d.docId);
        const tmpl = row && row.template_id ? templates2.getById(db, row.template_id) : null;
        const enh  = (tmpl && tmpl.ocr_auto_enabled && tmpl.ocr_auto_params) ? tmpl.ocr_auto_params : null;
        const dtRow = db.prepare(
          `SELECT dt.slug AS slug FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.id = ?`
        ).get(d.docId);
        manifest[tmpName]  = {
          known_template_id: (row && row.template_id) || null,
          known_doc_slug:    (dtRow && dtRow.slug) || null,
          enhance_params:    enh,
          // Reuse stored full-page OCR text → skip the ~1.9s/page re-OCR (only when no
          // enhance is active and the text is non-empty; crop reads still re-run).
          ...(!enh && row && row.ocr_text && row.ocr_text.trim() ? { ocr_text: row.ocr_text } : {}),
        };
        nameToDoc[tmpName] = { docId: d.docId, filename: d.filename, existing };
        tmpNames.push(tmpName);
        logAudit(db, { action: 'reprocess', target_type: 'document', target_id: d.docId,
          document_id: d.docId, outcome: 'success', metadata: { batch: true } });
      } catch (e) { logger?.warn(`reprocess-batch stage ${d.filename}: ${e.message}`); }
    }
    if (!tmpNames.length) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      cleanupFiles(tempFiles);
      return { success: true, done: 0, failed: 0 };
    }

    const manifestFile = writeTempJson('rbmanifest', manifest);
    let concurrency = parseInt(learning2.getSetting(db, 'processing_concurrency', '1'), 10);
    if (!Number.isFinite(concurrency)) concurrency = 1;
    // Match the import cap (5): Reprocess All is pure cross-document parallelism (each
    // doc's pipeline is unchanged); threadCap below keeps total OMP/onnx threads ≈ cores,
    // and capping concurrency at 5 avoids oversubscribing the CPU on typical machines.
    concurrency = Math.max(1, Math.min(5, concurrency));
    const shards  = partitionRoundRobin(tmpNames, Math.min(concurrency, tmpNames.length));
    // Per-worker thread cap = cores / workers, so the pool doesn't oversubscribe the
    // CPU. Caps Tesseract's OpenMP threads (OMP_THREAD_LIMIT in the spawn env — the
    // default engine; without it N workers each grab ~all cores ≈ N×cores threads and
    // thrash, making a parallel run crawl as if it were serial) AND RapidOCR's onnx
    // threads (--ocr-threads). >1 shard only.
    const threadCap = shards.length > 1
      ? Math.max(1, Math.floor((os.cpus().length || 1) / shards.length)) : 0;

    mirror(event.sender, 'reprocess-progress', { type: 'start', total: tmpNames.length });
    let done = 0, failed = 0;
    const shardFiles = [];
    _currentBatchProcs = [];

    const runShard = (shard) => new Promise((resolve) => {
      const filesFile = writeTempJson('rbfiles', shard);
      shardFiles.push(filesFile);
      const scriptArgs = ['--folder', tmpDir, '--tesseract', tesseractPath(), '--mode', reprMode,
        '--files-file', filesFile, '--reprocess-manifest', manifestFile, ...trainingArgs];
      if (ocrEngine === 'rapidocr' && reprMode === 'fast') scriptArgs.push('--ocr-fast');
      if (ocrEngine === 'rapidocr' && threadCap > 0) scriptArgs.push('--ocr-threads', String(threadCap));
      if (traceWanted(diagOn)) {
        scriptArgs.push('--trace');
        try { fs.mkdirSync(ctx.devSliceDir, { recursive: true }); scriptArgs.push('--slice-dir', ctx.devSliceDir); } catch {}
      }
      const env = threadCap > 0
        ? { ...process.env, OMP_THREAD_LIMIT: String(threadCap) }
        : process.env;
      const proc = spawn(pythonExe(), pythonArgs(backendScript(), ...scriptArgs), { windowsHide: true, env });
      _currentBatchProcs.push(proc);
      let buf = '', settled = false, watchdog = null;
      const fin = () => { if (settled) return; settled = true; if (watchdog) clearTimeout(watchdog); resolve(); };
      watchdog = setTimeout(() => {
        logger?.err('reprocess-batch shard timed out');
        try { require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true, stdio: 'ignore' }); } catch {}
        try { proc.kill(); } catch {}
        fin();   // settle directly — a kill that fails to fire proc.on('close') must not hang Promise.all
      }, 30 * 60 * 1000);
      proc.stdout.on('data', (data) => {
        buf += data.toString();
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          const t = line.trim(); if (!t) continue;
          let msg = null; try { msg = JSON.parse(t); } catch { continue; }
          if (msg.type === 'trace') { routeTrace(msg); continue; }
          if (msg.type === 'file_done') {
            _recordDevDoc(msg);
            const nd = nameToDoc[msg.original_filename] || nameToDoc[msg.filename];
            if (nd && msg.success && msg.extractions) {
              try { applyReprocessResult(db, nd.docId, nd.existing, msg, nd.filename, diagOn); done++; }
              catch (e) { failed++; logger?.err(`reprocess-batch merge ${nd.filename}: ${e.message}`); }
            } else if (nd) { failed++; }
            mirror(event.sender, 'reprocess-progress',
              { type: 'file_done', done, failed, total: tmpNames.length, docId: nd ? nd.docId : null });
          } else if (msg.type !== 'start') {
            mirror(event.sender, 'reprocess-progress', msg);   // file_begin / log
          }
        }
      });
      proc.stderr.on('data', d => { const tx = d.toString().trim(); if (tx) logger?.warn(`reprocess-batch stderr: ${tx}`); });
      proc.on('error', (e) => { logger?.err(`reprocess-batch spawn: ${e.message}`); fin(); });
      proc.on('close', fin);
    });

    try {
      await Promise.all(shards.map(runShard));
    } finally {
      _currentBatchProcs = [];
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      cleanupFiles([manifestFile, ...shardFiles, ...tempFiles]);
    }
    return { success: true, done, failed };
  });

  // ── OCR region ──────────────────────────────────────────────────────────────
  // Zone-OCR + anchor/logo teaching tools — all part of the Review window's
  // "teach the system" workflow, so Admin/Edit (the same set that can confirm
  // and correct extractions there).
  ipcMain.handle('ocr-region', async (_e, base64png) => {
    requireRole('admin', 'edit');
    const tmpFile = path.join(os.tmpdir(), `ds_ocr_${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64png, 'base64'));
    const script = ctx.resourcePath('python_backend', 'ocr', 'region.py');
    const py = pythonExe();

    return new Promise((resolve) => {
      const proc = spawn(py, pythonArgs(script,
        '--image-file', tmpFile, '--tesseract', tesseractPath()),
        { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(tmpFile); } catch {}
        if (err) console.error('ocr_region stderr:', err);
        resolve(out.trim());
      });
    });
  });

  // Like ocr-region but returns {text, box:[l,t,w,h]} where box is the union of
  // detected word boxes in the crop's ORIGINAL pixels. The ⊕ tool uses this to
  // capture the taught LABEL's position so a drift-invariant label→value offset
  // can be stored (see review/renderer.js captureAnchorContext, learning.saveAnchor).
  ipcMain.handle('ocr-region-boxes', async (_e, base64png) => {
    requireRole('admin', 'edit');
    const tmpFile = path.join(os.tmpdir(), `ds_ocrb_${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64png, 'base64'));
    const script = ctx.resourcePath('python_backend', 'ocr', 'region.py');
    const py = pythonExe();
    return new Promise((resolve) => {
      const proc = spawn(py, pythonArgs(script,
        '--image-file', tmpFile, '--tesseract', tesseractPath(), '--boxes'),
        { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(tmpFile); } catch {}
        if (err) console.error('ocr_region_boxes stderr:', err);
        try { resolve(JSON.parse(out.trim())); } catch { resolve(null); }
      });
    });
  });

  // ── Template-mapping test (shared path with reprocess) ───────────────────────
  // Runs the SAME Stage 0.5 extraction (template_mapper.extract_with_mappings)
  // the real reprocess uses, against the full sample page, for one draft/saved
  // mapping. The Template Editor calls this instead of cropping the absolute
  // drawn target itself, so the test result matches reprocess exactly (same
  // anchor relocation + offset + crop + normalisation). Mirrors the ocr-region
  // spawn pattern above.
  ipcMain.handle('test-template-mapping', async (_e, pageBase64, mapping, landmarks) => {
    requireRole('admin');
    if (!pageBase64 || !mapping) return {};
    const imgFile = path.join(os.tmpdir(), `ds_tmap_img_${Date.now()}.png`);
    const mapFile = path.join(os.tmpdir(), `ds_tmap_${Date.now()}.json`);
    // Optional template landmarks -> the Python resolver runs the SAME registration
    // transform reprocess uses, so the admin "preview across docs" overlay tracks a
    // shifted page. Absent -> the per-field anchor path (unchanged Test behaviour).
    const lmFile = (Array.isArray(landmarks) && landmarks.length)
      ? path.join(os.tmpdir(), `ds_tmap_lm_${Date.now()}.json`) : null;
    try {
      fs.writeFileSync(imgFile, Buffer.from(pageBase64, 'base64'));
      fs.writeFileSync(mapFile, JSON.stringify(mapping));
      if (lmFile) fs.writeFileSync(lmFile, JSON.stringify(landmarks));
    } catch (e) {
      try { fs.unlinkSync(imgFile); } catch {}
      try { fs.unlinkSync(mapFile); } catch {}
      if (lmFile) { try { fs.unlinkSync(lmFile); } catch {} }
      return { error: e.message };
    }
    const script = ctx.resourcePath('python_backend', 'test_mapping.py');
    return new Promise((resolve) => {
      const targs = ['--image-file', imgFile, '--mapping-file', mapFile, '--tesseract', tesseractPath()];
      if (lmFile) targs.push('--landmarks-file', lmFile);
      const proc = spawn(pythonExe(), pythonArgs(script, ...targs),
        { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(imgFile); } catch {}
        try { fs.unlinkSync(mapFile); } catch {}
        if (lmFile) { try { fs.unlinkSync(lmFile); } catch {} }
        if (err) console.error('test_mapping stderr:', err);
        try { resolve(JSON.parse(out.trim() || '{}')); }
        catch { resolve({}); }
      });
    });
  });

  // ── Logo operations ──────────────────────────────────────────────────────────
  function runLogoScript(base64png, extraArgs) {
    const tmpFile = path.join(os.tmpdir(), `ds_logo_${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64png, 'base64'));
    const script = ctx.resourcePath('python_backend', 'logo', 'fingerprint.py');
    const py = pythonExe();

    return new Promise((resolve) => {
      const proc = spawn(py, pythonArgs(script, '--image-file', tmpFile, ...extraArgs),
        { windowsHide: true });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(tmpFile); } catch {}
        try { resolve(JSON.parse(out)); } catch { resolve(null); }
      });
    });
  }

  ipcMain.handle('extract-logo-hash', (_e, b64) => {
    requireRole('admin', 'edit');
    return runLogoScript(b64, ['--mode', 'extract']);
  });

  ipcMain.handle('match-logo-hash', async (_e, b64) => {
    requireRole('admin', 'edit');
    const learning = require('../../../database/modules/learning');
    const logos = learning.getAllLogos(getDb());
    if (!logos.length) return null;
    const fpFile = path.join(os.tmpdir(), `ds_fp_${Date.now()}.json`);
    fs.writeFileSync(fpFile, JSON.stringify(logos));
    const result = await runLogoScript(b64, ['--mode', 'match',
      '--stored-file', fpFile, '--threshold', '12']);
    try { fs.unlinkSync(fpFile); } catch {}
    return result?.match || null;
  });

  ipcMain.handle('save-logo-fingerprint', (_e, { supplier_name, phash, ahash }) => {
    requireRole('admin', 'edit');
    const learning = require('../../../database/modules/learning');
    learning.saveLogoFingerprint(getDb(), { supplier_name, phash, ahash });
    return true;
  });

  ipcMain.handle('save-field-anchor', (_e, data) => {
    requireRole('admin', 'edit');
    const learning = require('../../../database/modules/learning');
    const db = getDb();
    learning.saveAnchor(db, data);
    // Recording verification (diagnostic only): record exactly what now sits in
    // field_anchors for this (supplier, doc_type, field) after the save, so a
    // diagnostic log shows whether the ⊕ teach actually persisted the drawn
    // coordinates — and that an authoritative re-teach collapsed stale siblings.
    // No-op unless diagnostic logging is enabled (never logs in normal use).
    try {
      if (_diagEnabled(db)) {
        const rows = db.prepare(`
          SELECT id, anchor_label, direction, x_norm, y_norm, w_norm, h_norm,
                 offset_dx_norm, offset_dy_norm,
                 usage_count, confidence, last_authoritative_at
          FROM field_anchors
          WHERE field_key = ?
            AND ((supplier_name IS ?) OR supplier_name = ?)
            AND ((document_type IS ?) OR document_type = ?)
        `).all(data.field_key,
               data.supplier_name || null, data.supplier_name || '__unknown__',
               data.document_type || null, data.document_type || null);
        diaglog.enable();
        diaglog.write({ ev: 'anchor_saved', field_key: data.field_key,
          supplier_name: data.supplier_name, document_type: data.document_type,
          authoritative: !!data.authoritative, persisted_rows: rows });
      }
    } catch {}
    return true;
  });

  // Operator-taught field cleanup rule (Review right-click toolkit). Same role gate
  // as the ⊕ teach; learning.saveFieldRule normalizes + upserts. Returns true so the
  // renderer can flush staged rules on confirm without a result shape to parse.
  ipcMain.handle('save-field-rule', (_e, data) => {
    requireRole('admin', 'edit');
    const learning = require('../../../database/modules/learning');
    try { learning.saveFieldRule(getDb(), data || {}); } catch (e) { logger?.warn?.(`save-field-rule: ${e && e.message}`); }
    return true;
  });

  // ── PDF splitting ───────────────────────────────────────────────────────────
  // Thin wrapper around pdf_splitter.py (pypdf). Splits a single PDF into
  // page-range sub-documents that can then be dropped into the normal process-
  // folder pipeline. outDir is optional (defaults to a safe system-temp path).
  ipcMain.handle('split-pdf', async (_e, filePath, ranges, outDir, docId, every) => {
    requireRole('admin', 'edit');
    // `every` (split every N pages, 1 = every page) is an alternative to an
    // explicit range string; exactly one is required.
    const everyN = Number(every) > 0 ? Math.floor(Number(every)) : null;
    if (!filePath || (!ranges && !everyN)) {
      return { success: false, error: 'filePath and ranges or every are required' };
    }

    // Resolve the ACTUAL source file: prefer the app-managed working copy. The original
    // is DRAINED out of the intake folder into Processed/ once a working copy exists, so
    // splitting from `filePath` (the original location) would fail "file not found" after
    // a normal process. Mirrors the reprocess path's working-copy-first resolution.
    let srcFile = filePath;
    try {
      if (docId) {
        const wp = getDb().prepare('SELECT working_path FROM documents WHERE id = ?').get(docId);
        if (wp && wp.working_path && fs.existsSync(wp.working_path)) srcFile = wp.working_path;
      }
    } catch { /* fall back to filePath */ }
    if (!srcFile || !fs.existsSync(srcFile)) {
      return { success: false, error: 'Source PDF not found — the original may have been moved into the Processed folder after processing.' };
    }
    // Write the split pages next to the ORIGINAL location (a real user folder), never the
    // hidden inbox where the working copy lives.
    const splitOutDir = outDir || (filePath ? path.dirname(filePath) : path.dirname(srcFile));

    const py             = pythonExe();
    const splitterScript = path.join(path.dirname(backendScript()), 'pdf_splitter.py');
    const splitArgs      = everyN ? ['--every', String(everyN)] : ['--ranges', ranges];
    const args           = pythonArgs(splitterScript, '--file', srcFile, ...splitArgs, '--outdir', splitOutDir);

    const raw = await new Promise((resolve) => {
      let stdout = '';
      const proc = spawn(py, args, { windowsHide: true });
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('close', () => {
        try { resolve(JSON.parse(stdout.trim())); }
        catch { resolve({ success: false, error: 'pdf_splitter returned non-JSON output', raw: stdout.trim() }); }
      });
      proc.on('error', (err) => resolve({ success: false, error: err.message }));
    });

    if (!raw.success) return raw;

    // Register split files as pending documents and remove the original.
    // Only deletes the original after all outputs are confirmed on disk.
    const documents = require('../../../database/modules/documents');
    const db        = getDb();

    const createdFiles = (raw.files || []).filter(f => fs.existsSync(f));
    if (createdFiles.length === 0) {
      return { success: false, error: 'Splitter reported success but no output files were found on disk.' };
    }

    const docIds = [];
    for (const outFile of createdFiles) {
      const info = documents.insert(db, {
        original_filename: path.basename(outFile),
        folder_path:       path.dirname(outFile),
        status:            'needs_review',
      });
      docIds.push(info.lastInsertRowid);
    }

    // Remove original from DB and disk — only after outputs are confirmed.
    if (docId) {
      documents.deleteDoc(db, docId);
    }
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { logger?.warn('Could not delete original after split:', e.message); }
    }

    notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
    notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));

    return { success: true, files: createdFiles, docIds };
  });
}

// Move a processed original out of the intake folder into `destDir` (a managed
// "Processed"/"Errors" subfolder) so it can't be re-pulled by a later scan. All
// fs is via the injected module so it's hermetically testable. Collisions get a
// `-N` suffix; a cross-volume rename (EXDEV) falls back to copy+unlink. Returns
// the new { folder, filename }, or null if the source no longer exists.
// CALLER must verify a durable copy exists before calling — this DOES remove the
// original from the intake folder.
// Best-effort blocking sleep — only ever hit on the drain lock-retry path below.
function _sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

// opts.retry (default true): retry briefly on a transient lock. The INLINE caller
// (_drainNowOrDefer, on the main thread per file_done) passes retry:false so it never
// blocks on Atomics.wait — a locked file is simply deferred to the post-worker flush,
// which retries (handles are released by then).
function drainOriginalToFolder(fs, path, srcPath, destDir, originalFilename, opts = {}) {
  if (!fs.existsSync(srcPath)) return null;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const ext  = path.extname(originalFilename);
  const base = path.basename(originalFilename, ext);
  let destPath = path.join(destDir, originalFilename);
  let counter  = 1;
  while (fs.existsSync(destPath)) {
    destPath = path.join(destDir, `${base}-${counter}${ext}`);
    counter++;
  }
  const maxAttempts = opts.retry === false ? 1 : 5;
  // The OCR worker can still hold a transient handle on the PDF for a moment after it
  // emits file_done, so an immediate rename fails with a LOCK error (EBUSY/EPERM/
  // EACCES) — NOT a cross-volume error. The previous code assumed EVERY failure was
  // cross-volume and did copy+unlink, which on a lock left the copy (a DUPLICATE in
  // Processed/) but failed the unlink — so the original stayed in the source AND a
  // duplicate appeared. Now: a genuine EXDEV uses copy+unlink; a lock is retried
  // briefly; if still locked we leave the original in place (it drains on the next
  // run) and never create a duplicate.
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.renameSync(srcPath, destPath);
      return { folder: destDir, filename: path.basename(destPath) };
    } catch (e) {
      if (e && e.code === 'EXDEV') {           // genuine cross-volume → copy + remove
        fs.copyFileSync(srcPath, destPath);
        try {
          fs.unlinkSync(srcPath);
        } catch {
          // Copy landed but the source is locked — remove the copy so we never leave a
          // DUPLICATE; the original drains on a later flush/run.
          try { fs.unlinkSync(destPath); } catch {}
          return null;
        }
        return { folder: destDir, filename: path.basename(destPath) };
      }
      if (attempt >= maxAttempts - 1) return null;   // still locked → leave it, no duplicate
      _sleepMs(80);
    }
  }
  return null;
}

// Flush the deferred-drain queue: move each processed/failed original into its
// Processed/Errors subfolder now that the worker PROCESS has exited and released the
// file handle. Called from the manual batch (after Promise.all) and the watch worker's
// close handler. Items still locked are re-queued for a later flush (never lost, never
// duplicated — see drainOriginalToFolder). Best-effort; failures are logged, not fatal.
// Try to move an original NOW (the worker closes each PDF as it finishes it, so the
// handle is usually free by file_done → the file moves live, "as processed"). If it is
// still momentarily locked, queue it for the post-worker flush instead of blocking.
function _drainNowOrDefer(db, logger, item) {
  try {
    // retry:false → a single non-blocking attempt on the main thread; a locked file is
    // deferred to _flushPendingDrains (after the worker exits), which DOES retry.
    const moved = drainOriginalToFolder(fs, path, item.srcPath, item.destDir, item.originalFilename, { retry: false });
    if (moved) {
      db.prepare('UPDATE documents SET folder_path = ? WHERE id = ?').run(moved.folder, item.docId);
      if (moved.filename !== item.originalFilename) {
        db.prepare('UPDATE documents SET original_filename = ? WHERE id = ?').run(moved.filename, item.docId);
      }
      logger?.log(`Drained to ${item.kind}: ${item.originalFilename} → ${moved.folder}`);
      return;
    }
  } catch (e) {
    logger?.warn(`Inline drain deferred for ${item.originalFilename}: ${e.message}`);
  }
  if (fs.existsSync(item.srcPath)) _pendingDrains.push(item);   // still locked → flush after the worker exits
}

function _flushPendingDrains(db, logger) {
  if (!_pendingDrains.length) return;
  const queue = _pendingDrains;
  _pendingDrains = [];
  const keep = [];
  for (const item of queue) {
    try {
      const moved = drainOriginalToFolder(fs, path, item.srcPath, item.destDir, item.originalFilename);
      if (moved) {
        db.prepare('UPDATE documents SET folder_path = ? WHERE id = ?').run(moved.folder, item.docId);
        if (moved.filename !== item.originalFilename) {
          db.prepare('UPDATE documents SET original_filename = ? WHERE id = ?').run(moved.filename, item.docId);
        }
        logger?.log(`Drained to ${item.kind}: ${item.originalFilename} → ${moved.folder}`);
      } else if (fs.existsSync(item.srcPath)) {
        keep.push(item);   // still locked → retry on the next flush
      }
    } catch (e) {
      logger?.warn(`Could not drain ${item.originalFilename} to ${item.kind}: ${e.message}`);
    }
  }
  if (keep.length) _pendingDrains.push(...keep);
}

// Make/refresh the app-managed working copy of an intake file at
// inboxDir/<docId><ext>. ATOMIC: copy to a `.part` temp then rename onto the
// final name, so a crash mid-copy never leaves a half-written <docId><ext> that
// looks valid (a later reconcile sweep GCs stray `.part` files). fs/path injected
// for testability; the inbox dir is resolved by the caller (keeps electron out of
// the helper). Returns the working_path on success, else null (best-effort).
function ensureWorkingCopy(fs, path, inboxDir, srcPath, docId, originalFilename) {
  if (!fs.existsSync(srcPath)) return null;
  if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
  const rawExt = path.extname(originalFilename || '');
  const ext    = /^\.[A-Za-z0-9]+$/.test(rawExt) ? rawExt : '';   // sanitise extension
  const dest   = path.join(inboxDir, `${docId}${ext}`);
  const part   = `${dest}.part`;
  try {
    fs.copyFileSync(srcPath, part);
    fs.renameSync(part, dest);   // atomic publish
    return dest;
  } catch (e) {
    try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch {}
    try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
    return null;
  }
}

// Reconcile the inbox holding area to the DB (the source of truth). The DB is
// authoritative; every inbox file must map to a live document row, else it's
// debris from a crash and is collected. Removes:
//   • interrupted-copy debris  (*.part)
//   • orphaned working copies  (no documents row for that id)
//   • dead working copies      (the doc is already confirmed/deleted)
// Keeps copies for live docs (needs_review/deferred/error/pending). A crash can
// only ever leave EXTRA files (cleaned here) — never lose a document, because an
// original is only removed after a verified copy. Pure: fs/path/db injected for
// hermetic testing. Returns a summary of what it did.
function reconcileHolding(fs, path, db, inboxDir) {
  const summary = { scanned: 0, partsRemoved: 0, orphansRemoved: 0, deadRemoved: 0, kept: 0 };
  if (!fs.existsSync(inboxDir)) return summary;
  let entries;
  try { entries = fs.readdirSync(inboxDir); } catch { return summary; }

  const statusById = new Map(
    db.prepare('SELECT id, status FROM documents').all().map(r => [r.id, r.status])
  );
  const DEAD = new Set(['confirmed', 'deleted']);

  for (const name of entries) {
    summary.scanned++;
    const full = path.join(inboxDir, name);
    if (name.endsWith('.part')) {
      try { fs.unlinkSync(full); summary.partsRemoved++; } catch {}
      continue;
    }
    // Managed copies are named exactly <docId><ext> (a plain integer id). Anything
    // else (a stray user file) is left untouched.
    const idStr = path.basename(name, path.extname(name));
    const id    = parseInt(idStr, 10);
    if (!Number.isInteger(id) || String(id) !== idStr) { summary.kept++; continue; }

    const status = statusById.get(id);
    if (status === undefined) {
      try { fs.unlinkSync(full); summary.orphansRemoved++; } catch {}
    } else if (DEAD.has(status)) {
      try { fs.unlinkSync(full); summary.deadRemoved++; } catch {}
    } else {
      summary.kept++;
    }
  }
  return summary;
}

// Thin wrapper: resolve the inbox dir (electron userData) and run the sweep,
// logging a one-line summary. Called on startup and after each batch.
function runHoldingReconcile(db, logger) {
  try {
    const { app } = require('electron');
    const inboxDir = path.join(app.getPath('userData'), 'inbox');
    const s = reconcileHolding(fs, path, db, inboxDir);
    const removed = s.partsRemoved + s.orphansRemoved + s.deadRemoved;
    if (removed > 0) {
      logger?.log(`[reconcile] holding swept: ${removed} removed ` +
        `(${s.partsRemoved} .part, ${s.orphansRemoved} orphan, ${s.deadRemoved} confirmed) · ${s.kept} kept`);
    }
    return s;
  } catch (e) {
    logger?.warn(`[reconcile] holding sweep failed: ${e.message}`);
    return null;
  }
}

// ── Internal: save file_done message to DB ────────────────────────────────────
// Rotate the inbox working copy in place (pypdf via pdf_rotate.py) to match the per-page
// orientation OSD detected on this import. PDF only, only when a non-zero rotation exists.
// SYNCHRONOUS (a quick /Rotate rewrite) so it completes before the doc can be auto-filed or
// drained. Best-effort — a failure just leaves the working copy unrotated (logged).
function _rotateWorkingCopyIfNeeded(msg, docId, logger) {
  try {
    const rots = msg.page_rotations;
    if (!_pyHelpers || !msg.working_path || !Array.isArray(rots) || !rots.some(r => r)) return;
    if (!/\.pdf$/i.test(msg.working_path)) return;
    const script = path.join(path.dirname(_pyHelpers.backendScript()), 'pdf_rotate.py');
    const r = require('child_process').spawnSync(
      _pyHelpers.pythonExe(),
      _pyHelpers.pythonArgs(script, '--file', msg.working_path, '--rotations', rots.join(',')),
      { windowsHide: true, timeout: 30000, encoding: 'utf8' });
    if (r.status === 0) logger?.log?.(`Auto-rotated working copy (docId=${docId}): ${rots.filter(x => x).length} page(s)`);
    else logger?.warn?.(`[auto-rotate] pdf_rotate failed (docId=${docId}): ${String(r.stderr || r.error || '').slice(0, 200)}`);
  } catch (e) { logger?.warn?.(`[auto-rotate] ${e && e.message}`); }
}

function _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger, autoFileRun = true) {
  if (msg.type === 'file_begin') {
    logger?.log(`File begin: ${msg.filename}`);
    return;
  }
  if (msg.type !== 'file_done') return;

  if (!msg.success) {
    logger?.err(`File failed: ${msg.original_filename || '?'} — ${msg.error || 'unknown error'}`);
    // Persist a "stuck" record instead of silently dropping the failure, so the
    // doc is VISIBLE (a launchpad surface) and reprocessable — previously a failed
    // file left no DB row at all.
    const documents = require('../../../database/modules/documents');
    const learning  = require('../../../database/modules/learning');
    let docId = null;
    try {
      const ins = documents.insert(db, {
        original_filename: msg.original_filename || 'unknown',
        folder_path:       folderPath,
        status:            'error',
      });
      docId = ins.lastInsertRowid;
      documents.update(db, docId, { error_message: msg.error || 'unknown error' });
      msg.db_id = docId;
    } catch (e) {
      logger?.warn(`Could not record failed document ${msg.original_filename || '?'}: ${e.message}`);
    }
    // Give the stuck doc a VERIFIED working copy (so it's reprocessable even if the
    // source later vanishes) and drain its original into an Errors/ subfolder —
    // same model as success → Processed/ — so it isn't re-pulled on the next run.
    // Best-effort and INDEPENDENT of the row insert above: a copy/move failure must
    // never lose the error record.
    if (docId != null) {
      try {
        const { app }    = require('electron');
        const inboxDir   = path.join(app.getPath('userData'), 'inbox');
        const srcForCopy = msg.original_filename ? path.join(folderPath, msg.original_filename) : null;
        const wp = srcForCopy
          ? ensureWorkingCopy(fs, path, inboxDir, srcForCopy, docId, msg.original_filename)
          : null;
        if (wp) { documents.update(db, docId, { working_path: wp }); msg.working_path = wp; }
        const drainEnabled = learning.getSetting(db, 'drain_processed', 'true') !== 'false';
        if (drainEnabled && wp && fs.existsSync(wp) && srcForCopy) {
          _drainNowOrDefer(db, logger, {
            docId, destDir: path.join(folderPath, 'Errors'), kind: 'Errors',
            srcPath: srcForCopy, originalFilename: msg.original_filename,
          });
        }
      } catch (e) {
        logger?.warn(`Could not stow failed original ${msg.original_filename || '?'}: ${e.message}`);
      }
      try { notifyMainWindow?.('stuck-count-changed', documents.getStuckCount(db)); } catch {}
    }
    return;
  }

  const documents = require('../../../database/modules/documents');
  const learning  = require('../../../database/modules/learning');
  const docTypes  = require('../../../database/modules/document_types');

  // Resolve document_type_id from the detected type name so the review queue
  // has type_slug populated and anchors/hints are tagged correctly.
  let document_type_id = null;
  if (msg.document_type) {
    const allTypes = docTypes.getAllWithFields(db);
    const match = allTypes.find(
      dt => dt.name.toLowerCase() === msg.document_type.toLowerCase()
    );
    if (match) document_type_id = match.id;
  }

  // _supplier_name metadata is only populated via logo/hint matching, which is
  // empty on a fresh install — fall back to the extracted field value so the
  // queue/DB don't show null or a stale supplier name.
  const supplierName = msg.supplier_name || msg.extractions?.supplier_name?.value || null;

  const docResult = documents.insert(db, {
    original_filename:  msg.original_filename,
    folder_path:        folderPath,
    document_type_id,
    supplier_name:      supplierName,
    overall_confidence: msg.overall_confidence || null,
    status:             msg.status || 'needs_review',
    template_id:        msg.template_id   || null,
    logo_phash:         msg.logo_phash    || null,
    keyword_fingerprint: msg.keyword_fingerprint
      ? JSON.stringify(msg.keyword_fingerprint) : null,
    ocr_text:           msg.ocr_text      || null,
    page_count:         msg.page_count    || null,
  });

  const docId = docResult.lastInsertRowid;

  if (msg.extractions) {
    const rows = Object.entries(msg.extractions).map(([key, data]) => ({
      field_key:         key,
      raw_value:         data.value != null ? String(data.value) : null,
      display_value:     data.value != null ? String(data.value) : null,
      confidence:        data.confidence ?? null,
      extraction_method: data.method || null,
      validation_note:   data.validation_note || null,
      corrected_to:      data.corrected_to || null,
      anchor_label:      data.anchor || null,
    }));
    learning.insertExtractions(db, docId, rows);
  }

  msg.db_id = docId;

  // ── Copy-on-import: keep an app-managed working copy ─────────────────────────
  // So preview / reprocess / confirm never depend on the user's source folder
  // surviving. Filename is the docId under userData (collision-proof — unique PK
  // — and no user-supplied text in the path). Best-effort: on any failure leave
  // working_path NULL and fall back to the source path / recovery logic as before.
  // Runs BEFORE the drain below so it copies the file in place.
  try {
    const { app }    = require('electron');
    const inboxDir   = path.join(app.getPath('userData'), 'inbox');
    const srcForCopy = path.join(folderPath, msg.original_filename);
    const wp = ensureWorkingCopy(fs, path, inboxDir, srcForCopy, docId, msg.original_filename);
    if (wp) {
      documents.update(db, docId, { working_path: wp });
      msg.working_path = wp;
      // Auto-rotate the working copy to match the orientation OSD detected this import, so the
      // FILED copy + every future reprocess are upright (one detection). Synchronous so it's
      // done before the doc can be auto-filed. No-op unless a non-zero page rotation exists.
      _rotateWorkingCopyIfNeeded(msg, docId, logger);
    }
  } catch (e) {
    console.warn(`[import] working copy failed for docId=${docId}: ${e.message}`);
  }

  // ── Drain the original out of the intake folder (Slice 2) ────────────────────
  // Once a VERIFIED working copy exists, move the original from the source/watch
  // folder into a "Processed" subfolder so it can't be re-pulled on the next
  // manual run or after a restart (folder scans are non-recursive → subfolders are
  // skipped). Move, never delete, for data-loss safety. Gated on:
  //   • drain_processed setting (default ON; set 'false' to keep originals in place)
  //   • the inbox working copy existing on disk (so the original is never the only
  //     copy when it leaves the intake folder).
  // An explicit processed_folder setting still wins (back-compat); otherwise the
  // target is <intakeFolder>/Processed, which works for BOTH manual and watch.
  const drainEnabled = learning.getSetting(db, 'drain_processed', 'true') !== 'false';
  if (drainEnabled && msg.working_path && fs.existsSync(msg.working_path)) {
    const explicit = learning.getSetting(db, 'processed_folder', null);
    const destDir  = (explicit && explicit.trim()) || path.join(folderPath, 'Processed');
    // Move it now if the worker has already released the file (the common case — it
    // closes each PDF as it finishes); otherwise defer to the post-worker flush.
    _drainNowOrDefer(db, logger, {
      docId, destDir, kind: 'Processed',
      srcPath: path.join(folderPath, msg.original_filename),
      originalFilename: msg.original_filename,
    });
  }

  // Log extraction result
  if (logger) {
    const exFields = msg.extractions
      ? Object.entries(msg.extractions)
          .map(([k, v]) => `${k}=${JSON.stringify(v?.value ?? null)}(${v?.confidence ?? '?'}%)`)
          .join(' | ')
      : 'none';
    const tmpl = msg.template_id ? ` template=${msg.template_id}` : '';
    logger.log(
      `File done: ${msg.original_filename} → status=${msg.status}` +
      ` type=${msg.document_type || '?'} supplier=${supplierName || '?'}` +
      ` conf=${msg.overall_confidence || '?'}%${tmpl}`
    );
    if (exFields) logger.log(`  Fields: ${exFields}`);
  }

  // AUTO-FILE on import: a 100%-confidence, fully-typed, UN-flagged doc files itself
  // immediately — for MANUAL import, the WATCH folder, and background runs alike (the single
  // backend decision point, replacing the old renderer-side pass so it works even when the
  // window is closed). Async so it never blocks file_done; the drain above handles the original.
  // Skipped when the run opted out (the Teach-wizard single-file import keeps the doc in Review).
  if (autoFileRun) _maybeAutoFile(db, msg, folderPath, notifyMainWindow, logger);

  notifyMainWindow('review-count-changed', documents.getReviewCount(db));
  notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
}

function _maybeAutoFile(db, msg, folderPath, notifyMainWindow, logger) {
  try {
    const learning = require('../../../database/modules/learning');
    if (learning.getSetting(db, 'auto_file_full_confidence', 'true') === 'false') return;
    // Configurable threshold (default 100 = full confidence only). Below 100, a doc auto-files
    // only when it ALSO passed clean (needs_review false → fully typed, no field flagged) — the
    // flag/needs-review gate is the real safety, the threshold just says "confident enough".
    const thr = parseInt(learning.getSetting(db, 'auto_file_threshold', '100'), 10) || 100;
    if (!msg.db_id || (msg.overall_confidence || 0) < thr) return;
    if (thr < 100 && msg.needs_review) return;
    setImmediate(() => {
      _autoFileDoc(db, msg.db_id, folderPath, notifyMainWindow, logger)
        .catch(e => { try { logger?.warn?.(`auto-file ${msg.db_id}: ${e.message}`); } catch {} });
    });
  } catch {}
}

async function _autoFileDoc(db, docId, folderPath, notifyMainWindow, logger) {
  const documents = require('../../../database/modules/documents');
  const learning  = require('../../../database/modules/learning');
  const doctypes  = require('../../../database/modules/document_types');
  const filing    = require('../filing/handler');
  const doc = documents.getById(db, docId);
  if (!doc || doc.status !== 'needs_review' || !doc.document_type_id || doc.overall_confidence !== 100) return;
  // 100% implies all required fields present + high confidence; also refuse a flagged field.
  const flagged = db.prepare('SELECT COUNT(*) c FROM extractions WHERE document_id = ? AND validation_note IS NOT NULL').get(docId).c;
  if (flagged) return;
  const dtRow  = db.prepare('SELECT slug FROM document_types WHERE id = ?').get(doc.document_type_id);
  const dtInfo = dtRow && dtRow.slug ? doctypes.getWithFields(db, dtRow.slug) : null;
  if (!dtInfo) return;
  const outputRoot = learning.getSetting(db, 'output_folder', null);
  if (!outputRoot) return;   // can't file without a destination
  const allValues = {};
  for (const e of db.prepare('SELECT field_key, display_value, raw_value FROM extractions WHERE document_id = ?').all(docId)) {
    allValues[e.field_key] = e.display_value ?? e.raw_value;
  }
  // Claim the doc BEFORE filing (atomic compare-and-set) so the 100% auto-file can't
  // double-file a doc a human confirmed in the gap since the status check above, and so it's
  // honestly attributed. If the claim doesn't land, someone else already took it — don't file.
  const claim = documents.confirmIfReviewable(db, docId, { confirmed_by_username: 'Auto-filed (100%)' });
  if (!claim || claim.changes === 0) return;
  let fr;
  try {
    fr = await filing.commitDocument({
      db, fs, path, outputRoot,
      folderPath:       doc.folder_path || folderPath,
      originalFilename: doc.original_filename,
      workingPath:      doc.working_path,
      allValues, documentType: dtInfo.name, dtInfo, logger,
    });
  } catch (e) { fr = null; logger?.warn?.(`[auto-file] commit failed for docId=${docId}: ${e && e.message}`); }
  if (!fr || !fr.success) {
    // Filing failed after the claim — roll the doc back into the review queue so it isn't
    // stranded as "confirmed" with no stored file.
    try { documents.update(db, docId, { status: 'needs_review', confirmed_at: null, confirmed_by_username: null }); } catch {}
    return;
  }
  documents.update(db, docId, { stored_filename: fr.filename, stored_path: fr.filePath });
  try { db.prepare('UPDATE extractions SET validation_note = NULL, corrected_to = NULL WHERE document_id = ?').run(docId); } catch {}
  if (doc.working_path) {
    try { if (fs.existsSync(doc.working_path)) fs.unlinkSync(doc.working_path); } catch {}
    try { documents.update(db, docId, { working_path: null }); } catch {}
  }
  const refField = dtInfo.ref_field_key || 'invoice_number';
  const dateField = dtInfo.date_field_key || 'invoice_date';
  try {
    documents.update(db, docId, {
      supplier_name:    allValues.supplier_name || doc.supplier_name || null,
      doc_date:         allValues[dateField]    || null,
      reference_number: allValues[refField]     || null,
    });
  } catch {}
  _recordAutoFiled(db, docId);
  logger?.log(`Auto-filed (100%): ${doc.original_filename} → ${fr.filename}`);
  try {
    notifyMainWindow?.('doc-auto-filed', { docId, count: getAutoFiledIds(db).length });
    notifyMainWindow?.('review-count-changed', documents.getReviewCount(db));
  } catch {}
}

// Rolling list of recently auto-filed doc ids (the "auto-committed" set the Review window
// re-surfaces). Settings JSON {ids, at}; capped at 300, time-bounded to ~7 days.
function getAutoFiledIds(db) {
  const learning = require('../../../database/modules/learning');
  try {
    const o = JSON.parse(learning.getSetting(db, 'recent_auto_filed', '') || 'null');
    if (!o || !Array.isArray(o.ids)) return [];
    if (o.at && (Date.now() - o.at) > 7 * 864e5) return [];
    return o.ids;
  } catch { return []; }
}
function _recordAutoFiled(db, docId) {
  const learning = require('../../../database/modules/learning');
  try {
    const ids = getAutoFiledIds(db);
    if (!ids.includes(docId)) ids.push(docId);
    learning.setSetting(db, 'recent_auto_filed', JSON.stringify({ ids: ids.slice(-300), at: Date.now() }));
  } catch {}
}

// Quit-time teardown: tree-kill every running manual-batch worker (the same
// taskkill /T as the stop-processing IPC) so the app exits clean with no orphaned
// python.exe. Called from main.js before-quit.
function killAll() {
  if (!_currentBatchProcs.length) return;
  _cancelRequested = true;
  for (const proc of _currentBatchProcs) {
    try {
      require('child_process').spawnSync(
        'taskkill', ['/F', '/T', '/PID', String(proc.pid)],
        { windowsHide: true, stdio: 'ignore' });
    } catch {}
    try { proc.kill(); } catch {}
  }
  _currentBatchProcs = [];
}

module.exports = {
  register,
  // Exposed so other entry points into the same pipeline (e.g. the
  // watch-folder handler) can reuse this setup/dispatch machinery instead
  // of duplicating it on a parallel import path.
  buildTrainingArgs,
  killAll,
  cleanupTempFiles: cleanupFiles,
  handleFileMessage: _handleFileMessage,
  flushPendingDrains: _flushPendingDrains,
  drainOriginalToFolder,
  ensureWorkingCopy,
  reconcileHolding,
  runHoldingReconcile,
  isBatchRunning: () => _anyProcessingBusy(),
  // Exposed for the F-06 path-policy unit test (test_open_path_policy.js).
  _isOpenablePath,
};
