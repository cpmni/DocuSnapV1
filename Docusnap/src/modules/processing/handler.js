'use strict';

/**
 * modules/processing/handler.js
 * Handles folder import, single-file reprocess, OCR region, logo ops.
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let _currentBatchProcs = [];     // all running Python worker processes for the active batch (bounded pool)
let _cancelRequested   = false;  // set true when stop is requested; suppresses buffered stdout

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
function writeTempJson(name, data) {
  const file = path.join(os.tmpdir(), `ds_${name}_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch {}
  }
}

function buildTrainingArgs(db, configPath) {
  const docTypes  = require('../../../database/modules/document_types');
  const learning  = require('../../../database/modules/learning');
  const templates = require('../../../database/modules/templates');

  const allDocTypes  = docTypes.getAllWithFields(db);
  const allHints     = learning.getHints(db);
  const allAnchors   = learning.getAllAnchors(db);
  const allLogos     = learning.getAllLogos(db);
  const allTemplates = templates.getAll(db);
  let allFormats = [];
  try { allFormats = learning.getFieldFormats(db); } catch {}

  const fieldsFile    = writeTempJson('fields',    allDocTypes.flatMap(dt => dt.fields));
  const hintsFile     = writeTempJson('hints',     allHints);
  const anchorsFile   = writeTempJson('anchors',   allAnchors);
  const logosFile     = writeTempJson('logos',     allLogos);
  const dtFile        = writeTempJson('doctypes',  allDocTypes);
  const formatsFile   = writeTempJson('formats',   allFormats);
  const templatesFile = writeTempJson('templates', allTemplates);
  const cfgFile       = configPath();

  return {
    args: [
      '--fields-file',    fieldsFile,
      '--hints-file',     hintsFile,
      '--anchors-file',   anchorsFile,
      '--logos-file',     logosFile,
      '--doc-types-file', dtFile,
      '--formats-file',   formatsFile,
      '--templates-file', templatesFile,
      '--config-file',    cfgFile,
    ],
    tempFiles: [fieldsFile, hintsFile, anchorsFile, logosFile, dtFile, formatsFile, templatesFile],
  };
}

function register(ctx) {
  const { ipcMain, getDb, pythonExe, pythonArgs, tesseractPath,
          backendScript, configPath, notifyMainWindow, spawn, path, fs,
          logger } = ctx;

  const { requireRole, getCurrentUser } = require('../auth/handler');

  // ── Folder picker ───────────────────────────────────────────────────────────
  const { dialog, shell } = require('electron');

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
  ipcMain.on('show-in-explorer', (_e, filePath) => { if (getCurrentUser()) shell.showItemInFolder(filePath); });
  ipcMain.on('open-file',        (_e, filePath) => { if (getCurrentUser()) shell.openPath(filePath); });

  // ── Stop processing ─────────────────────────────────────────────────────────
  ipcMain.handle('stop-processing', () => {
    requireRole('admin', 'edit');
    if (_currentBatchProcs.length) {
      _cancelRequested = true;
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

  // ── Process folder ──────────────────────────────────────────────────────────
  ipcMain.handle('process-folder', async (event, folderPath) => {
    requireRole('admin', 'edit');
    const db = getDb();
    let trainingArgs, tempFiles;
    try {
      ({ args: trainingArgs, tempFiles } = buildTrainingArgs(db, configPath));
    } catch (e) {
      console.error('[process-folder] buildTrainingArgs failed:', e);
      event.sender.send('process-progress', {
        type: 'log', text: `Setup error: ${e.message}`, level: 'err'
      });
      return { success: false, error: e.message };
    }

    const learning  = require('../../../database/modules/learning');
    const procMode  = learning.getSetting(db, 'processing_mode', 'smart');

    // Bounded cross-document parallelism. Each worker is a separate Python
    // process handling a disjoint slice of the folder; ALL DB writes still flow
    // through _handleFileMessage on the single-threaded JS event loop (better-
    // sqlite3 is synchronous), so concurrency only parallelizes the CPU-bound
    // OCR/extraction, never DB/learning state. Default 1 = unchanged sequential.
    let concurrency = parseInt(learning.getSetting(db, 'processing_concurrency', '1'), 10);
    if (!Number.isFinite(concurrency)) concurrency = 1;
    concurrency = Math.max(1, Math.min(5, concurrency));

    _cancelRequested   = false;
    _currentBatchProcs = [];
    let fileCount   = 0;
    const shardFiles = [];   // per-worker --files-file temp paths to clean up

    // Spawn one Python worker. filesFile=null → it scans the whole folder (the
    // original single-process behaviour). suppressStart hides the worker's own
    // {type:'start'} so a pool can emit ONE aggregate total to the renderer
    // instead of N competing ones (the renderer keys its progress bar off it).
    const runWorker = (filesFile, suppressStart) => new Promise((resolve) => {
      const py = pythonExe();
      const scriptArgs = [
        '--folder',    folderPath,
        '--tesseract', tesseractPath(),
        '--mode',      procMode,
        ...trainingArgs,
      ];
      if (filesFile) scriptArgs.push('--files-file', filesFile);

      const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
        { windowsHide: true });
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
            if (suppressStart && msg.type === 'start') continue;
            setImmediate(() => _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger));
            if (msg.type === 'file_done') fileCount++;
            if (msg.type === 'log') {
              if      (msg.level === 'err')  logger?.err(`Python: ${msg.text}`);
              else if (msg.level === 'warn') logger?.warn(`Python: ${msg.text}`);
              else                           logger?.log(`Python: ${msg.text}`);
            }
            event.sender.send('process-progress', msg);
          } catch {
            event.sender.send('process-progress', { type: 'log', text: trimmed });
          }
        }
      });

      proc.stderr.on('data', d => {
        if (_cancelRequested) return;
        const text = d.toString().trim();
        if (text) logger?.warn(`Python stderr: ${text}`);
        event.sender.send('process-progress', { type: 'log', text });
      });

      proc.on('close', (code) => {
        _currentBatchProcs = _currentBatchProcs.filter(p => p !== proc);
        resolve(code);
      });
    });

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
        // One aggregate start for the whole batch; per-worker starts suppressed.
        event.sender.send('process-progress', { type: 'start', total: allFiles.length });
        workerPromises = shards.map(shard => {
          const f = writeTempJson('files', shard);
          shardFiles.push(f);
          return runWorker(f, true);
        });
      }
    }

    const codes   = await Promise.all(workerPromises);
    const stopped = _cancelRequested;
    _cancelRequested   = false;
    _currentBatchProcs = [];
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
    const success = !stopped && codes.every(c => c === 0);
    logger?.log(`Batch ${stopped ? 'stopped' : 'complete'}: ${fileCount} files, exit=${codes.join(',')}`);
    return { success, stopped };
  });

  // ── Reprocess single document ───────────────────────────────────────────────
  ipcMain.handle('reprocess-document', async (event, { docId, folderPath, filename, enhanceParams }) => {
    requireRole('admin', 'edit');
    const db      = getDb();
    // Prefer the app-managed working copy so reprocess doesn't depend on the
    // user's source folder still holding the file; fall back to the source path.
    const wpRow   = db.prepare('SELECT working_path FROM documents WHERE id = ?').get(docId);
    const srcFile = (wpRow && wpRow.working_path && fs.existsSync(wpRow.working_path))
                  ? wpRow.working_path
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

    const { args: trainingArgs, tempFiles } = buildTrainingArgs(db, configPath);
    const learning2  = require('../../../database/modules/learning');
    const templates2 = require('../../../database/modules/templates');
    const reprMode   = learning2.getSetting(db, 'processing_mode', 'smart');

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
    // Honour the template this doc is already linked to as a Stage 0 fallback,
    // so its admin-drawn field mappings still apply on reprocess even when live
    // re-identification is borderline (see engine.extract known_template_id).
    if (templateId) {
      scriptArgs.push('--known-template-id', String(templateId));
    }
    const allTempFiles = [...tempFiles];
    if (effectiveEnhanceParams) {
      const enhanceFile = writeTempJson('enhance', effectiveEnhanceParams);
      allTempFiles.push(enhanceFile);
      scriptArgs.push('--enhance-file', enhanceFile);
    }

    return new Promise((resolve) => {
      const py   = pythonExe();
      const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
        { windowsHide: true });
      let buf = '', result = null;

      proc.stdout.on('data', (data) => {
        buf += data.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            event.sender.send('reprocess-progress', msg);
            if (msg.type === 'file_done') result = msg;
          } catch {
            event.sender.send('reprocess-progress', { type: 'log', text: trimmed });
          }
        }
      });

      proc.stderr.on('data', d => {
        const text = d.toString().trim();
        if (text) logger?.warn(`Reprocess stderr: ${text}`);
        event.sender.send('reprocess-progress', { type: 'log', text });
      });

      proc.on('close', () => {
        try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
        cleanupFiles(allTempFiles);

        if (!result?.success || !result?.extractions) {
          logger?.err(`Reprocess failed: ${filename} — no data returned`);
          return resolve({ success: false, error: 'No data returned' });
        }

        // Merge: keep existing if it had higher confidence
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

        const mergedRows = newRows.map(row => {
          const ex = existingMap[row.field_key];
          if (!ex) return row;
          // Only preserve old value if reprocessing found nothing new
          if (ex.display_value && !row.display_value) return {
            ...row, raw_value: ex.raw_value,
            display_value: ex.display_value, confidence: ex.confidence,
            validation_note: ex.validation_note || null,
            corrected_to: ex.corrected_to || null,
          };
          return row;
        });

        // Preserve fields the new run didn't return at all (not just null) so that
        // reprocess can't silently drop a field that the first pass extracted correctly.
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

        // Persist the freshly detected document type so Review can auto-select
        // it. Resolve type name → id exactly as the batch insert path
        // (_handleFileMessage) does; the COALESCE below keeps the existing type
        // when re-identification returns nothing, so a borderline reprocess
        // never wipes a known type.
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
             ocr_text            = COALESCE(?, ocr_text)
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
        for (const r of mergedRows) {
          mergedMap[r.field_key] = { value: r.display_value, confidence: r.confidence };
        }

        if (logger) {
          logger.log(`Reprocess done: ${filename}`);
          for (const r of mergedRows) {
            if (r.display_value) {
              logger.log(`  FOUND   ${r.field_key}: ${JSON.stringify(r.display_value)} (${r.confidence}% via ${r.extraction_method || '?'})`);
            } else {
              logger.log(`  MISSED  ${r.field_key}`);
            }
          }
        }

        resolve({ success: true, extractions: mergedMap,
                  overall_confidence: result.overall_confidence,
                  ruleCreated: ruleCreatedFor });
      });
    });
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

  // ── Template-mapping test (shared path with reprocess) ───────────────────────
  // Runs the SAME Stage 0.5 extraction (template_mapper.extract_with_mappings)
  // the real reprocess uses, against the full sample page, for one draft/saved
  // mapping. The Template Editor calls this instead of cropping the absolute
  // drawn target itself, so the test result matches reprocess exactly (same
  // anchor relocation + offset + crop + normalisation). Mirrors the ocr-region
  // spawn pattern above.
  ipcMain.handle('test-template-mapping', async (_e, pageBase64, mapping) => {
    requireRole('admin');
    if (!pageBase64 || !mapping) return {};
    const imgFile = path.join(os.tmpdir(), `ds_tmap_img_${Date.now()}.png`);
    const mapFile = path.join(os.tmpdir(), `ds_tmap_${Date.now()}.json`);
    try {
      fs.writeFileSync(imgFile, Buffer.from(pageBase64, 'base64'));
      fs.writeFileSync(mapFile, JSON.stringify(mapping));
    } catch (e) {
      try { fs.unlinkSync(imgFile); } catch {}
      try { fs.unlinkSync(mapFile); } catch {}
      return { error: e.message };
    }
    const script = ctx.resourcePath('python_backend', 'test_mapping.py');
    return new Promise((resolve) => {
      const proc = spawn(pythonExe(), pythonArgs(script,
        '--image-file', imgFile, '--mapping-file', mapFile, '--tesseract', tesseractPath()),
        { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      proc.on('close', () => {
        try { fs.unlinkSync(imgFile); } catch {}
        try { fs.unlinkSync(mapFile); } catch {}
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
    learning.saveAnchor(getDb(), data);
    return true;
  });

  // ── PDF splitting ───────────────────────────────────────────────────────────
  // Thin wrapper around pdf_splitter.py (pypdf). Splits a single PDF into
  // page-range sub-documents that can then be dropped into the normal process-
  // folder pipeline. outDir is optional (defaults to a safe system-temp path).
  ipcMain.handle('split-pdf', async (_e, filePath, ranges, outDir, docId) => {
    requireRole('admin', 'edit');
    if (!filePath || !ranges) return { success: false, error: 'filePath and ranges are required' };

    const py             = pythonExe();
    const splitterScript = path.join(path.dirname(backendScript()), 'pdf_splitter.py');
    const args           = pythonArgs(splitterScript, '--file', filePath, '--ranges', ranges);
    if (outDir) { args.push('--outdir', outDir); }

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

// ── Internal: save file_done message to DB ────────────────────────────────────
function _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger) {
  if (msg.type === 'file_begin') {
    logger?.log(`File begin: ${msg.filename}`);
    return;
  }
  if (msg.type !== 'file_done') return;

  if (!msg.success) {
    logger?.err(`File failed: ${msg.original_filename || '?'} — ${msg.error || 'unknown error'}`);
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
  // Runs BEFORE the optional processed-folder move so it copies the file in place.
  try {
    const { app }    = require('electron');
    const srcForCopy = path.join(folderPath, msg.original_filename);
    if (fs.existsSync(srcForCopy)) {
      const inbox = path.join(app.getPath('userData'), 'inbox');
      if (!fs.existsSync(inbox)) fs.mkdirSync(inbox, { recursive: true });
      const rawExt = path.extname(msg.original_filename);
      const ext    = /^\.[A-Za-z0-9]+$/.test(rawExt) ? rawExt : '';   // sanitise extension
      const dest   = path.join(inbox, `${docId}${ext}`);
      try {
        fs.copyFileSync(srcForCopy, dest);
        documents.update(db, docId, { working_path: dest });
        msg.working_path = dest;
      } catch (e) {
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}   // no partial orphan
        throw e;
      }
    }
  } catch (e) {
    console.warn(`[import] working copy failed for docId=${docId}: ${e.message}`);
  }

  // Move source file to Processed folder if configured
  const processedFolder = learning.getSetting(db, 'processed_folder', null);
  if (processedFolder) {
    const srcPath = path.join(folderPath, msg.original_filename);
    if (fs.existsSync(srcPath)) {
      try {
        if (!fs.existsSync(processedFolder)) {
          fs.mkdirSync(processedFolder, { recursive: true });
        }
        const ext  = path.extname(msg.original_filename);
        const base = path.basename(msg.original_filename, ext);
        let destPath = path.join(processedFolder, msg.original_filename);
        let counter = 1;
        while (fs.existsSync(destPath)) {
          destPath = path.join(processedFolder, `${base}-${counter}${ext}`);
          counter++;
        }
        try {
          fs.renameSync(srcPath, destPath);
        } catch {
          fs.copyFileSync(srcPath, destPath);
          fs.unlinkSync(srcPath);
        }
        const destFilename = path.basename(destPath);
        db.prepare('UPDATE documents SET folder_path = ? WHERE id = ?')
          .run(processedFolder, docId);
        if (destFilename !== msg.original_filename) {
          db.prepare('UPDATE documents SET original_filename = ? WHERE id = ?')
            .run(destFilename, docId);
        }
        logger?.log(`Moved to processed: ${msg.original_filename}`);
      } catch (e) {
        logger?.warn(`Could not move to processed folder: ${e.message}`);
      }
    }
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

  notifyMainWindow('review-count-changed', documents.getReviewCount(db));
  notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
}

module.exports = {
  register,
  // Exposed so other entry points into the same pipeline (e.g. the
  // watch-folder handler) can reuse this setup/dispatch machinery instead
  // of duplicating it on a parallel import path.
  buildTrainingArgs,
  cleanupTempFiles: cleanupFiles,
  handleFileMessage: _handleFileMessage,
  isBatchRunning: () => _currentBatchProcs.length > 0,
};
