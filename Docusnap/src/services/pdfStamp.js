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

// Cut a note down to what stampPdf will accept, on a word boundary where one is close enough,
// with a visible ellipsis so the reader can see it was shortened rather than assume it is whole.
function elideNotes(notes, max = MAX_NOTES) {
  const s = String(notes || '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
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
    // DEFAULT CORNER: bottom-right (changed 2026-08-13, Chris round 4 card 5). Top-right lands the
    // stamp squarely on the letterhead and the document title — he reported "APPROVED" printed over
    // "Harrowgate Timber Suppli‹es›" and "SALES ORDER", both partly hidden, on a copy he was about
    // to email to his accountant. A business document's identifying block is top-left-to-top-right
    // by convention and its bottom-right is nearly always clear, so the corner that hides least is
    // the better default. Only the DEFAULT moves: an explicit `position`, and any per-install
    // `stamp_placement` box, still win.
    notes = '', page = 0, position = 'bottom-right', opacity = 0.85, rotate = 0,
    // PLACEMENT + SIZE (owner 2026-08-02: "choose where it goes and resize it to fit a blank
    // area"). `box` is NORMALISED {x, y, w} with the origin at the page's TOP-LEFT, matching every
    // other geometry in this app (field mappings, anchors, landmarks) — pdf-lib's own origin is
    // bottom-left, and that flip is done ONCE, here, rather than leaked to callers. `w` drives the
    // stamp's width and therefore its scale; the height follows the content. Omit `box` and the
    // legacy corner `position` applies exactly as before.
    box = null, scale = 1,
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
  // A placed stamp takes its width from `box.w`; otherwise the legacy fixed width applies. Every
  // type size scales with it, so "resize to fit a blank area" changes the whole stamp, not just
  // its bounding box — a stamp whose panel grew but whose text stayed 9pt would look broken.
  const sc = Math.max(0.5, Math.min(3, Number(scale) || 1));
  const legacyW = Math.min(230, Math.max(120, width - 2 * M));
  const boxW = box && Number(box.w) > 0
    ? Math.max(90, Math.min(width - 2 * M, Number(box.w) * width))
    : legacyW * sc;
  const k = boxW / legacyW;                            // type scale follows the panel width
  const labelSize = 22 * k, lineSize = Math.max(6, 9 * k), gap = 3 * k;

  const meta = [];
  if (userName) meta.push(`By: ${userName}`);
  meta.push(`Date: ${fmtDate(date)}`);
  const noteLines = String(notes).trim() ? wrapText(`Notes: ${String(notes).trim()}`, reg, lineSize, boxW) : [];
  const subLines = meta.length + noteLines.length;
  const blockH = labelSize + 8 + subLines * (lineSize + gap) + 8;

  // Placement. `box` wins when given: its x/y are the stamp's TOP-LEFT in normalised, top-origin
  // coordinates, converted here to pdf-lib's bottom-left origin and clamped so a stamp can never
  // be positioned off the page (a saved placement outlives the page size it was chosen on).
  let x, y;
  if (box && Number.isFinite(Number(box.x)) && Number.isFinite(Number(box.y))) {
    x = Math.max(0, Math.min(width  - boxW, Number(box.x) * width));
    const topY = Math.max(0, Math.min(height - blockH, Number(box.y) * height));
    y = height - topY - labelSize;                     // headline baseline, measured from the top
  } else {
    // Corner placement (top-right default); x is the left edge, y the headline baseline.
    x = position.includes('left') ? M : Math.max(M, width - boxW - M);
    y = position.includes('bottom') ? M + blockH : height - M - labelSize;
  }

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
// `routeId` (optional) makes it per-decision: "<name>.APPROVED-stamped-r12.pdf". Without it, two
// approvals on the SAME document write the same filename and the second silently overwrites the
// first — so the earlier decision's stamped copy is destroyed while its route row still points at
// the path, now showing someone else's stamp (eric, 2026-08-02). Legacy copies on disk keep
// working: nothing ever RECOMPUTES this path to find a file, every reader uses the stored
// route.stamped_path.
function stampedPathFor(srcPath, label, routeId) {
  const ext = path.extname(srcPath);
  const dir = path.dirname(srcPath);
  const base = path.basename(srcPath, ext);
  const suffix = routeId != null && routeId !== '' ? `-r${String(routeId).replace(/[^0-9A-Za-z]/g, '')}` : '';
  return path.join(dir, `${base}.${String(label).toUpperCase()}-stamped${suffix}${ext}`);
}

// Per-install stamp placement, stored as JSON in settings under `stamp_placement`:
//   { x, y, w }  — normalised, top-left origin (see stampPdf's `box`)
// Anything malformed falls back to the legacy top-right corner rather than throwing: a bad
// setting must never be able to stop a decision being stamped.
const STAMP_PLACEMENT_KEY = 'stamp_placement';
function parseStampPlacement(raw) {
  if (!raw) return null;
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object') return null;
  const num = (n, lo, hi, dflt) => {
    const f = Number(n);
    return Number.isFinite(f) ? Math.max(lo, Math.min(hi, f)) : dflt;
  };
  const w = num(v.w, 0.06, 0.9, null);
  if (w == null) return null;
  return { x: num(v.x, 0, 1, 0.6), y: num(v.y, 0, 1, 0.04), w };
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
    const out = stampedPathFor(src, style.label, route.id);
    // Per-install placement, if one has been chosen (Settings). Read defensively: a missing or
    // malformed setting simply leaves `box` null and the legacy corner placement applies.
    let box = null;
    try {
      const learning = deps.learning || require('../../database/modules/learning');
      box = parseStampPlacement(learning.getSetting(db, STAMP_PLACEMENT_KEY));
    } catch { /* no setting / no module → legacy corner */ }
    // An over-long note ELIDES; it must never cost the stamp. stampPdf throws above MAX_NOTES
    // (a deliberate contract for direct callers), and this function swallows every throw — so a
    // 601-character rejection reason used to produce NO STAMPED COPY AT ALL, silently, which is
    // the worst outcome available: the decision looks unstamped rather than abbreviated. The
    // full note always remains on the route + in History; the stamp is only ever a derivative.
    await stampPdf(src, out, {
      label: style.label, color: style.color, userName, date: resolvedAt,
      notes: elideNotes(comment || ''), box,
    });
    return out;
  } catch (e) {
    log(`stamp failed: ${e.message}`);                        // non-fatal — decision still stands
    return null;
  }
}

module.exports = {
  stampPdf, stampWorkflowDecision, stampedPathFor, hexToRgb, fmtDate, wrapText,
  elideNotes, parseStampPlacement, MAX_NOTES, STAMP_PLACEMENT_KEY, DECISION_STYLE,
};
