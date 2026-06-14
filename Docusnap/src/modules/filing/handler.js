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
  DEFAULT_PATTERN, SUPPORTED_TOKENS,
  buildFilename, resolveDuplicateFilename,
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
}

// ── Main filing function ──────────────────────────────────────────────────────
async function commitDocument({
  db, fs, path,
  outputRoot,
  folderPath,
  originalFilename,
  workingPath,
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
  const supplierName = allValues['supplier_name'] || 'Unknown Company';

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

  // ── 2. Build folder path ─────────────────────────────────────────────────────
  const companyFolder = sanitiseFolderName(supplierName);
  const year          = dateObj ? String(dateObj.getFullYear()) : 'Unknown Year';
  const month         = dateObj ? MONTH_NAMES[dateObj.getMonth()] : 'Unknown Month';

  const targetDir = path.join(outputRoot, companyFolder, year, month);
  const metaDir   = path.join(targetDir, '.metadata');

  // ── 3. Ensure directories exist ──────────────────────────────────────────────
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(metaDir,   { recursive: true });

  // ── 4. Handle duplicates ─────────────────────────────────────────────────────
  const finalFilename = resolveDuplicateFilename(
    baseFilename, ext, (name) => fs.existsSync(path.join(targetDir, name))
  );

  const targetPath = path.join(targetDir, finalFilename);
  const srcPath    = path.join(folderPath, originalFilename);
  // Prefer the app-managed working copy as the stable source for filing, so
  // confirm succeeds even if the user's original source file has been removed.
  // srcPath (the original) is still returned for the caller's deferred cleanup.
  const copyFrom   = (workingPath && fs.existsSync(workingPath)) ? workingPath : srcPath;

  // ── 5. Copy document, then delete original ───────────────────────────────────
  if (!fs.existsSync(copyFrom)) {
    return { success: false, error: `Source file not found: ${copyFrom}` };
  }

  fs.copyFileSync(copyFrom, targetPath);

  // Original removal is deferred by the caller (review/handler.js schedules
  // it via removeSourceFile() below) until the preview UI is done with the
  // file — copying it here and deleting it later avoids the locked-file
  // failures that happen when the source is still open for preview.

  // ── 6. Write metadata XML ─────────────────────────────────────────────────────
  const xmlFilename = path.basename(finalFilename, ext) + '.xml';
  const xmlPath     = path.join(metaDir, xmlFilename);
  const xmlContent  = buildXml({
    allValues, documentType, originalFilename,
    storedAs: finalFilename,
    processedAt: new Date().toISOString(),
  });
  fs.writeFileSync(xmlPath, xmlContent, 'utf-8');

  return {
    success:      true,
    filename:     finalFilename,
    filePath:     targetPath,
    metadataPath: xmlPath,
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
    const tag = key.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('');
    lines.push(`    <${tag}>${esc(val)}</${tag}>`);
  }
  lines.push('  </Fields>');
  lines.push('</DocumentMetadata>');
  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitiseFolderName(name) {
  return String(name || 'Unknown Company')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60) || 'Unknown Company';
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

function _scheduleDelete(fs, filePath, attempts) {
  setTimeout(() => {
    try { fs.unlinkSync(filePath); }
    catch { if (attempts > 0) _scheduleDelete(fs, filePath, attempts-1); }
  }, 2000);
}

module.exports = { register, commitDocument, removeSourceFile };
