'use strict';
/**
 * src/lib/fileKinds.js — the ONE shared file-extension policy (QuickFile+Departments plan, eric B.1;
 * Oracle Q-C10/Q-C11). Four doors used to keep their own ext lists; this is the single source:
 *   - OCR_EXTS       — what the OCR pipeline ingests (batch + watch). Byte-equal to the prior two JS
 *                      copies (processing/handler.js BATCH_SUPPORTED_EXTS, watch/handler.js
 *                      SUPPORTED_EXTENSIONS) so collapsing them is zero behaviour change. Python keeps
 *                      its own copy (tesseract.py), pinned equal by test_file_kinds.js.
 *   - INTAKE_EXTS    — what Quick File (non-OCR direct intake) accepts: office docs, email, text, images.
 *   - OPEN_EXTS      — what open-document-file / show-in-explorer may resolve (becomes ALLOWED_OPEN_EXTS):
 *                      OCR ∪ INTAKE ∪ {.xml sidecar}.
 *   - NEVER_OPEN     — executables / script hosts / shortcuts / macro-enabled Office / archives / active
 *                      web content. Defence-in-depth: the ALLOWLIST (OPEN_EXTS) decides; this list is a
 *                      second refusal so a future edit that widens an allowlist can't accidentally admit
 *                      an executable. Invariant OPEN_EXTS ∩ NEVER_OPEN = ∅ (pinned).
 *
 * Pure module (no electron/db) so every door + the pin can require it. `path.extname` on a Windows
 * path handles a double extension ("invoice.pdf.exe" → ".exe"); junction/symlink containment is the
 * caller's job (_realCanonical). All comparisons are lower-cased with a guaranteed leading dot.
 */

function normExt(nameOrExt) {
  let e = String(nameOrExt || '').toLowerCase().trim();
  const dot = e.lastIndexOf('.');
  if (dot >= 0) e = e.slice(dot);            // accept a full filename or a bare/leading-dot ext
  if (e && e[0] !== '.') e = '.' + e;
  return e;
}
const setOf = (arr) => new Set(arr.map(normExt));

// OCR pipeline inputs — MUST stay byte-equal to the prior JS copies (order-independent Set).
const OCR_EXTS = setOf(['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp']);

// Quick File (direct, non-OCR) inputs. Legacy Office binaries (.doc/.xls/.ppt) are accepted (Oracle
// Q3: they hand to the OS like Explorer; VBA never executes from the app; a MOTW check is pinned).
const INTAKE_EXTS = setOf([
  '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.odt', '.ods', '.rtf',
  '.txt', '.md', '.csv', '.eml', '.msg', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif',
]);

// Never openable/executable from within the app (defence-in-depth behind the allowlist).
const NEVER_OPEN = setOf([
  '.exe', '.bat', '.cmd', '.com', '.js', '.jse', '.vbs', '.vbe', '.ps1', '.psm1', '.lnk', '.scr',
  '.msi', '.msp', '.hta', '.wsf', '.wsh', '.reg', '.url', '.pif', '.cpl', '.jar', '.dll', '.inf',
  '.iso', '.img', '.htm', '.html', '.svg', '.docm', '.xlsm', '.pptm',
]);

// What open-document-file / show-in-explorer may resolve. OCR ∪ INTAKE ∪ the sidecar, minus anything
// on the never-open list (belt AND braces — the sets are already disjoint, pinned).
const OPEN_EXTS = new Set([...OCR_EXTS, ...INTAKE_EXTS, '.xml'].filter((e) => !NEVER_OPEN.has(e)));

// Rendered inline (PDF pages / image thumbs). Office/text/email are NOT renderable → list icon, no
// broken-image data-URL (previewService seam, F12/Q-C6).
const RENDERABLE_EXTS = setOf(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif']);

const isOcr = (x) => OCR_EXTS.has(normExt(x));
const isIntake = (x) => INTAKE_EXTS.has(normExt(x));
const isNeverOpen = (x) => NEVER_OPEN.has(normExt(x));
const isOpenable = (x) => { const e = normExt(x); return OPEN_EXTS.has(e) && !NEVER_OPEN.has(e); };
const isRenderable = (x) => RENDERABLE_EXTS.has(normExt(x));

module.exports = {
  normExt, OCR_EXTS, INTAKE_EXTS, OPEN_EXTS, NEVER_OPEN, RENDERABLE_EXTS,
  isOcr, isIntake, isNeverOpen, isOpenable, isRenderable,
};
