'use strict';
/*
 * PDF approval/rejection stamp.
 *
 * A stamp is a VISUAL derivative of the recorded workflow decision — the source of truth
 * is the document_routes row (state / resolution_comment / resolved_at). This module never
 * mutates the original PDF: it reads inputPath and writes a stamped COPY to outputPath.
 *
 * Licence: pdf-lib (MIT) — no PyMuPDF/AGPL, no native deps. Runs in the Electron main process.
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_NOTES = 600;

// Default decision presentation — callers may override label/color.
// 'paid' removed for v1 (Workflow Slice 1) — an unknown decision no-ops (stampWorkflowDecision
// returns null), and legacy *.PAID-stamped.pdf copies on disk stay served (deliberate; no cleanup).
const DECISION_STYLE = {
  approve: { label: 'APPROVED', color: '#2E7D32' },   // green
  reject:  { label: 'REJECTED', color: '#C62828' },   // red
};

function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!m) throw new Error(`Invalid hex colour: ${JSON.stringify(hex)}`);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function fmtDate(d) {
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt.getTime())) return fmtDate(new Date());
  return `${String(dt.getDate()).padStart(2, '0')} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// Greedy word-wrap to a pixel width for the chosen font/size.
function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Stamp a single PDF and write a copy. Throws a clear Error on bad input rather than
 * producing corrupt output.
 *
 * options: { label, color(hex), userName, date, notes, page, position, opacity, rotate }
 */
async function stampPdf(inputPath, outputPath, options = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`Input PDF not found: ${inputPath}`);
  if (!outputPath) throw new Error('outputPath is required.');
  const {
    label = 'APPROVED', color = '#2E7D32', userName = '', date,
    notes = '', page = 0, position = 'top-right', opacity = 0.85, rotate = 0,
  } = options;
  if (String(notes).length > MAX_NOTES) throw new Error(`Notes too long (${String(notes).length} > ${MAX_NOTES}).`);
  const col = hexToRgb(color);

  let pdf;
  try { pdf = await PDFDocument.load(fs.readFileSync(inputPath)); }
  catch (e) { throw new Error(`Could not read PDF "${inputPath}": ${e.message}`); }
  const pages = pdf.getPages();
  if (!pages.length) throw new Error('PDF has no pages.');
  const pg = pages[Math.max(0, Math.min(page | 0, pages.length - 1))];

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height } = pg.getSize();

  const M = 28;                                       // margin from the page edge
  const boxW = Math.min(230, Math.max(120, width - 2 * M));
  const labelSize = 22, lineSize = 9, gap = 3;

  const meta = [];
  if (userName) meta.push(`By: ${userName}`);
  meta.push(`Date: ${fmtDate(date)}`);
  const noteLines = String(notes).trim() ? wrapText(`Notes: ${String(notes).trim()}`, reg, lineSize, boxW) : [];
  const subLines = meta.length + noteLines.length;
  const blockH = labelSize + 8 + subLines * (lineSize + gap) + 8;

  // Corner placement (top-right default); x is the left edge, y the headline baseline.
  const x = position.includes('left') ? M : Math.max(M, width - boxW - M);
  const y = position.includes('bottom') ? M + blockH : height - M - labelSize;

  // Background panel — keeps the stamp legible even where it lands on page content,
  // instead of clashing with text/logos underneath.
  const pad = 8;
  const lastBaseline = (y - 8) - (subLines * (lineSize + gap));
  const panelTop = y + labelSize * 0.82;
  const panelBottom = lastBaseline - 4;
  pg.drawRectangle({
    x: x - pad, y: panelBottom, width: boxW + pad * 2, height: panelTop - panelBottom,
    color: rgb(1, 1, 1), opacity: Math.min(0.92, opacity + 0.07),
    borderColor: col, borderWidth: 1.2, borderOpacity: opacity,
  });

  pg.drawText(String(label).toUpperCase(), {
    x, y, size: labelSize, font: bold, color: col, opacity: 1, rotate: degrees(rotate),
  });
  let cy = y - 8;
  for (const t of [...meta, ...noteLines]) {
    cy -= (lineSize + gap);
    pg.drawText(t, { x, y: cy, size: lineSize, font: reg, color: col, opacity: 1 });
  }

  const bytes = await pdf.save();
  fs.writeFileSync(outputPath, bytes);   // stamped COPY; original is never touched
  return outputPath;
}

// Build the stamped-copy path next to the source: "<name>.APPROVED-stamped.pdf".
function stampedPathFor(srcPath, label) {
  const ext = path.extname(srcPath);
  const dir = path.dirname(srcPath);
  const base = path.basename(srcPath, ext);
  return path.join(dir, `${base}.${String(label).toUpperCase()}-stamped${ext}`);
}

/*
 * Produce a stamped copy for a resolved workflow decision. Self-contained + non-fatal:
 * it NEVER throws (the DB decision is already the source of truth) — on any problem it
 * logs and resolves to null. Only stamps approve/reject on a PDF source.
 *
 * deps: { documents } (defaults to the real DB module); logger for diagnostics.
 * args: { db, route, decision, userName, comment, resolvedAt }
 * → resolves to the stamped path, or null when skipped/failed.
 */
async function stampWorkflowDecision({ db, route, decision, userName, comment, resolvedAt } = {}, deps = {}) {
  const documents = deps.documents || require('../../database/modules/documents');
  const log = deps.logger || ((m) => console.warn(`[pdfStamp] ${m}`));
  try {
    const style = DECISION_STYLE[decision];
    if (!style || !db || !route) return null;                 // only approve/reject
    const doc = documents.getById(db, route.document_id);
    if (!doc) { log(`doc ${route && route.document_id} not found`); return null; }
    const src = documents.resolveFilePath(doc);
    if (!src || !fs.existsSync(src)) { log(`source file missing for doc ${doc.id}`); return null; }
    if (path.extname(src).toLowerCase() !== '.pdf') return null;  // only PDFs get a stamp
    const out = stampedPathFor(src, style.label);
    await stampPdf(src, out, {
      label: style.label, color: style.color, userName, date: resolvedAt, notes: comment || '',
    });
    return out;
  } catch (e) {
    log(`stamp failed: ${e.message}`);                        // non-fatal — decision still stands
    return null;
  }
}

module.exports = { stampPdf, stampWorkflowDecision, stampedPathFor, hexToRgb, fmtDate, wrapText, DECISION_STYLE };
