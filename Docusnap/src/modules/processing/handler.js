'use strict';

/**
 * modules/processing/handler.js
 * Handles folder import, single-file reprocess, OCR region, logo ops.
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let _currentBatchProc = null;  // reference to the running Python process

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
    if (_currentBatchProc) {
      try { _currentBatchProc.kill(); } catch {}
      _currentBatchProc = null;
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
    logger?.log(`Batch start: folder="${folderPath}" mode=${procMode}`);

    return new Promise((resolve) => {
      const py  = pythonExe();

      const scriptArgs = [
        '--folder',      folderPath,
        '--tesseract',   tesseractPath(),
        '--mode',        procMode,
        ...trainingArgs,
      ];

      const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
        { windowsHide: true });
      _currentBatchProc = proc;
      let buf = '', fileCount = 0;

      proc.stdout.on('data', (data) => {
        buf += data.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
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
        const text = d.toString().trim();
        if (text) logger?.warn(`Python stderr: ${text}`);
        event.sender.send('process-progress', { type: 'log', text });
      });

      proc.on('close', (code) => {
        _currentBatchProc = null;
        cleanupFiles(tempFiles);
        // Remove any *_ocr.txt plaintext artifacts left by earlier versions of
        // the pipeline that wrote raw OCR text to the source folder as an audit
        // file. The current pipeline no longer creates these; this sweep cleans
        // up residual files from prior runs so none linger in user-visible paths.
        try {
          for (const entry of fs.readdirSync(folderPath)) {
            if (entry.endsWith('_ocr.txt')) {
              try { fs.unlinkSync(path.join(folderPath, entry)); } catch {}
            }
          }
        } catch {}
        logger?.log(`Batch complete: ${fileCount} files, exit=${code}`);
        resolve({ success: code === 0 });
      });
    });
  });

  // ── Reprocess single document ───────────────────────────────────────────────
  ipcMain.handle('reprocess-document', async (event, { docId, folderPath, filename }) => {
    requireRole('admin', 'edit');
    const db      = getDb();
    const srcFile = path.join(folderPath, filename);
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
    const learning2 = require('../../../database/modules/learning');
    const reprMode  = learning2.getSetting(db, 'processing_mode', 'smart');

    const scriptArgs = [
      '--folder',     tmpDir,
      '--tesseract',  tesseractPath(),
      '--mode',       reprMode,
      ...trainingArgs,
    ];

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
        cleanupFiles(tempFiles);

        if (!result?.success || !result?.extractions) {
          logger?.err(`Reprocess failed: ${filename} — no data returned`);
          return resolve({ success: false, error: 'No data returned' });
        }

        // Merge: keep existing if it had higher confidence
        const existingMap = {};
        for (const e of existing) existingMap[e.field_key] = e;

        const newRows = Object.entries(result.extractions).map(([key, data]) => ({
          field_key:     key,
          raw_value:     data.value != null ? String(data.value) : null,
          display_value: data.value != null ? String(data.value) : null,
          confidence:    data.confidence ?? null,
          extraction_method: data.method || null,
        }));

        const mergedRows = newRows.map(row => {
          const ex = existingMap[row.field_key];
          if (!ex) return row;
          // Only preserve old value if reprocessing found nothing new
          if (ex.display_value && !row.display_value) return {
            ...row, raw_value: ex.raw_value,
            display_value: ex.display_value, confidence: ex.confidence,
          };
          return row;
        });

        const learning = require('../../../database/modules/learning');
        learning.deleteExtractions(db, docId);
        learning.insertExtractions(db, docId, mergedRows);
        db.prepare(
          `UPDATE documents SET overall_confidence = ?, status = 'needs_review' WHERE id = ?`
        ).run(result.overall_confidence || null, docId);

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
                  overall_confidence: result.overall_confidence });
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
  ipcMain.handle('split-pdf', async (_e, filePath, ranges, outDir) => {
    requireRole('admin', 'edit');
    if (!filePath || !ranges) return { success: false, error: 'filePath and ranges are required' };

    const splitterScript = path.join(
      path.dirname(backendScript), 'pdf_splitter.py'
    );
    const args = [
      ...pythonArgs,
      splitterScript,
      '--file',   filePath,
      '--ranges', ranges,
    ];
    if (outDir) { args.push('--outdir', outDir); }

    return new Promise((resolve) => {
      let stdout = '';
      const proc = spawn(pythonExe, args);
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('close', () => {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ success: false, error: 'pdf_splitter returned non-JSON output', raw: stdout.trim() });
        }
      });
      proc.on('error', (err) => resolve({ success: false, error: err.message }));
    });
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
  });

  const docId = docResult.lastInsertRowid;

  if (msg.extractions) {
    const rows = Object.entries(msg.extractions).map(([key, data]) => ({
      field_key:         key,
      raw_value:         data.value != null ? String(data.value) : null,
      display_value:     data.value != null ? String(data.value) : null,
      confidence:        data.confidence ?? null,
      extraction_method: data.method || null,
    }));
    learning.insertExtractions(db, docId, rows);
  }

  msg.db_id = docId;

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
  isBatchRunning: () => !!_currentBatchProc,
};
