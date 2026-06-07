'use strict';

/**
 * modules/processing/handler.js
 * Handles folder import, single-file reprocess, OCR region, logo ops.
 */

const os = require('os');

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

  // ── Write temp JSON files ───────────────────────────────────────────────────
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

  function buildTrainingArgs(db) {
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

  // ── Process folder ──────────────────────────────────────────────────────────
  ipcMain.handle('process-folder', async (event, folderPath) => {
    requireRole('admin', 'edit');
    const db = getDb();
    let trainingArgs, tempFiles;
    try {
      ({ args: trainingArgs, tempFiles } = buildTrainingArgs(db));
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
        '--ollama-url',  'http://127.0.0.1:11434/api/generate',
        '--model',       'phi3:mini',
        '--mode',        procMode,
        ...trainingArgs,
      ];

      const proc = spawn(py, pythonArgs(backendScript(), ...scriptArgs),
        { windowsHide: true });
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
            _handleFileMessage(db, msg, folderPath, notifyMainWindow, logger);
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
        cleanupFiles(tempFiles);
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

    const { args: trainingArgs, tempFiles } = buildTrainingArgs(db);
    const learning2 = require('../../../database/modules/learning');
    const reprMode  = learning2.getSetting(db, 'processing_mode', 'smart');

    const scriptArgs = [
      '--folder',     tmpDir,
      '--tesseract',  tesseractPath(),
      '--ollama-url', 'http://127.0.0.1:11434/api/generate',
      '--model',      'phi3:mini',
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

  const docResult = documents.insert(db, {
    original_filename:  msg.original_filename,
    folder_path:        folderPath,
    document_type_id,
    supplier_name:      msg.supplier_name || null,
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
      ` type=${msg.document_type || '?'} supplier=${msg.supplier_name || '?'}` +
      ` conf=${msg.overall_confidence || '?'}%${tmpl}`
    );
    if (exFields) logger.log(`  Fields: ${exFields}`);
  }

  notifyMainWindow('review-count-changed', documents.getReviewCount(db));
  notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
}

module.exports = { register };

// ── Ollama management ─────────────────────────────────────────────────────────
// These are appended at module level but need to be inside register().
// See ollama_handler.js for the actual implementation.
