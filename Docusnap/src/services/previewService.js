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
  if (!typeSlug && doc.document_type_id) {
    const t = db.prepare('SELECT slug FROM document_types WHERE id = ?').get(doc.document_type_id);
    typeSlug = t ? t.slug : null;
  }
  doc.type_slug = typeSlug;

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
function _resolveDocFile(db, { docId, folderPath, filename }, deps) {
  const { fs, path } = deps;
  const log = deps.log || console.log;

  const sourcePath = path.join(folderPath, filename);

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

function getDocumentPages(db, { docId, folderPath, filename }, deps) {
  const { fs, path, spawn, pythonExe, pythonArgs, renderScript } = deps;
  const log = deps.log || console.log;

  if (!folderPath || !filename) {
    log(`[pages] docId=${docId} missing path — folderPath=${folderPath} filename=${filename}`);
    return Promise.resolve([]);
  }
  const filePath = _resolveDocFile(db, { docId, folderPath, filename }, deps);
  if (!filePath) return Promise.resolve([]);

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') {
    const data = fs.readFileSync(filePath);
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return Promise.resolve([`data:${mime};base64,${data.toString('base64')}`]);
  }

  const py = pythonExe();
  return new Promise((resolve) => {
    const proc = spawn(py, pythonArgs(renderScript, '--file', filePath), { windowsHide: true });
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

module.exports = { getDocumentDetail, getDocumentPages, getThumbnail };
