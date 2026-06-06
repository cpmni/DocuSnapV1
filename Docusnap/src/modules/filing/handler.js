'use strict';

/**
 * modules/filing/handler.js
 * Handles document filing — creates folder structure, renames files,
 * writes metadata XML.
 *
 * Folder structure:  OutputRoot/CompanyName/Year/Month/
 * Filename format:   DocType.DD-MM-YYYY.RefNo.pdf
 * Metadata:          OutputRoot/CompanyName/Year/Month/.metadata/DocType.DD-MM-YYYY.RefNo.xml
 */

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// ── Register IPC (settings only — commitDocument called internally) ───────────
function register(ctx) {
  // Filing module has no direct IPC — it's called by review/handler.js
  // Settings IPC for output folder is in settings/handler.js
}

// ── Main filing function ──────────────────────────────────────────────────────
async function commitDocument({
  db, fs, path,
  outputRoot,
  folderPath,
  originalFilename,
  allValues,
  documentType,
  dtInfo,
}) {
  // ── 1. Determine filename components ────────────────────────────────────────
  const docTypeStr   = sanitiseFilePart(documentType || 'Document', 30);
  const refField     = dtInfo?.ref_field_key  || 'invoice_number';
  const dateField    = dtInfo?.date_field_key || 'invoice_date';
  const refValue     = allValues[refField]    || allValues['reference_number'] || 'NOREF';
  const dateValue    = allValues[dateField]   || allValues['invoice_date']     || null;
  const supplierName = allValues['supplier_name'] || 'Unknown Company';

  const dateObj    = parseDate(dateValue);
  const dateStr    = dateObj ? formatDate(dateObj) : 'NODATE';
  const refStr     = sanitiseFilePart(refValue, 40);
  const ext        = path.extname(originalFilename).toLowerCase();

  const baseFilename = `${docTypeStr}.${dateStr}.${refStr}${ext}`;

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
  let finalFilename = baseFilename;
  if (fs.existsSync(path.join(targetDir, baseFilename))) {
    const stem = path.basename(baseFilename, ext);
    finalFilename = `${stem}-DUPLICATE${ext}`;
    // If duplicate of duplicate, append number
    let n = 2;
    while (fs.existsSync(path.join(targetDir, finalFilename))) {
      finalFilename = `${stem}-DUPLICATE-${n}${ext}`;
      n++;
    }
  }

  const targetPath = path.join(targetDir, finalFilename);
  const srcPath    = path.join(folderPath, originalFilename);

  // ── 5. Copy document, then delete original ───────────────────────────────────
  if (!fs.existsSync(srcPath)) {
    return { success: false, error: `Source file not found: ${srcPath}` };
  }

  fs.copyFileSync(srcPath, targetPath);

  // Retry delete with escalating delays
  const delays = [200, 500, 1000, 1500, 2000, 3000];
  let deleted = false;
  for (const delay of delays) {
    await new Promise(r => setTimeout(r, delay));
    try { fs.unlinkSync(srcPath); deleted = true; break; }
    catch (e) { if (e.code !== 'EBUSY' && e.code !== 'EPERM') break; }
  }
  if (!deleted) {
    // Rename fallback
    try {
      const trash = srcPath + '.deleting';
      fs.renameSync(srcPath, trash);
      _scheduleDelete(fs, trash, 10);
    } catch {}
  }

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
  };
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
function sanitiseFilePart(text, maxLen = 40) {
  return String(text || 'UNKNOWN')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .trim()
    .slice(0, maxLen) || 'UNKNOWN';
}

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

module.exports = { register, commitDocument };
