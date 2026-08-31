'use strict';

/**
 * modules/processing/split_plan.js — PURE decision logic for the batch-separation
 * pre-pass (no Electron/DB deps → unit-testable by plain Node, test_split_plan.js).
 * Extracted for Filing Slips ("Separator sheets") — docs/designs/FILING_SLIPS_2026-07-18.md.
 *
 * buildSegmentArgs builds the EXACT segment_docs.py argv the handler spawns (Oracle C1:
 * a null templates-file must never reach spawn — with zero taught templates and slips ON,
 * the scan must still run, so the arg is simply omitted).
 *
 * buildSplitPlan turns the detector JSON into one of:
 *   {action:'skip'}                      leave the file untouched (today's fail-safe)
 *   {action:'consume', separators}      file is ONLY separator sheets — nothing to import
 *   {action:'split', ranges, minFiles, separators, payloads}
 *
 * PIN #1 (do NOT "simplify" back): with separator sheets present, ONE remaining segment
 * is a REWRITE (minFiles=1 — the file is re-written without its sheet pages), not a skip.
 * Restoring the old "<2 segments ⇒ leave untouched" rule for that case would file a
 * separator sheet INSIDE the document (the trailing-slip hole).
 *
 * Oracle C4: an aborted slip scan must never half-apply — any separator data on a result
 * carrying `slip_aborted` is ignored (defence in depth; segment_docs already omits it).
 */

function buildSegmentArgs({ filePath, templatesFile, tesseract, slips }) {
  const args = ['--file', filePath];
  if (templatesFile) args.push('--templates-file', templatesFile);
  if (tesseract) args.push('--tesseract', tesseract);
  if (slips) args.push('--slips');
  return args;
}

// 0-based inclusive [start,end] segments → pdf_splitter's 1-based "a-b,c,…" string.
// parse_ranges treats each comma group independently, so unlisted pages (the separator
// sheets) are EXCLUDED from every output — that upstream semantic is pinned by
// tests/test_slip_detect.py (PIN #3).
function toRanges(segments) {
  return segments.map(([s, e]) => (s === e ? `${s + 1}` : `${s + 1}-${e + 1}`)).join(',');
}

function buildSplitPlan(det) {
  const segments = det && det.success && Array.isArray(det.segments) ? det.segments : null;
  if (!segments) return { action: 'skip' };
  const seps = (!det.slip_aborted && Array.isArray(det.separator_pages)) ? det.separator_pages : [];
  const payloads = (seps.length && Array.isArray(det.separator_payloads)) ? det.separator_payloads : [];

  if (!seps.length) {
    // Today's template-separation rule, verbatim: one document ⇒ leave it untouched.
    if (segments.length < 2) return { action: 'skip' };
    return { action: 'split', ranges: toRanges(segments), minFiles: 2, separators: 0, payloads: [] };
  }
  if (!segments.length) return { action: 'consume', separators: seps.length };
  return { action: 'split', ranges: toRanges(segments), minFiles: 1, separators: seps.length, payloads };
}

module.exports = { buildSegmentArgs, buildSplitPlan, toRanges };
