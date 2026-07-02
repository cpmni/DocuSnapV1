'use strict';

/**
 * modules/filing/handler.js
 * Handles document filing — creates folder structure, renames files,
 * writes metadata XML.
 *
 * Folder structure: OutputRoot/CompanyName/Year/Month/
 * Filename:         built from the user-configurable pattern in Settings →
 *                   File Naming (see filename_pattern.js); defaults to
 *                   {docType}.{date}.{ref} i.e. DocType.DD-MM-YYYY.RefNo.pdf
 * Metadata:         <filename>.xml alongside it, in .metadata/
 */

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

const {
  DEFAULT_PATTERN, DEFAULT_FOLDER_PATTERN, SUPPORTED_TOKENS, FIELD_TOKENS,
  buildFilename, buildFolderSegments, buildFilenameStem, resolveDuplicateFilename,
} = require('./filename_pattern');

// ── Register IPC ──────────────────────────────────────────────────────────────
// commitDocument itself is called internally by review/handler.js — the only
// direct IPC this module owns is for the File Naming settings tab (pattern
// info + live preview). Settings IPC for output folder is in settings/handler.js
function register(ctx) {
  const { ipcMain } = ctx;
  const { requireRole } = require('../auth/handler');

  // Both live only in the Admin-exclusive Settings → File Naming tab.
  ipcMain.handle('get-filename-pattern-info', () => {
    requireRole('admin');
    return { tokens: SUPPORTED_TOKENS, defaultPattern: DEFAULT_PATTERN };
  });

  ipcMain.handle('preview-filename-pattern', (_e, pattern) => {
    requireRole('admin');
    // Sample supplier name deliberately contains a character Windows forbids
    // in filenames ("/") — so a pattern that includes {supplier} visibly
    // demonstrates, right in the live preview, that illegal characters are
    // stripped automatically by the same backend pass that runs at filing time.
    const sampleValues = {
      docType:      'Invoice',
      date:         '15-12-2025',
      ref:          'INV-2025-0142',
      supplier:     'Smith & Sons / Builders Ltd',
      year:         '2025',
      month:        'December',
      originalName: 'scan0042',
    };
    const result = buildFilename({ pattern, values: sampleValues, ext: '.pdf' });
    return { filename: result.filename, warning: result.fellBack ? result.reason : null };
  });

  // Output Structure: the curated "blocks" the builder UI offers + the defaults.
  ipcMain.handle('get-output-structure-info', () => {
    requireRole('admin');
    return {
      tokens:          FIELD_TOKENS,
      defaultFolder:   DEFAULT_FOLDER_PATTERN,
      defaultFilename: DEFAULT_PATTERN,
    };
  });

  // Live "OutputRoot › subfolders › filename" preview — folder levels and the
  // filename are built with the SAME engine + sanitiser filing uses (the sample
  // company contains a "/" so the automatic clean-up shows live).
  ipcMain.handle('preview-output-path', (_e, { folderPattern, filenamePattern } = {}) => {
    requireRole('admin');
    const sample = { docType: 'Invoice', date: '15-12-2025', ref: 'INV-2025-0142',
      supplier: 'Smith & Sons / Builders Ltd', year: '2025', month: 'December', originalName: 'scan0042' };
    const segments = buildFolderSegments(folderPattern, sample);
    const fn = buildFilename({ pattern: filenamePattern, values: sample, ext: '.pdf' });
    return { segments, filename: fn.filename, warning: fn.fellBack ? fn.reason : null };
  });
}

// ── Main filing function ──────────────────────────────────────────────────────
async function commitDocument({
  db, fs, path,
  outputRoot,
  folderPath,
  originalFilename,
  workingPath,
  existingFiledPath,   // RE-FILE of an already-filed doc: the doc's current stored_path (else null)
  allValues,
  documentType,
  dtInfo,
  logger,
}) {
  // ── 1. Determine filename components ────────────────────────────────────────
  const refField  = dtInfo?.ref_field_key  || 'invoice_number';
  const dateField = dtInfo?.date_field_key || 'invoice_date';

  const rawRef       = allValues[refField]  || allValues['reference_number'] || null;
  const rawDate      = allValues[dateField] || allValues['invoice_date']     || null;
  // #10: a supplier value that is falsy OR sanitises away ("..", "///", "***")
  // must still produce a company folder — not silently drop the level and file the
  // doc directly under Year/Month. Mirror the segment sanitiser (buildFolderSegments
  // runs the same buildFilenameStem per level) and fall back to a neutral name when
  // it comes up empty.
  const supplierStem = buildFilenameStem(String(allValues['supplier_name'] || ''), {});
  const supplierName = supplierStem || 'Unknown Company';

  const dateObj = parseDate(rawDate);
  const ext     = path.extname(originalFilename).toLowerCase();

  // Build the committed filename from the user-configurable pattern (Settings
  // → File Naming). Token values are passed through as-is — buildFilename()
  // sanitises each one individually and collapses any separators an empty
  // token (missing ref/date/supplier on this particular document) would
  // otherwise leave dangling.
  const learning = require('../../../database/modules/learning');
  const pattern  = learning.getSetting(db, 'filename_pattern', DEFAULT_PATTERN);
  const tokenValues = {
    docType:      documentType || 'Document',
    date:         dateObj ? formatDate(dateObj) : '',
    ref:          rawRef || '',
    supplier:     allValues['supplier_name'] || '',
    year:         dateObj ? String(dateObj.getFullYear())   : '',
    month:        dateObj ? MONTH_NAMES[dateObj.getMonth()] : '',
    originalName: path.basename(originalFilename, ext),
  };

  const built = buildFilename({ pattern, values: tokenValues, ext });
  if (built.fellBack) {
    logger?.warn(
      `[filing] filename pattern "${pattern}" — ${built.reason}` +
      ` Falling back to default (${DEFAULT_PATTERN}) for: ${originalFilename}`
    );
  }
  const baseFilename = built.filename;

  // ── 2. Build folder path from the configured folder pattern ──────────────────
  // "/" in the pattern is a subfolder level. Default is {supplier}/{year}/{month}
  // (the long-standing Company/Year/Month layout), so installs that never change
  // it are byte-identical. buildFolderSegments token-substitutes + Windows-safes
  // each level and drops empties. Company/Year/Month keep the old readable
  // placeholders so those levels are never blank.
  const folderPattern = learning.getSetting(db, 'output_folder_pattern', DEFAULT_FOLDER_PATTERN);
  const folderValues = {
    ...tokenValues,
    supplier: supplierName,                                  // 'Unknown Company' fallback
    year:     tokenValues.year  || 'Unknown Year',
    month:    tokenValues.month || 'Unknown Month',
  };
  const segments = buildFolderSegments(folderPattern, folderValues);

  const targetDir = path.join(outputRoot, ...segments);
  // SECURITY (F-08): defence in depth — even after sanitisation, never let the
  // resolved filing directory escape the configured output root.
  const rootResolved   = path.resolve(outputRoot);
  const targetResolved = path.resolve(targetDir);
  if (targetResolved !== rootResolved && !targetResolved.startsWith(rootResolved + path.sep)) {
    return { success: false, error: 'Filing path resolved outside the output folder.' };
  }
  const metaDir   = path.join(targetDir, '.metadata');

  // ── 3. Ensure directories exist ──────────────────────────────────────────────
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(metaDir,   { recursive: true });

  // ── 4. Handle duplicates ─────────────────────────────────────────────────────
  // A RE-FILE (existingFiledPath set) of THIS doc to the SAME name is an in-place
  // update, not a collision — exclude the doc's own current copy so it isn't suffixed
  // "-DUPLICATE". A genuine collision with a DIFFERENT doc's file still suffixes.
  const efpResolved = existingFiledPath ? path.resolve(existingFiledPath) : null;
  const finalFilename = resolveDuplicateFilename(
    baseFilename, ext,
    (name) => { const p = path.join(targetDir, name); return fs.existsSync(p) && path.resolve(p) !== efpResolved; }
  );

  const targetPath = path.join(targetDir, finalFilename);
  const srcPath    = path.join(folderPath, originalFilename);
  // Prefer the app-managed working copy as the stable source for filing, so
  // confirm succeeds even if the user's original source file has been removed.
  // For a RE-FILE of a confirmed doc (working copy long gone), fall back to the
  // doc's EXISTING filed copy. srcPath (the original) is still returned for cleanup.
  const copyFrom   = (workingPath && fs.existsSync(workingPath)) ? workingPath
                   : (existingFiledPath && fs.existsSync(existingFiledPath)) ? existingFiledPath
                   : srcPath;

  // ── 5. Copy document, then delete original ───────────────────────────────────
  if (!fs.existsSync(copyFrom)) {
    return { success: false, error: `Source file not found: ${copyFrom}` };
  }

  // Guard a same-path re-file: copying a file onto itself truncates it. When the
  // existing filed copy IS the target (re-file in place, unchanged name), skip the
  // copy — only the metadata XML below needs rewriting with the updated values.
  if (path.resolve(copyFrom) !== path.resolve(targetPath)) {
    fs.copyFileSync(copyFrom, targetPath);
  }

  // Original removal is deferred by the caller (review/handler.js schedules
  // it via removeSourceFile() below) until the preview UI is done with the
  // file — copying it here and deleting it later avoids the locked-file
  // failures that happen when the source is still open for preview.

  // ── 6. Write metadata XML ─────────────────────────────────────────────────────
  // The XML sidecar is best-effort: the FILED PDF (step 5) is the primary artifact
  // and search reads the DB, not this file. A defect here must NOT throw out of
  // commitDocument — that would roll the doc back to needs_review while LEAVING the
  // copied PDF orphaned in the output tree (and wedge the doc on retry).
  const xmlFilename = path.basename(finalFilename, ext) + '.xml';
  const xmlPath     = path.join(metaDir, xmlFilename);
  let metadataPath = null;
  try {
    const xmlContent = buildXml({
      allValues, documentType, originalFilename,
      storedAs: finalFilename,
      processedAt: new Date().toISOString(),
    });
    fs.writeFileSync(xmlPath, xmlContent, 'utf-8');
    metadataPath = xmlPath;
  } catch (e) {
    if (logger && logger.warn) logger.warn(`metadata XML skipped for ${finalFilename}: ${e.message}`);
  }

  return {
    success:      true,
    filename:     finalFilename,
    filePath:     targetPath,
    metadataPath,
    isDuplicate:  finalFilename.includes('-DUPLICATE'),
    srcPath,      // caller schedules removal once the original is no longer in use
  };
}

// ── Deferred source-file removal ──────────────────────────────────────────────
// Called by review/handler.js once it has determined the preview UI should no
// longer have `srcPath` open (next document loaded, or a short fixed delay at
// the end of the queue). At that point a single unlink is expected to succeed
// — the escalating retry and rename-to-`.deleting` fallback below exist only
// as a final safety net for the rare case that assumption doesn't hold for a
// particular file (e.g. an AV scan or search indexer grabbed it), not as the
// primary mechanism.
async function removeSourceFile(fs, srcPath, logger) {
  if (!fs.existsSync(srcPath)) return true;

  try { fs.unlinkSync(srcPath); return true; }
  catch (e) {
    if (e.code !== 'EBUSY' && e.code !== 'EPERM') {
      logger?.warn(`[filing] could not remove source file: ${srcPath} — ${e.message}`);
      return false;
    }
  }

  // Fallback: still locked at the time we expected it to be free — escalating
  // retry, then park it for later cleanup rather than leaving it in place.
  logger?.warn(`[filing] source file still locked at expected-free time, retrying with backoff: ${srcPath}`);
  const delays = [200, 500, 1000, 1500, 2000, 3000];
  for (const delay of delays) {
    await new Promise(r => setTimeout(r, delay));
    try { fs.unlinkSync(srcPath); return true; }
    catch (e) { if (e.code !== 'EBUSY' && e.code !== 'EPERM') break; }
  }
  try {
    const trash = srcPath + '.deleting';
    fs.renameSync(srcPath, trash);
    _scheduleDelete(fs, trash, 10);
    logger?.warn(`[filing] renamed still-locked source for later cleanup: ${trash}`);
    return true;
  } catch (e) {
    logger?.warn(`[filing] could not remove or rename locked source file: ${srcPath} — ${e.message}`);
    return false;
  }
}

// ── XML builder ───────────────────────────────────────────────────────────────
function buildXml({ allValues, documentType, originalFilename,
                    storedAs, processedAt }) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                                  .replace(/>/g,'&gt;');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DocumentMetadata>',
    `  <ProcessedAt>${esc(processedAt)}</ProcessedAt>`,
    `  <OriginalFilename>${esc(originalFilename)}</OriginalFilename>`,
    `  <StoredAs>${esc(storedAs)}</StoredAs>`,
    `  <DocumentType>${esc(documentType)}</DocumentType>`,
    '  <Fields>',
  ];
  for (const [key, val] of Object.entries(allValues)) {
    if (!val || key.startsWith('_')) continue;
    // filter(Boolean) drops EMPTY segments so a malformed key ("ref__", "amount_",
    // "_") can't make w[0] undefined -> TypeError, which (running AFTER the file
    // copy, with no try/catch) strands the copied file + wedges the doc in review.
    const tag = key.split('_').filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1)).join('');
    if (!tag) continue;
    lines.push(`    <${tag}>${esc(val)}</${tag}>`);
  }
  lines.push('  </Fields>');
  lines.push('</DocumentMetadata>');
  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitiseFolderName(name) {
  const cleaned = String(name || 'Unknown Company')
    .replace(/[\\/:*?"<>|]/g, '')   // strip path separators + Windows-illegal chars
    .replace(/^\.+/, '')            // SECURITY (F-08): strip leading dots so a value like
                                    // ".." / "." cannot anchor a path segment that escapes
                                    // the output root via path.join(root, "..", ...)
    .trim()
    .slice(0, 60)
    .trim();
  // A now-empty or dot-only segment must never become a path component (path.join
  // would resolve it to the parent/current dir). Fall back to a neutral, contained name.
  if (!cleaned || /^\.+$/.test(cleaned)) return 'Unknown Company';
  return cleaned;
}

const DATE_FORMATS = [
  /^(\d{2})\/(\d{2})\/(\d{4})$/,   // DD/MM/YYYY
  /^(\d{4})-(\d{2})-(\d{2})$/,    // YYYY-MM-DD
  /^(\d{2})-(\d{2})-(\d{4})$/,    // DD-MM-YYYY
  /^(\d{2})\.(\d{2})\.(\d{4})$/,  // DD.MM.YYYY
];

const MONTHS = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
};

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  let m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
  // MMM DD YYYY or DD MMM YYYY (text month)
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo !== undefined) return new Date(parseInt(m[3]), mo, parseInt(m[2]));
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo !== undefined) return new Date(parseInt(m[3]), mo, parseInt(m[1]));
  }
  return null;
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// The CANONICAL date normaliser — the ONE place a submitted date string is turned into the
// core's stored/filed format (DD-MM-YYYY). Reused by the filename builder AND the confirm path
// (reviewService) so a desktop or /v1 client never re-implements date parsing: they submit
// whatever the user typed, the core normalises it. Returns null when it can't parse (caller
// keeps the user's value rather than losing it).
function normaliseDate(raw) {
  const d = parseDate(raw);
  return d ? formatDate(d) : null;
}

function _scheduleDelete(fs, filePath, attempts) {
  setTimeout(() => {
    try { fs.unlinkSync(filePath); }
    catch { if (attempts > 0) _scheduleDelete(fs, filePath, attempts-1); }
  }, 2000);
}

module.exports = { register, commitDocument, removeSourceFile, sanitiseFolderName, normaliseDate };
