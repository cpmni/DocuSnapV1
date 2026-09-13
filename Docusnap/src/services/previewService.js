'use strict';

/**
 * services/previewService.js
 * --------------------------
 * Transport-agnostic, READ-ONLY document-detail logic, shared by the in-process
 * IPC handler (src/modules/review/handler.js → get-document-with-extractions, used
 * by both the Review and Search windows) and any future detached client API.
 *
 * Owns only the pure data assembly: fetch the document + its extractions, resolve
 * the type slug, and attach the learned digit-only field set. AUTHENTICATION and
 * AUDIT logging stay at the transport edge (the handler), so this stays reusable
 * across IPC and a future LAN API without dragging in the Electron session.
 *
 * Reuses database/modules/{documents,learning} unchanged — no new query logic.
 *
 * Page rendering (getDocumentPages) is also here, but with its Electron-specific
 * collaborators (fs, path, spawn, the Python launcher and the render script path)
 * INJECTED via `deps` so the function itself stays transport-agnostic. The
 * Review-window-only "deferred source-file move" bookkeeping is NOT part of this —
 * that stays in review/handler.js and runs before delegating here.
 */

const documents = require('../../database/modules/documents');
const fileKinds = require('../lib/fileKinds');

/**
 * Fetch a document with its extractions, enriched with the resolved type slug and
 * the supplier/type's learned digit-only field set. Returns the same enriched row
 * the original handler produced, or undefined/null when the id is unknown.
 *
 * @param {object}   db          open better-sqlite3 database handle
 * @param {number}   id          document id
 * @param {object}  [deps]
 * @param {object}  [deps.learning] learning module (injectable for tests); defaults to the real module
 * @returns {object|null|undefined} enriched document row, or falsy when not found
 */
function getDocumentDetail(db, id, deps = {}) {
  const learning = deps.learning || require('../../database/modules/learning');

  const doc = documents.getWithExtractions(db, id);
  if (!doc) return doc;

  // getWithExtractions → getById is SELECT * (no JOIN) so it lacks type_slug.
  // Resolve it from document_type_id so callers can sync a doc-type dropdown to
  // the record (e.g. after a reprocess re-identifies the type).
  let typeSlug = doc.type_slug || null;
  let typeName = doc.type_name || null;
  if ((!typeSlug || !typeName) && doc.document_type_id) {
    const t = db.prepare('SELECT slug, name FROM document_types WHERE id = ?').get(doc.document_type_id);
    if (t) { typeSlug = typeSlug || t.slug; typeName = typeName || t.name; }
  }
  doc.type_slug = typeSlug;
  // Mailbox/workflow callers hand selectDoc a bare {id}; the base fetch (getWithExtractions→getById,
  // SELECT *) has no join to document_types, so type_name was absent and the detail "Type" rendered "—"
  // (Chris r2 vet item A). Resolve it here so it rides the DTO — projectDocumentDetail already
  // allowlists type_name — to every detail consumer: mailbox, workflow, the /v1 client detail, Review.
  doc.type_name = typeName;

  // Fields whose learned format is digits-only, so the UI can warn before
  // confirming a non-digit value on one.
  doc.digit_only_fields = learning.getDigitsOnlyFields(db, doc.supplier_name, typeSlug);

  return doc;
}

/**
 * Render a document's pages to an array of base64 image data-URLs (one per page).
 * Resolves the on-disk file (app working copy → recorded source → recovered copy),
 * returns the image directly for image files, or shells out to render/pages.py for
 * PDFs. Returns [] when nothing renderable can be found.
 *
 * The result is image BYTES (data-URLs), never a filesystem path — so it is safe
 * to return across the detached-client boundary as-is.
 *
 * @param {object} db   open better-sqlite3 handle
 * @param {object} args { docId, folderPath, filename }
 * @param {object} deps { fs, path, spawn, pythonExe, pythonArgs, renderScript, log? }
 * @returns {Promise<string[]>}
 */
/**
 * Resolve the best on-disk path for a document: app working copy → recorded
 * source → any recovered copy of the SAME document. Returns the resolved path,
 * or null when nothing renderable survives. Shared by getDocumentPages and
 * getThumbnail so the two never drift in how they find the file.
 */
function _resolveDocFile(db, { docId, folderPath, filename, exact }, deps) {
  const { fs, path } = deps;
  const log = deps.log || console.log;

  const sourcePath = path.join(folderPath, filename);

  // Exact mode: render THIS precise file (e.g. a stamped decision copy) — no working-copy
  // override and no sibling recovery, since it isn't the document's own source file.
  if (exact) return fs.existsSync(sourcePath) ? sourcePath : null;

  // Prefer the app-managed working copy — the reliable, app-owned location that
  // doesn't depend on the user's source folder. Fall back to the source.
  const wpRow = db.prepare('SELECT working_path FROM documents WHERE id = ?').get(docId);
  let filePath = (wpRow && wpRow.working_path && fs.existsSync(wpRow.working_path))
    ? wpRow.working_path
    : sourcePath;

  if (fs.existsSync(filePath)) return filePath;

  // The recorded source can be gone if the file was moved/renamed since
  // processing. Recover any surviving copy of the SAME document. File-not-found
  // ONLY, so normal previews are untouched.
  const existing = (r) => {
    if (r.stored_path && fs.existsSync(r.stored_path)) return r.stored_path;
    if (r.folder_path && r.original_filename) {
      const p = path.join(r.folder_path, r.original_filename);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };
  // Base name with the import's "-N" duplicate suffix normalised away.
  const baseOf = (fn) => {
    const e = path.extname(fn || '');
    return path.basename(fn || '', e).replace(/-\d+$/, '');
  };
  // 1) this document's own filed copy
  const self = db.prepare('SELECT stored_path FROM documents WHERE id = ?').get(docId);
  let alt = (self && self.stored_path && fs.existsSync(self.stored_path)) ? self.stored_path : null;
  // 2) any other row holding the same source file (same normalised base name)
  if (!alt) {
    const base = baseOf(filename);
    const sibs = db.prepare(
      'SELECT folder_path, original_filename, stored_path FROM documents WHERE id <> ? AND original_filename LIKE ?'
    ).all(docId, base + '%');
    for (const r of sibs) {
      if (baseOf(r.original_filename) !== base) continue;
      const f = existing(r);
      if (f) { alt = f; break; }
    }
  }
  if (!alt) {
    log(`[pages] file not found (no recoverable copy): ${filePath}`);
    return null;
  }
  log(`[pages] source missing for docId=${docId}; using recovered copy: ${alt}`);
  return alt;
}

function getDocumentPages(db, { docId, folderPath, filename, scale, exact }, deps) {
  const { fs, path, spawn, pythonExe, pythonArgs, renderScript } = deps;
  const log = deps.log || console.log;

  if (!folderPath || !filename) {
    log(`[pages] docId=${docId} missing path — folderPath=${folderPath} filename=${filename}`);
    return Promise.resolve([]);
  }
  const filePath = _resolveDocFile(db, { docId, folderPath, filename, exact }, deps);
  if (!filePath) return Promise.resolve([]);

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') {
    // Q-C6: only PDFs + images render inline. A Quick File office/text/email doc is NOT renderable —
    // return no pages so the caller shows a list icon, never a broken-image data-URL (F12). Also caps a
    // huge non-image read (a 50 MB .xlsx must not be base64'd over IPC).
    if (!fileKinds.isRenderable(ext)) return Promise.resolve([]);
    const data = fs.readFileSync(filePath);
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return Promise.resolve([`data:${mime};base64,${data.toString('base64')}`]);
  }

  const py = pythonExe();
  // Optional higher render scale for a CRISP display (e.g. the teach wizard). The OCR
  // crop is downscaled back to the OCR resolution by the caller, so read quality is
  // unaffected — this only sharpens what the operator sees. Default (unset) = 1.5 (108 DPI).
  const renderArgs = ['--file', filePath];
  if (scale && scale > 0) renderArgs.push('--scale', String(scale));
  return new Promise((resolve) => {
    const proc = spawn(py, pythonArgs(renderScript, ...renderArgs), { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', (e) => {
      log(`[pages] spawn error for ${filePath}: ${e.message}`);
      resolve([]);
    });
    proc.on('close', (code) => {
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        log(`[pages] render failed for ${filePath} — exit=${code} stdout_len=${out.length} parse_error=${e.message}`
          + (err ? ` stderr=${err.trim().slice(0, 500)}` : ''));
        resolve([]);
      }
    });
  });
}

/**
 * Render ONE page of a PDF to a base64 data-URL at a given scale — the fast-first-page path so a big
 * multi-page PDF shows page 1 immediately instead of waiting for every page to rasterise (owner,
 * 2026-09-13: an 8 MB PDF took a long time to open). Reuses render/pages.py's single-page mode
 * (--thumb --page --scale). Returns null for a non-PDF or on any failure (caller falls back to the
 * full getDocumentPages render). Same server-side file resolution as getDocumentPages.
 *
 * @param {object} db
 * @param {object} args { docId, folderPath, filename, index, scale }
 * @param {object} deps { fs, path, spawn, pythonExe, pythonArgs, renderScript, log? }
 * @returns {Promise<string|null>}
 */
function getDocumentPage(db, { docId, folderPath, filename, index, scale }, deps) {
  const { fs, path, spawn, pythonExe, pythonArgs, renderScript } = deps;
  const log = deps.log || console.log;
  if (!folderPath || !filename) return Promise.resolve(null);
  const filePath = _resolveDocFile(db, { docId, folderPath, filename }, deps);
  if (!filePath) return Promise.resolve(null);
  if (path.extname(filePath).toLowerCase() !== '.pdf') return Promise.resolve(null);

  const py = pythonExe();
  const args = ['--file', filePath, '--thumb', '--page', String(Math.max(0, index | 0))];
  if (scale && scale > 0) args.push('--scale', String(scale));
  return new Promise((resolve) => {
    const proc = spawn(py, pythonArgs(renderScript, ...args), { windowsHide: true });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', (e) => { log(`[page] spawn error for ${filePath}: ${e.message}`); resolve(null); });
    proc.on('close', (code) => {
      try { const uri = JSON.parse(out); resolve(typeof uri === 'string' ? uri : null); }
      catch (e) {
        log(`[page] render failed for ${filePath} p${index} — exit=${code} parse_error=${e.message}`
          + (err ? ` stderr=${err.trim().slice(0, 300)}` : ''));
        resolve(null);
      }
    });
  });
}

/**
 * Cheap PAGE COUNT for a PDF (render/pages.py --count) — opens the doc and returns its page count with
 * NO rendering. Lets the lazy preview size its page array + show page nav instantly for a doc whose
 * page_count wasn't recorded (e.g. a Quick File doc), instead of rendering every page to learn the count.
 * Returns a positive integer, or null (non-PDF / unresolved / failure — caller falls back).
 * @returns {Promise<number|null>}
 */
function getDocumentPageCount(db, { docId, folderPath, filename }, deps) {
  const { path, spawn, pythonExe, pythonArgs, renderScript } = deps;
  const log = deps.log || console.log;
  if (!folderPath || !filename) return Promise.resolve(null);
  const filePath = _resolveDocFile(db, { docId, folderPath, filename }, deps);
  if (!filePath) return Promise.resolve(null);
  if (path.extname(filePath).toLowerCase() !== '.pdf') return Promise.resolve(null);
  const py = pythonExe();
  return new Promise((resolve) => {
    const proc = spawn(py, pythonArgs(renderScript, '--file', filePath, '--count'), { windowsHide: true });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', (e) => { log(`[count] spawn error for ${filePath}: ${e.message}`); resolve(null); });
    proc.on('close', (code) => {
      try { const n = JSON.parse(out).pages; resolve(Number.isFinite(n) && n > 0 ? n : null); }
      catch (e) {
        log(`[count] failed for ${filePath} — exit=${code} parse_error=${e.message}`
          + (err ? ` stderr=${err.trim().slice(0, 200)}` : ''));
        resolve(null);
      }
    });
  });
}

/**
 * Render a small page-1 thumbnail for a document — a single base64 data-URL, or
 * null when nothing renderable can be resolved (caller keeps its fallback). Used
 * by the document/file lists + the add-template picker. Reuses the SAME file
 * resolution as getDocumentPages; never touches the full-page preview path.
 *
 * @param {object} db   open better-sqlite3 handle
 * @param {object} args { docId, folderPath, filename }
 * @param {object} deps { fs, path, spawn, pythonExe, pythonArgs, renderScript, log? }
 * @returns {Promise<string|null>}
 */
function getThumbnail(db, { docId, folderPath, filename }, deps) {
  const { fs, path, spawn, pythonExe, pythonArgs, renderScript } = deps;
  const log = deps.log || console.log;

  if (!folderPath || !filename) return Promise.resolve(null);
  const filePath = _resolveDocFile(db, { docId, folderPath, filename }, deps);
  if (!filePath) return Promise.resolve(null);

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') {
    // Q-C6: office/text/email Quick File docs are not renderable → null (the list shows an ext icon).
    if (!fileKinds.isRenderable(ext)) return Promise.resolve(null);
    // Image files render in the <img> tag directly; the browser scales the
    // displayed thumb. No new dependency, no downscale step.
    try {
      const data = fs.readFileSync(filePath);
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      return Promise.resolve(`data:${mime};base64,${data.toString('base64')}`);
    } catch (e) {
      log(`[thumb] read failed for ${filePath}: ${e.message}`);
      return Promise.resolve(null);
    }
  }

  const py = pythonExe();
  return new Promise((resolve) => {
    const proc = spawn(py, pythonArgs(renderScript, '--file', filePath, '--thumb'), { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', (e) => {
      log(`[thumb] spawn error for ${filePath}: ${e.message}`);
      resolve(null);
    });
    proc.on('close', (code) => {
      try {
        const uri = JSON.parse(out);
        resolve(typeof uri === 'string' ? uri : null);
      } catch (e) {
        log(`[thumb] render failed for ${filePath} — exit=${code} stdout_len=${out.length} parse_error=${e.message}`
          + (err ? ` stderr=${err.trim().slice(0, 500)}` : ''));
        resolve(null);
      }
    });
  });
}

/**
 * Locate a search term in a document and return where it sits, as page-fraction boxes
 * (0..1, top-left origin) the renderer can overlay at any zoom/scale. Born-digital PDFs
 * only for now (text layer, no OCR); a non-PDF or a scanned PDF with no text layer yields
 * an empty match list. Same server-side file resolution as getDocumentPages.
 *
 * @param {object} db   open better-sqlite3 handle
 * @param {object} args { docId, folderPath, filename, query }
 * @param {object} deps { fs, path, spawn, pythonExe, pythonArgs, findScript, log? }
 * @returns {Promise<{kind:string, pages:number, matches:Array<{page,x0,y0,x1,y1}>}>}
 */
function findInDocument(db, { docId, folderPath, filename, query }, deps) {
  const { fs, path, spawn, pythonExe, pythonArgs, findScript } = deps;
  const log = deps.log || console.log;
  const EMPTY = { kind: 'none', pages: 0, matches: [] };

  const term = String(query || '').trim();
  if (!term || !folderPath || !filename) return Promise.resolve(EMPTY);
  const filePath = _resolveDocFile(db, { docId, folderPath, filename }, deps);
  if (!filePath) return Promise.resolve(EMPTY);

  // PDFs only. A born-digital PDF matches via its text layer; a SCANNED PDF (no text layer) matches via
  // pdf_find.py's OCR word-box fallback (needs the tesseract path). Images / office return nothing to
  // highlight — the doc is still found by the list search.
  if (path.extname(filePath).toLowerCase() !== '.pdf') return Promise.resolve(EMPTY);

  const py = pythonExe();
  const args = ['--file', filePath, '--query', term];
  if (deps.tesseract) args.push('--tesseract', deps.tesseract);   // enables the scanned-page OCR fallback
  return new Promise((resolve) => {
    const proc = spawn(py, pythonArgs(findScript, ...args), { windowsHide: true });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', (e) => { log(`[find] spawn error for ${filePath}: ${e.message}`); resolve(EMPTY); });
    proc.on('close', (code) => {
      try {
        const parsed = JSON.parse(out);
        resolve(parsed && Array.isArray(parsed.matches) ? parsed : EMPTY);
      } catch (e) {
        log(`[find] failed for ${filePath} — exit=${code} stdout_len=${out.length} parse_error=${e.message}`
          + (err ? ` stderr=${err.trim().slice(0, 300)}` : ''));
        resolve(EMPTY);
      }
    });
  });
}

/**
 * Parse an .xlsx document into a capped cell GRID for a lightweight, dependency-free preview
 * (route 1 of the 2026-09-13 spreadsheet-preview decision — no external converter). Returns
 * { sheets:[{name, rows:string[][]}], truncated } or null when the file isn't a readable .xlsx
 * (legacy .xls / .ods are a different container → null; caller keeps its "no preview" fallback).
 * Same SERVER-SIDE file resolution as getDocumentPages. Values only — no number-format/style fidelity.
 *
 * @param {object} db
 * @param {object} args { docId, folderPath, filename }
 * @param {object} deps { fs, path, log? }
 * @returns {{sheets:Array, truncated:boolean}|null}
 */
function getSpreadsheetGrid(db, { docId, folderPath, filename }, deps) {
  const { fs, path } = deps;
  const log = deps.log || console.log;
  if (!folderPath || !filename) return null;
  const filePath = _resolveDocFile(db, { docId, folderPath, filename }, deps);
  if (!filePath) return null;
  if (path.extname(filePath).toLowerCase() !== '.xlsx') return null;   // OOXML spreadsheet only
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (e) { log(`[grid] read failed for ${filePath}: ${e.message}`); return null; }
  try { return require('../lib/ooxmlGrid').extractGrid(buf); }
  catch (e) { log(`[grid] parse failed for ${filePath}: ${e.message}`); return null; }
}

module.exports = { getDocumentDetail, getDocumentPages, getDocumentPage, getDocumentPageCount, getThumbnail, findInDocument, getSpreadsheetGrid, resolveDocFile: _resolveDocFile };
