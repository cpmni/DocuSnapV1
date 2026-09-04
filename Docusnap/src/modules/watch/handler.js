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
const { foldersOverlap } = require('../path_overlap');

// A watch folder must not overlap the output tree or the drain "Processed" folder,
// or filed copies get re-imported in a loop (flat output pattern) → unbounded
// -DUPLICATE growth (QA audit #8). Returns a friendly message on conflict, else null.
function _watchFolderConflict(learning, db, folder) {
  if (!folder) return null;   // clearing the folder is always fine
  const out = learning.getSetting(db, 'output_folder', null);
  if (out && foldersOverlap(folder, out)) {
    return 'This can’t be your output folder (or a folder inside it) — filed documents would be re-imported in a loop. Please choose a separate folder.';
  }
  const processed = learning.getSetting(db, 'processed_folder', null);
  if (processed && foldersOverlap(folder, processed)) {
    return 'This can’t be your “Processed” folder (or a folder inside it). Please choose a separate folder.';
  }
  return null;
}

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
let _separating   = false;       // a separation pre-pass is in flight — blocks the poll + drain re-entry (2026-09-01)
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

// ── Pure separation→tracked fold (watch separation parity, 2026-09-01) ────────
// Fold a separation result into the stable-file list + the tracked map. PURE (no fs/timer/IPC) so the
// re-import-loop guard is unit-pinnable. For each SPLIT original: drop it from the list + its tracked
// entry, and add each segment to the list AND pre-mark it 'processing' in `tracked` — so once the poll
// resumes it classifies the segment (now sitting in the watch folder) as in-flight, never a fresh
// arrival to re-queue (the re-import loop this guards). A CONSUMED original (only separator sheets) is
// just dropped. Returns the expanded list to process. `now` stamps the pre-marked records.
function applySeparationToTracked(files, tracked, rewrites, consumed, now) {
  const bySeg = new Map();
  for (const r of (rewrites || [])) bySeg.set(r.original, r.segments || []);
  const consumedSet = new Set(consumed || []);
  const out = [];
  for (const f of files) {
    if (consumedSet.has(f)) { tracked.delete(f); continue; }
    const segs = bySeg.get(f);
    if (segs && segs.length) {
      tracked.delete(f);
      for (const s of segs) {
        tracked.set(s, { size: 0, mtimeMs: 0, lastChangeAt: now, state: 'processing' });
        out.push(s);
      }
    } else {
      out.push(f);
    }
  }
  return out;
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
        // SECURITY (Stage 2 — M11): absolute path — a bare 'taskkill' resolves from the (user-writable)
        // app dir first, so a planted taskkill.exe would run in-app.
        require('path').join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/F', '/T', '/PID', String(proc.pid)],
        { windowsHide: true, stdio: 'ignore' });
    } catch {}
    try { proc.kill(); } catch {}
  }
  _liveProcs.clear();
}

// ── Poll: detect new/changed files, advance stability timers ─────────────────
function _poll(db) {
  if (!_watchFolder) return;
  if (_separating) return;   // a separation pre-pass is rewriting the folder — don't detect mid-split

  let entries;
  try {
    entries = fs.readdirSync(_watchFolder, { withFileTypes: true });
  } catch (e) {
    _log('warn', `[watch] could not read folder: ${_watchFolder} — ${e.message}`);
    return;
  }

  const now  = Date.now();
  const seen = new Set();
  let newlyStable = 0;

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
        // The "grabbed" moment, shown on the main window's strip (owner ask 2026-09-04) — before any
        // separation or file_begin, so the operator sees the pickup, not a silent gap.
        try { _ctx?.notifyMainWindow?.('watch-progress', { type: 'log', text: `Picked up “${entry.name}” — accepted for processing`, phase: true }); } catch {}
        _queue.push(entry.name);
        newlyStable++;
        break;
      // 'wait', 'in-flight', 'unchanged-done': nothing to do, no log spam
    }
  }

  // Drain ONCE per poll pass, AFTER the loop — not per file. Draining inside the loop made the
  // FIRST stable file grab a solo 1-file batch (_inFlight>0 then blocks the rest until it
  // finishes), so a set that stabilises together never sharded across the workers at once — it
  // looked single-threaded even on a multi-core box. Batching a pass's stable files into one
  // drain lets partitionRoundRobin fan the whole set over `processing_concurrency` immediately.
  if (newlyStable > 0) _drainQueue(db).catch(e => _log("err", `[watch] drain error: ${e && e.message}`));

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
  _drainQueue(db).catch(e => _log('err', `[watch] drain error: ${e && e.message}`));
}

// ── Batched parallel processing — mirrors the manual folder-import worker pool ──
// The whole current queue is drained as ONE batch, sharded round-robin across up to
// `processing_concurrency` Python workers — each worker handling MANY files in a single
// interpreter start. ALL DB writes still funnel through processing.handleFileMessage on the
// single-threaded JS event loop (better-sqlite3 is synchronous), so parallelism only speeds
// the CPU-bound OCR/extraction — never DB/learning state. (Replaced the old one-Python-
// process-per-file model, which paid the ~1-2s interpreter/OCR cold-start on EVERY file and
// made the watch far slower than a manual import.)
//
// KNOWN LIMITATION (release audit BLOCKER-2a, documented not fixed): the watch does NOT run
// the multi-document SEPARATION pre-pass that a manual import does — a PDF that bundles several
// documents is imported as ONE. Bringing separation here safely needs a drain rework (splitting
// happens on the staged temp copy, so the split parts don't exist back in the watch folder,
// which would strand the original and re-import it) — deferred. For now: drop MULTI-document
// PDFs into a MANUAL import (which splits them); single-document scans are the watch's use case.
async function _drainQueue(db) {
  if (!_watchFolder || _queue.length === 0) return;

  const processing = require('../processing/handler');
  if (processing.isBatchRunning()) {
    // A manual folder import is running — don't compete for the same OCR/Python
    // resources. Retry on the next poll tick (or when a worker frees up).
    return;
  }
  const learning = require('../../../database/modules/learning');
  // PARITY WITH MANUAL IMPORT (release audit BLOCKER-2):
  // (1) License enforcement — the watch is the highest-value write path; a revoked/expired
  //     seat must not keep auto-importing + auto-filing. Defer (retry next poll) when denied.
  try {
    if (require('../licensing/handler').licenseDenied(db)) {
      _log('warn', '[watch] paused — a valid license is required to process documents.');
      return;
    }
  } catch { /* licensing module unavailable in a stripped build → proceed */ }
  // (2) POLL-TIME overlap check — the set-time check can be bypassed if output/Processed is
  //     later reconfigured to overlap the watch folder, causing a filed-copy re-import loop.
  try {
    if (_watchFolderConflict(learning, db, _watchFolder)) {
      _log('warn', '[watch] paused — the watch folder now overlaps the output/Processed folder.');
      return;
    }
  } catch { /* be permissive on a check error */ }
  // Process ONE batch of the whole current queue at a time. This is the key speed fix:
  // the old model spawned a fresh Python process PER FILE, so every file paid the ~1-2s
  // interpreter/OCR cold-start (numpy/pytesseract/model load) — dwarfing the actual work
  // and making the watch far slower than a manual import (which runs one process over the
  // whole batch). Now we drain the queue and shard it across up to `processing_concurrency`
  // workers, each Python process handling MANY files → the cold-start is paid once per
  // worker, not once per file. A batch already in flight (_inFlight>0) defers to the next
  // tick (files that land meanwhile just queue for the following batch).
  if (_inFlight > 0 || _separating) return;

  let concurrency = parseInt(learning.getSetting(db, 'processing_concurrency', String(processing.defaultConcurrency())), 10);
  if (!Number.isFinite(concurrency)) concurrency = 1;
  // core-aware AND RAM-capped — matches manual import (the 08-31 OOM fix). Without the RAM cap an
  // overnight watch on a low-spec box oversubscribed memory exactly as the manual path used to.
  concurrency = Math.max(1, Math.min(processing.maxConcurrency(), processing.ramConcurrencyCap(), concurrency));

  let files = _queue.splice(0, _queue.length);   // take the whole current queue

  // ── Separation parity (DARK watch_separate_enabled, 2026-09-01) ──────────────────────────────
  // Split multi-document PDFs IN THE WATCH FOLDER over the EXPLICIT stable set, before sharding — the
  // same pre-pass manual import runs. `_separating` blocks the poll (and drain re-entry) for the whole
  // span, so a segment written mid-pass can never be re-detected between the split and the pre-mark.
  // Segments land in the watch folder (working-copy + drain resolve); the split original moves to
  // .sf_separated_originals/ (a subfolder the non-recursive poll ignores). Fresh segments are HELD for
  // review on this unattended path (a wrong-but-clean boundary must not auto-file with nobody watching).
  let heldNames = null;
  if (files.length && learning.getSetting(db, 'watch_separate_enabled', 'false') === 'true') {
    _separating = true;
    try {
      // Mirror the pre-pass's "checking / splitting" phase lines to the main window's strip (owner ask
      // 2026-09-04): _log reaches processing.log only, and no file_begin has fired yet, so without this the
      // strip sits idle for the whole separation. meta = { phase, quiet } from _separateBatchDocuments.
      const _sepLog = (level, text, meta) => {
        _log(level, text);
        try { _ctx?.notifyMainWindow?.('watch-progress', { type: 'log', text, level: level === 'log' ? '' : level, ...(meta || {}) }); } catch {}
      };
      const sep = await processing.separateFiles(db, _watchFolder, files, _sepLog);
      if (sep && ((sep.rewrites && sep.rewrites.length) || (sep.consumed && sep.consumed.length))) {
        files = applySeparationToTracked(files, _tracked, sep.rewrites, sep.consumed, Date.now());
        heldNames = new Set();
        for (const r of (sep.rewrites || [])) for (const s of (r.segments || [])) heldNames.add(s);
        if (sep.separated) _log('log', `[watch] separated ${sep.separated} multi-document PDF(s) — ${files.length} document(s) to process`);
      }
    } catch (e) { _log('err', `[watch] separation failed (processing whole files): ${e && e.message}`); }
    finally { _separating = false; }
  }
  if (!files.length) return;   // everything was consumed (only separator sheets)

  const shards = processing.partitionRoundRobin(files, Math.min(concurrency, files.length));
  _inFlight = shards.length;
  try { processing.beginWatchActivity(files.length); } catch {}   // Review "importing" bar (reprocess paused)
  for (const shard of shards) {
    _processBatch(db, shard, heldNames)
      .catch(e => _log('err', `[watch] batch processing error — ${e.message}`))
      .finally(() => {
        for (const f of shard) { const rec = _tracked.get(f); if (rec) rec.state = 'done'; }
        _inFlight--;
        if (_inFlight === 0) {
          try { processing.endWatchActivity(); } catch {}   // watch idle — clear the Review bar
          _drainQueue(db).catch(e => _log("err", `[watch] drain error: ${e && e.message}`));   // whole batch done — pick up anything that arrived
        }
      });
  }
}

async function _processBatch(db, filenames, heldNames = null) {
  const { spawn, pythonExe, pythonArgs, tesseractPath, backendScript,
          configPath, notifyMainWindow } = _ctx;
  const processing = require('../processing/handler');
  const learning   = require('../../../database/modules/learning');

  // Capture the folder now: _stop() (e.g. an admin re-points the watch folder) may null
  // the module var while files are still in flight, and the captured path must stay valid
  // for handleFileMessage's persistent folder_path.
  const watchFolder = _watchFolder;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docusnap-watch-'));
  // Stage every still-present file into ONE temp folder so process_docs.py handles the whole
  // shard in a SINGLE interpreter start — the cold-start is paid once per shard, not per
  // file. A file removed/renamed between queueing and now is simply skipped.
  let staged = 0;
  for (const filename of filenames) {
    const srcPath = path.join(watchFolder, filename);
    if (!fs.existsSync(srcPath)) {
      _log('log', `[watch] skipped — file no longer present: ${filename}`);
      _tracked.delete(filename);
      continue;
    }
    try { fs.copyFileSync(srcPath, path.join(tmpDir, filename)); staged++; }
    catch (e) { _log('warn', `[watch] could not stage file — skipping: ${filename} — ${e.message}`); }
  }
  if (staged === 0) { try { fs.rmSync(tmpDir, { recursive: true }); } catch {} return; }

  let trainingArgs, tempFiles;
  try {
    ({ args: trainingArgs, tempFiles } = processing.buildTrainingArgs(db, configPath));
  } catch (e) {
    _log('err', `[watch] setup error: ${e.message}`);
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    return;
  }

  // Coerce a stale/legacy processing_mode (e.g. an old "light") to a value process_docs.py
  // accepts — otherwise --mode arg-parse fails and the watch import silently does nothing.
  const _rawMode = learning.getSetting(db, 'processing_mode', 'smart');
  const procMode = (_rawMode === 'fast' || _rawMode === 'smart') ? _rawMode : 'smart';
  _log('log', `[watch] processing ${staged} file(s) (mode=${procMode})`);

  await new Promise((resolve) => {
    const py = pythonExe();
    // Worker command from the SHARED buildWorkerCommand (watch/import unification, 2026-09-02) so a doc
    // reads IDENTICALLY whether it arrived via the watch folder or a manual import — the whole point of the
    // arc. Byte-identical to the prior inline construction (proven by stress_test/import_watch_parity.js
    // Layer A: given equal inputs the two arrivals' commands differ only in --folder). The env still rides
    // the same four opt-in blocks (AUTO_TITLE, the SAME OCR DPI as import, crop right-grow, reconcile).
    //   arrival:'watch' fences off deskew — the builder NEVER emits --deskew-pages on the unattended,
    //     auto-filing watch path, at any deskew_on_import value (Oracle §4 BLOCKING seam).
    //   filesFile null — watch runs ONE worker over the staged temp dir (no shard enumeration).
    //   wantTrace false — no dev trace/slice stream on the headless path.
    //   threadCap stays watch's OWN _reprocessThreadCap (>=1 always) — BYTE-IDENTICAL to before. Converging
    //     it onto import's rule (unset/uncapped at concurrency==1) is a SEPARATE owner-gated commit: it
    //     changes live watch reads (Tesseract LSTM thread nondeterminism) and needs a watch-conc==1 realdoc
    //     M=0 arm. Do NOT fold it in here.
    const { scriptArgs, env } = processing.buildWorkerCommand(db, {
      pyFolder: tmpDir, tesseract: tesseractPath(), filesFile: null, mode: procMode,
      threadCap: processing._reprocessThreadCap(db), wantTrace: false, sliceDir: null,
      trainingArgs, arrival: 'watch',
    });
    const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
      { windowsHide: true, env });
    _liveProcs.add(proc);   // track for quit-time kill (untracked on close below)
    // Async spawn-failure resilience (the 08-31 crash class): an EAGAIN/ENOMEM/EMFILE failure fires
    // 'error' asynchronously — with no handler it re-raises as an uncaughtException and the app exits
    // silently. Resolve the batch instead; the staged files stay in the watch folder for the next poll.
    let _spawnFailed = false;
    proc.on('error', (err) => {
      _spawnFailed = true;
      _liveProcs.delete(proc);
      _log('err', `[watch] worker spawn failed — will retry next poll: ${err && err.message}`);
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      try { processing.cleanupTempFiles(tempFiles); } catch {}
      resolve();
    });
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
          // Route through the SAME message handler as a manual folder import — but pointed
          // at the real watch-folder path, not the isolated temp dir, so
          // documents.folder_path keeps resolving to a persistent location (preview,
          // confirm, reprocess, the processed-folder move all join folder_path + filename).
          // A freshly-split segment is HELD for review (autoFileRun=false) — the unattended watch path
          // must not auto-file a wrong-but-clean split boundary to the wrong folder (Oracle owner fork).
          const _autoFileRun = !(heldNames && msg.type === 'file_done' && heldNames.has(msg.original_filename));
          if (msg.type === 'file_done') {
            // Persist SYNCHRONOUSLY so msg.db_id is stamped BEFORE the mirror below — the main window's
            // results row needs the doc id to open THAT document (not the first in the queue) and to flip
            // to "Filed (auto)" when the deferred auto-file lands (markRowFiled matches on data-doc-id).
            // handleFileMessage's sync leg does the DB persist + db_id (better-sqlite3 is sync); it returns
            // a PROMISE for the heavy tail (working copy / drain / auto-file), which we let run. Wrapping
            // the WHOLE call in setImmediate — as this did — mirrored the row BEFORE db_id existed, so
            // every watch-split row opened doc #1 and never showed "Filed". Mirrors the manual import path.
            try {
              const io = processing.handleFileMessage(db, msg, watchFolder, notifyMainWindow, _ctx.logger, _autoFileRun);
              if (io && typeof io.then === 'function') io.catch((e) => _log('err', `[watch] file IO: ${e && e.message}`));
            } catch (e) {
              _log('err', `[watch] handleFileMessage failed: ${msg.original_filename || '?'} — ${e && e.message}`);
            }
          } else {
            setImmediate(() => processing.handleFileMessage(db, msg, watchFolder, notifyMainWindow, _ctx.logger, _autoFileRun));
          }
          if (msg.type === 'log') {
            if      (msg.level === 'err')  _log('err',  `[watch] Python: ${msg.text}`);
            else if (msg.level === 'warn') _log('warn', `[watch] Python: ${msg.text}`);
          }
          // Tag the SHARED 'process-progress' as watch-sourced so the main window's
          // manual-batch handler (handleProgress, which persists after a run) can ignore it.
          notifyMainWindow('process-progress', { ...msg, source: 'watch' });
          // Dedicated channel for the main-window log strip + Session Stats.
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
      if (_spawnFailed) return;   // 'error' already handled cleanup + resolve
      _liveProcs.delete(proc);
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      processing.cleanupTempFiles(tempFiles);
      // The worker has exited → the source PDFs are unlocked, so flush the deferred drain
      // (move the processed originals into Processed/Errors). Let the file_done setImmediate
      // enqueue first.
      setImmediate(() => { try { processing.flushPendingDrains(db, _ctx.logger); } catch {} });
      _log('log', `[watch] finished batch of ${staged} (exit=${code})`);
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
  const { requireRole, logAudit } = require('../auth/handler');   // Stage 5a: audit watch-folder changes

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
    const conflict = _watchFolderConflict(learning, db, folderPath);
    if (conflict) { _log('warn', `[watch] rejected folder (overlap): ${folderPath}`); return { ok: false, error: conflict }; }
    learning.setSetting(db, 'watch_folder', folderPath || '');
    _log('log', `[watch] folder set: ${folderPath || '(cleared)'}`);
    logAudit(db, { action: 'watch_folder_set', action_category: 'settings', target_type: 'setting',
      target_id: 'watch_folder', outcome: 'success', metadata: { cleared: !folderPath } });   // Stage 5a (direct setSetting bypasses set-setting's audit)
    if (learning.getSetting(db, 'watch_folder_enabled', '0') === '1') _start(db);
    return { ok: true };
  });

  ipcMain.handle('set-watch-folder-enabled', (_e, enabled) => {
    requireRole('admin');
    const db = getDb();
    learning.setSetting(db, 'watch_folder_enabled', enabled ? '1' : '0');
    logAudit(db, { action: 'watch_folder_enabled', action_category: 'settings', target_type: 'setting',
      target_id: 'watch_folder_enabled', outcome: 'success', metadata: { enabled: !!enabled } });   // Stage 5a
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
  applySeparationToTracked,   // pure — pins the re-import-loop guard (segments pre-marked 'processing')
  SUPPORTED_EXTENSIONS,
  STABILITY_DELAY_MS,
};
