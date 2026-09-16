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

// ── Split-segment "look first" hold (2026-09-16; gary → Oracle SIGN-OFF-W/COND C1-C10) ────────────
// The separator's first-page rule UNDER-SPLITS when a page fails the fingerprint floor (same-logo sibling
// types, non-templated pages): document A's page + a stranger page B come out as ONE multi-page segment
// that reads 100 % clean from page A (soak 2026-09-16, doc #633). A 1-page cut cannot contain a stranger
// page; a sheet-bounded cut (Filing Slips) is an operator-declared boundary. So the population that needs
// a human look is EXACTLY: a multi-page segment of a HEURISTIC split. These helpers are pure so the
// predicate + the reprocess carry are pinned by plain Node (test_segment_hold_predicate.js).
//
// The splitter's naming contract (python_backend/pdf_splitter.py): `{stem}_split_p{a}.pdf` for one page,
// `{stem}_split_p{a}-{b}.pdf` for pages a..b. The NAME alone is never the trigger — the rewrite set from
// _separateBatchDocuments is (a user's own `x_split_p2-3.pdf`, or the Review Split-PDF tool's output, has
// no rewrite → never held). The regex only recovers the page range for the note.
const MULTI_PAGE_SEGMENT_RE = /_split_p(\d+)-(\d+)\.pdf$/i;
// The mark every reader keys on (get-auto-file-reason, composeNote, the reprocess carry, the pins). Its
// sentence ends with the lane-hold family's literal "— confirm once." (handler._isLaneHoldNote,
// rereadHolds.CONFIRM_ONCE, composeNote._isLaneHold — byte-equal, pinned) so the existing merge-survival
// and one-confirm-once-per-field machinery apply without a fourth mirror.
const SEGMENT_HOLD_MARK = 'were cut from a multi-document scan';
function segmentHoldNote(from, to) {
  return `Pages ${from}–${to} ${SEGMENT_HOLD_MARK}; check every page belongs to this document (if one doesn't, use Split) — confirm once.`;
}
function hasSegmentHold(note) { return String(note || '').includes(SEGMENT_HOLD_MARK); }
// Parse "Pages a–b" back out of a stamped note (the reason panel shows the range).
function segmentHoldRange(note) {
  const m = /Pages (\d+)[–-](\d+) /.exec(String(note || ''));
  return m ? { from: Number(m[1]), to: Number(m[2]) } : null;
}
// rewrites = [{ original, segments:[basename,…], separators }] from _separateBatchDocuments. Returns
// Map<basename, {from,to}> of the segments that need a look: multi-page AND from a heuristic (no-sheet)
// split. `separators > 0` ⇒ every segment of that rewrite is sheet-bounded ⇒ exempt.
function segmentHoldPages(rewrites) {
  const out = new Map();
  for (const r of (Array.isArray(rewrites) ? rewrites : [])) {
    if (!r || (r.separators || 0) > 0) continue;
    for (const s of (r.segments || [])) {
      const m = MULTI_PAGE_SEGMENT_RE.exec(String(s || ''));
      if (m) out.set(String(s), { from: Number(m[1]), to: Number(m[2]) });
    }
  }
  return out;
}
// Slice 2 (Oracle C1): the hold is a property of the FILE's page composition, not of any read, so a
// reprocess must not shed it. mergeReprocessRows keeps a lane-hold note only when the fresh value equals
// the stored one; a DIFFERENT fresh value (`used_new`) or a dropped stub would lose the mark. Pure
// post-pass over the merged rows: if any EXISTING row carries the mark and no merged row does, put the
// sentence back on the merged ref-role row (else date role, else the first valued row, else append a
// stub on the ref key). Idempotent; a no-op when nothing carried the mark. Returns the (mutated) rows.
function carrySegmentHold(existingRows, mergedRows, roles = {}) {
  const src = (existingRows || []).find(r => hasSegmentHold(r && r.validation_note));
  if (!src) return mergedRows;
  if ((mergedRows || []).some(r => hasSegmentHold(r && r.validation_note))) return mergedRows;
  const sentence = (String(src.validation_note).split(/(?<=— confirm once\.)/).find(hasSegmentHold) || '').trim()
    || segmentHoldNote(0, 0);
  const pick = (mergedRows || []).find(r => r && r.field_key === roles.refKey)
    || (mergedRows || []).find(r => r && r.field_key === roles.dateKey)
    || (mergedRows || []).find(r => r && String(r.display_value || '').trim());
  if (pick) {
    const prior = String(pick.validation_note || '').trim();
    pick.validation_note = prior ? `${sentence} ${prior}` : sentence;
    return mergedRows;
  }
  mergedRows.push({ field_key: roles.refKey || src.field_key || 'supplier_name', raw_value: null, display_value: null,
    confidence: 0, extraction_method: 'segment_hold', validation_note: sentence, corrected_to: null,
    anchor_label: null, candidates: null, suggested_supplier: null, corroboration: null, charset_flag_meta: null });
  return mergedRows;
}

module.exports = { buildSegmentArgs, buildSplitPlan, toRanges,
  MULTI_PAGE_SEGMENT_RE, SEGMENT_HOLD_MARK, segmentHoldNote, hasSegmentHold, segmentHoldRange,
  segmentHoldPages, carrySegmentHold };
