'use strict';

/**
 * modules/watch/handler.js
 * Watch-folder monitoring — automatically imports newly arrived scans from
 * a user-selected drop folder (e.g. a network scanner output directory)
 * through the existing processing pipeline.
 *
 * Mechanism: polling, not fs.watch(). fs.watch is documented as unreliable
 * on Windows network/SMB shares (exactly the "scanner drop folder" scenario
 * this feature targets), and polling naturally gives us the size/mtime
 * comparison the stability debounce already needs — one mechanism serves
 * both "detect a new file" and "has it stopped changing yet".
 *
 * Per-file state machine (keyed by filename, values in `_tracked`):
 *   watching   — seen, stability timer running (resets on size/mtime change)
 *   processing — stable for STABILITY_DELAY_MS, handed to the pipeline
 *   done       — pipeline has finished with this file; only re-tracked if
 *                the file's content changes again (new size/mtime — e.g.
 *                a re-scan overwriting the same filename)
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const SUPPORTED_EXTENSIONS = new Set(
  ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp']
);

const POLL_INTERVAL_MS    = 5000;
const STABILITY_DELAY_MS  = 10000;

let _ctx          = null;
let _pollTimer    = null;
let _watchFolder  = null;
let _tracked      = new Map();   // filename -> { size, mtimeMs, lastChangeAt, state }
let _queue        = [];          // filenames accepted, awaiting their turn
let _inFlight     = 0;           // count of _processFile workers currently running
const _liveProcs  = new Set();   // live watch Python child procs — for quit-time kill

// ── Pure stability-decision logic ────────────────────────────────────────────
// Given the previously tracked state for a file (or null, on first sighting)
// and a fresh stat reading, decides what happens next. Kept side-effect-free
// and free of fs/timer/IPC dependencies so the debounce state machine — the
// crux of "wait until stable, reset on change, never reprocess in-flight or
// already-done files" — can be exercised directly in a unit test rather than
// only indirectly through a live poll loop. Exported for exactly that purpose.
function classifyPoll(prev, stat, now, stabilityDelayMs) {
  if (!prev) {
    return {
      action: 'detected',
      record: { size: stat.size, mtimeMs: stat.mtimeMs, lastChangeAt: now, state: 'watching' },
    };
  }

  const changed = stat.size !== prev.size || stat.mtimeMs !== prev.mtimeMs;

  if (prev.state === 'processing') {
    return { action: 'in-flight', record: prev };
  }

  if (prev.state === 'done') {
    if (changed) {
      return {
        action: 'retrack',
        record: { size: stat.size, mtimeMs: stat.mtimeMs, lastChangeAt: now, state: 'watching' },
      };
    }
    return { action: 'unchanged-done', record: prev };
  }

  // state === 'watching'
  if (changed) {
    return {
      action: 'reset',
      record: { ...prev, size: stat.size, mtimeMs: stat.mtimeMs, lastChangeAt: now },
    };
  }
  if (now - prev.lastChangeAt >= stabilityDelayMs) {
    return { action: 'stable', record: { ...prev, state: 'processing' } };
  }
  return { action: 'wait', record: prev };
}

function _log(level, msg) {
  const logger = _ctx?.logger;
  if (!logger) return;
  if      (level === 'err')  logger.err(msg);
  else if (level === 'warn') logger.warn(msg);
  else                       logger.log(msg);
}

// ── Start / stop ──────────────────────────────────────────────────────────────
function _start(db) {
  _stop();

  const learning = require('../../../database/modules/learning');
  const folder = learning.getSetting(db, 'watch_folder', null);
  if (!folder) {
    _log('log', '[watch] not started — no watch folder configured');
    return;
  }
  if (!fs.existsSync(folder)) {
    _log('warn', `[watch] not started — folder does not exist: ${folder}`);
    return;
  }

  _watchFolder = folder;
  _tracked = new Map();
  _queue = [];
  _inFlight = 0;

  _log('log', `[watch] monitoring started: ${folder} (stability delay ${STABILITY_DELAY_MS / 1000}s, poll every ${POLL_INTERVAL_MS / 1000}s)`);

  // Files already sitting in the folder are treated exactly like newly
  // arrived ones — their stability timers start now, from a clean baseline.
  // This is simpler and more consistent than a separate "ignore old files"
  // path, and it means a scan that arrived while the app was closed still
  // gets imported (rather than silently never being picked up).
  _poll(db);
  _pollTimer = setInterval(() => _poll(db), POLL_INTERVAL_MS);
}

function _stop() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_watchFolder) _log('log', `[watch] monitoring stopped: ${_watchFolder}`);
  _watchFolder = null;
  _tracked = new Map();
  _queue = [];
  _inFlight = 0;
}

// Quit-time teardown: stop the poll loop and tree-kill any in-flight watch Python
// so the app exits clean with no orphaned python.exe. taskkill /T kills the launcher
// (py.exe) AND its python.exe child — proc.kill() alone leaves the child alive.
function stopForQuit() {
  _stop();
  for (const proc of _liveProcs) {
    try {
      require('child_process').spawnSync(
        'taskkill', ['/F', '/T', '/PID', String(proc.pid)],
        { windowsHide: true, stdio: 'ignore' });
    } catch {}
    try { proc.kill(); } catch {}
  }
  _liveProcs.clear();
}

// ── Poll: detect new/changed files, advance stability timers ─────────────────
function _poll(db) {
  if (!_watchFolder) return;

  let entries;
  try {
    entries = fs.readdirSync(_watchFolder, { withFileTypes: true });
  } catch (e) {
    _log('warn', `[watch] could not read folder: ${_watchFolder} — ${e.message}`);
    return;
  }

  const now  = Date.now();
  const seen = new Set();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    seen.add(entry.name);

    let stat;
    try { stat = fs.statSync(path.join(_watchFolder, entry.name)); }
    catch { continue; }

    const prev = _tracked.get(entry.name) || null;
    const decision = classifyPoll(prev, stat, now, STABILITY_DELAY_MS);
    _tracked.set(entry.name, decision.record);

    switch (decision.action) {
      case 'detected':
        _log('log', `[watch] file detected: ${entry.name} — stability timer started (${STABILITY_DELAY_MS / 1000}s)`);
        break;
      case 'reset':
        _log('log', `[watch] file still being written — stability timer reset: ${entry.name}`);
        break;
      case 'retrack':
        _log('log', `[watch] file changed after being processed — re-tracking: ${entry.name}`);
        break;
      case 'stable':
        _log('log', `[watch] file stable for ${STABILITY_DELAY_MS / 1000}s — accepted for processing: ${entry.name}`);
        _queue.push(entry.name);
        _drainQueue(db);
        break;
      // 'wait', 'in-flight', 'unchanged-done': nothing to do, no log spam
    }
  }

  // Files that vanished before becoming stable (moved/deleted by something
  // else) — drop their tracking so a later file with the same name is
  // treated as a fresh arrival rather than inheriting stale state.
  for (const [name, rec] of _tracked) {
    if (seen.has(name)) continue;
    if (rec.state === 'watching') {
      _log('log', `[watch] file disappeared before becoming stable — no longer tracking: ${name}`);
    }
    if (rec.state !== 'processing') _tracked.delete(name);
  }

  // Safety-net drain every poll tick. A file that became stable WHILE a manual
  // import was running was queued but deferred (isBatchRunning), and once it's
  // marked 'processing' the poll treats it as in-flight — so the 'stable' branch
  // above never re-triggers the drain. Re-attempting here picks up that stranded
  // backlog as soon as the manual batch finishes (or a worker frees up).
  // _drainQueue no-ops when the queue is empty, a batch is still running, or the
  // worker pool is full, so this is cheap when there's nothing to do.
  _drainQueue(db);
}

// ── Parallel processing — up to `processing_concurrency` files at once ───────
// Mirrors the manual folder-import worker pool: each in-flight _processFile is a
// separate Python process on a disjoint file, while ALL DB writes still funnel
// through processing.handleFileMessage on the single-threaded JS event loop
// (better-sqlite3 is synchronous), so parallelism only speeds the CPU-bound
// OCR/extraction — never DB/learning state. concurrency=1 keeps the original
// one-at-a-time behaviour. Re-entrant and idempotent: _queue.shift() hands each
// filename to exactly one worker, and the `_inFlight < concurrency` gate stops
// oversubscription no matter how often it's called (poll 'stable' + each
// worker's finally both re-invoke it).
function _drainQueue(db) {
  if (!_watchFolder || _queue.length === 0) return;

  const processing = require('../processing/handler');
  if (processing.isBatchRunning()) {
    // A manual folder import is running — don't compete for the same OCR/Python
    // resources. Retry on the next poll tick (or when a worker frees up).
    return;
  }

  const learning = require('../../../database/modules/learning');
  let concurrency = parseInt(learning.getSetting(db, 'processing_concurrency', '1'), 10);
  if (!Number.isFinite(concurrency)) concurrency = 1;
  concurrency = Math.max(1, Math.min(10, concurrency));   // mirrors processing/handler.js

  while (_inFlight < concurrency && _queue.length > 0) {
    const filename = _queue.shift();
    _inFlight++;
    _processFile(db, filename)
      .catch(e => _log('err', `[watch] processing error: ${filename} — ${e.message}`))
      .finally(() => {
        const rec = _tracked.get(filename);
        if (rec) rec.state = 'done';
        _inFlight--;
        _drainQueue(db);   // top the pool back up from the queue
      });
  }
}

async function _processFile(db, filename) {
  const { spawn, pythonExe, pythonArgs, tesseractPath, backendScript,
          configPath, notifyMainWindow } = _ctx;
  const processing = require('../processing/handler');
  const learning   = require('../../../database/modules/learning');

  // Capture the folder now: _stop() (e.g. an admin re-points the watch folder)
  // may null the module var while this file is still in flight, and the captured
  // path must stay valid for handleFileMessage's persistent folder_path. More
  // likely to matter now that several files run concurrently.
  const watchFolder = _watchFolder;
  const srcPath = path.join(watchFolder, filename);

  // Re-verify right before handing off — the file may have been removed,
  // renamed, or already picked up between being queued and its turn arriving.
  if (!fs.existsSync(srcPath)) {
    _log('log', `[watch] skipped — file no longer present: ${filename}`);
    _tracked.delete(filename);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-watch-'));
  try {
    fs.copyFileSync(srcPath, path.join(tmpDir, filename));
  } catch (e) {
    _log('warn', `[watch] could not stage file for processing — skipping: ${filename} — ${e.message}`);
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    return;
  }

  let trainingArgs, tempFiles;
  try {
    ({ args: trainingArgs, tempFiles } = processing.buildTrainingArgs(db, configPath));
  } catch (e) {
    _log('err', `[watch] setup error for ${filename}: ${e.message}`);
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    return;
  }

  const procMode = learning.getSetting(db, 'processing_mode', 'smart');
  _log('log', `[watch] processing accepted file: ${filename} (mode=${procMode})`);

  await new Promise((resolve) => {
    const py = pythonExe();
    const scriptArgs = [
      '--folder',    tmpDir,
      '--tesseract', tesseractPath(),
      '--mode',      procMode,
      ...trainingArgs,
    ];
    const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs), { windowsHide: true });
    _liveProcs.add(proc);   // track for quit-time kill (untracked on close below)
    let buf = '';

    proc.stdout.on('data', (data) => {
      buf += data.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          // Route through the SAME message handler as a manual folder
          // import — but pointed at the real watch-folder path, not the
          // isolated temp dir, so documents.folder_path keeps resolving to
          // a persistent location (preview, confirm, reprocess, the
          // processed-folder move all join folder_path + original_filename).
          setImmediate(() => processing.handleFileMessage(db, msg, watchFolder, notifyMainWindow, _ctx.logger));
          if (msg.type === 'log') {
            if      (msg.level === 'err')  _log('err',  `[watch] Python: ${msg.text}`);
            else if (msg.level === 'warn') _log('warn', `[watch] Python: ${msg.text}`);
          }
          // Tag the SHARED 'process-progress' as watch-sourced so the main
          // window's manual-batch handler (handleProgress, which persists after a
          // run) can ignore it — otherwise it double-counts watch docs and resets
          // "Found" to the watcher's per-file total of 1.
          notifyMainWindow('process-progress', { ...msg, source: 'watch' });
          // Dedicated channel for the main-window log strip + Session Stats —
          // isolated from the manual 'process-progress' listener churn.
          notifyMainWindow('watch-progress', msg);
        } catch {
          notifyMainWindow('process-progress', { type: 'log', text: trimmed, source: 'watch' });
          notifyMainWindow('watch-progress', { type: 'log', text: trimmed });
        }
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (text) _log('warn', `[watch] Python stderr: ${text}`);
    });

    proc.on('close', (code) => {
      _liveProcs.delete(proc);
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      processing.cleanupTempFiles(tempFiles);
      _log('log', `[watch] finished: ${filename} (exit=${code})`);
      resolve();
    });
  });
}

// ── IPC ───────────────────────────────────────────────────────────────────────
function register(ctx) {
  _ctx = ctx;
  const { ipcMain, getDb } = ctx;
  const { dialog, BrowserWindow } = require('electron');
  const learning = require('../../../database/modules/learning');
  const { requireRole } = require('../auth/handler');

  // The watch-folder is configured exclusively from the Admin-only Settings
  // window — "access all settings" is the line drawn there.
  ipcMain.handle('pick-watch-folder', async (e) => {
    requireRole('admin');
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select folder to watch for new scans',
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('get-watch-folder-config', () => {
    requireRole('admin');
    const db = getDb();
    return {
      folder:  learning.getSetting(db, 'watch_folder', null),
      enabled: learning.getSetting(db, 'watch_folder_enabled', '0') === '1',
    };
  });

  ipcMain.handle('set-watch-folder', (_e, folderPath) => {
    requireRole('admin');
    const db = getDb();
    learning.setSetting(db, 'watch_folder', folderPath || '');
    _log('log', `[watch] folder set: ${folderPath || '(cleared)'}`);
    if (learning.getSetting(db, 'watch_folder_enabled', '0') === '1') _start(db);
    return true;
  });

  ipcMain.handle('set-watch-folder-enabled', (_e, enabled) => {
    requireRole('admin');
    const db = getDb();
    learning.setSetting(db, 'watch_folder_enabled', enabled ? '1' : '0');
    if (enabled) _start(db);
    else _stop();
    return true;
  });

  // Resume monitoring on app start if it was left enabled.
  const db = getDb();
  if (learning.getSetting(db, 'watch_folder_enabled', '0') === '1') _start(db);
}

module.exports = {
  register,
  stopForQuit,   // called from main.js before-quit to clear the poll timer + kill watch python
  // Exported for direct unit testing of the stability/debounce decision —
  // see classifyPoll's own comment for why it's kept pure and side-effect-free.
  classifyPoll,
  SUPPORTED_EXTENSIONS,
  STABILITY_DELAY_MS,
};
