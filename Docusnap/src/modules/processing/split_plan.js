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

function buildSegmentArgs({ filePath, templatesFile, tesseract, slips, docTypesFile, configFile, titleSlug, continuationVeto,
                            knownSuppliersFile, knownSupplierChange }) {
  const args = ['--file', filePath];
  if (templatesFile) args.push('--templates-file', templatesFile);
  if (tesseract) args.push('--tesseract', tesseract);
  if (slips) args.push('--slips');
  // DARK switches (2026-09-16, Oracle (A) C2 / (B) C8): argv is the ONLY kill — the pre-pass spawn never carries the
  // DB-bridged env. Emitted only when ON (OFF argv byte-identical even when the files are known); the title arm
  // needs the doc-types file (never a null in argv — the Oracle C1 class); patterns fall back to the bundled config.
  if (titleSlug && docTypesFile) {
    args.push('--doc-types-file', docTypesFile);
    if (configFile) args.push('--config-file', configFile);
    args.push('--title-slug');
  }
  if (continuationVeto) args.push('--continuation-veto');
  // mig 179 (2026-09-17, Oracle C5): the known-supplier file + flag ride together or not at all (never a null path).
  if (knownSupplierChange && knownSuppliersFile) args.push('--known-suppliers-file', knownSuppliersFile, '--known-supplier-change');
  return args;
}

// 0-based inclusive [start,end] segments → pdf_splitter's 1-based "a-b,c,…" string.
// parse_ranges treats each comma group independently, so unlisted pages (the separator
// sheets) are EXCLUDED from every output — that upstream semantic is pinned by
// tests/test_slip_detect.py (PIN #3).
function toRanges(segments) {
  return segments.map(([s, e]) => (s === e ? `${s + 1}` : `${s + 1}-${e + 1}`)).join(',');
}

// Boundary CLASS (2026-09-17, segment pair hold): the detector's additive `weak_pages` = the 0-based start pages of
// every segment whose cut was decided by a TEMPLATE leg alone (no document-start on the page — see
// segmentation.boundary_class). Validated ints only; a detector without the key (older Python) ⇒ [] ⇒ the belt is inert.
function weakPagesOf(det) {
  return (det && Array.isArray(det.weak_pages)) ? det.weak_pages.filter(p => Number.isInteger(p) && p >= 0) : [];
}
// The segment INDICES (k into det.segments ⇔ the splitter's k-th output) whose start page is weak.
function weakSegmentIdx(segments, weakPages) {
  const w = new Set(weakPages || []);
  return (segments || []).map((s, k) => (Array.isArray(s) && w.has(s[0]) ? k : -1)).filter(k => k >= 0);
}

function buildSplitPlan(det) {
  const segments = det && det.success && Array.isArray(det.segments) ? det.segments : null;
  if (!segments) return { action: 'skip' };
  const seps = (!det.slip_aborted && Array.isArray(det.separator_pages)) ? det.separator_pages : [];
  const payloads = (seps.length && Array.isArray(det.separator_payloads)) ? det.separator_payloads : [];
  const weakIdx = weakSegmentIdx(segments, weakPagesOf(det));

  if (!seps.length) {
    // Today's template-separation rule, verbatim: one document ⇒ leave it untouched.
    if (segments.length < 2) return { action: 'skip' };
    return { action: 'split', ranges: toRanges(segments), minFiles: 2, separators: 0, payloads: [], weakIdx };
  }
  if (!segments.length) return { action: 'consume', separators: seps.length };
  return { action: 'split', ranges: toRanges(segments), minFiles: 1, separators: seps.length, payloads, weakIdx };
}

// The produced basenames (page order — pdf_splitter iterates its range sets in order, so made[k] ⇔ segments[k])
// whose cut was weak. Pure; [] when the plan carries no weak indices.
function weakSegmentNames(plan, names) {
  const w = new Set((plan && Array.isArray(plan.weakIdx)) ? plan.weakIdx : []);
  return (names || []).filter((_, k) => w.has(k));
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
// ── Segment PAIR hold (2026-09-17; gary → Oracle SIGN-OFF-W/COND C1-C12; DARK mig 180 `segment_pair_hold`) ──────
// The S4 silent truncation: a 2-page document whose page 2 repeats the letterhead with no page marker is cut at
// page 2 on the strength of the LETTERHEAD ALONE (the fingerprint IS the letterhead words), and on a manual import
// page 1 auto-files as a complete 1-page document while page 2 orphans in Review (caught live 2026-09-17, e2e3
// #1255). The pre-pass now classifies every cut WEAK (template-only, no document-start on the page —
// segmentation.boundary_class) or STRONG, and the handler compares the two halves of every WEAK cut once both have
// landed (pairHoldDecision over the 200-DPI reads): the same supplier, no date on the later page and the same (or
// no) document number → BOTH halves carry a durable "— confirm once." sentence naming the other page and where the
// original scan is; otherwise the earlier page is released. The first half to land carries its sentence
// PROVISIONALLY (a Stop / kill mid-batch can never leave an unmarked page a later File-All could file). Sentences are
// PER PAIR and name the partner page, and every stamp / clear keys on the EXACT sentence (Oracle C3: p1|p2|p3 with
// (p1,p2) released and (p2,p3) held must leave p2 marked). The mark deliberately avoids the mig-176 wording so the
// two families never read as one another. Never "use Split" here — the wrong tool for a pair (Oracle C7).
const SEGMENT_PAIR_MARK = 'came out of a multi-document scan as a document on';
const SEGMENT_PAGE_RE = /_split_p(\d+)(?:-(\d+))?\.pdf$/i;
// {from,to} of a splitter output name (1-based, inclusive); null for a non-splitter name.
function segmentPageRange(name) {
  const m = SEGMENT_PAGE_RE.exec(String(name || ''));
  return m ? { from: Number(m[1]), to: Number(m[2] || m[1]) } : null;
}
function _pagesPhrase(r) {
  return r.from === r.to ? { word: 'Page', span: String(r.from), own: 'its own', it: 'it' }
                         : { word: 'Pages', span: `${r.from}–${r.to}`, own: 'their own', it: 'them' };
}
const _PAIR_WHERE = "(the original scan is kept in the folder's .sf_separated_originals)";
// The two sentences of one pair — the predecessor's names the next page, the successor's the previous page.
function pairSentences(pair) {
  const p = _pagesPhrase(pair.predPages), s = _pagesPhrase(pair.succPages);
  return {
    pred: `${p.word} ${p.span} ${SEGMENT_PAIR_MARK} ${p.own}; the next page (${pair.succPages.from}) may belong to ${p.it} — check both ${_PAIR_WHERE} — confirm once.`,
    succ: `${s.word} ${s.span} ${SEGMENT_PAIR_MARK} ${s.own}; ${s.it === 'it' ? 'it' : 'they'} may continue the previous page (${pair.predPages.to}) — check both ${_PAIR_WHERE} — confirm once.`,
  };
}
// The partner page a pair sentence names (the reason panel shows it).
function pairPartnerPage(note) {
  const m = /the (?:next|previous) page \((\d+)\)/.exec(String(note || ''));
  return m ? Number(m[1]) : null;
}
function hasMergedSegmentHold(note) { return String(note || '').includes(SEGMENT_HOLD_MARK); }
function hasPairSegmentHold(note)   { return String(note || '').includes(SEGMENT_PAIR_MARK); }
// EITHER family (the reason panel, the reprocess carry and the lane-hold readers treat both as "a segment hold").
function hasSegmentHold(note) { return hasMergedSegmentHold(note) || hasPairSegmentHold(note); }
// 'merged' (the mig-176 multi-page cut — points at Split) | 'pair' | null. A row carrying BOTH reports 'merged'.
function segmentHoldKind(note) { return hasMergedSegmentHold(note) ? 'merged' : (hasPairSegmentHold(note) ? 'pair' : null); }
// Parse "Pages a–b" / "Page a" back out of a stamped note (the reason panel shows the range).
function segmentHoldRange(note) {
  const m = /\bPages? (\d+)(?:[–-](\d+))? /.exec(String(note || ''));
  return m ? { from: Number(m[1]), to: Number(m[2] || m[1]) } : null;
}
// Remove EXACTLY one pair sentence from a note (the lane-hold family ends every sentence with "— confirm once.", so the
// split boundary is exact); every other sentence — a mig-176 hold, a ref advisory — survives byte-identical. '' when
// nothing is left (the caller writes NULL).
function clearPairSentence(note, sentence) {
  const want = String(sentence || '').trim();
  const parts = String(note || '').split(/(?<=— confirm once\.)/).map(s => s.trim()).filter(Boolean);
  return parts.filter(p => p !== want).join(' ');
}
// The PAIR population of a pre-pass: for every rewrite of a HEURISTIC split (separators === 0), every segment k ≥ 1
// whose cut was WEAK is paired with segment k−1 (`weak` = the basenames buildSplitPlan/weakSegmentNames marked).
// Returns { pairs, byName (Map<basename, pair[]> — a middle segment of p1|p2|p3 belongs to two pairs), landed (Map) }.
// A user's own `x_split_p2.pdf` (no rewrite) is never paired — the rewrite set is the trigger, never the filename.
function buildPairContext(rewrites) {
  const pairs = [], byName = new Map();
  for (const r of (Array.isArray(rewrites) ? rewrites : [])) {
    if (!r || (r.separators || 0) > 0) continue;
    const segs = Array.isArray(r.segments) ? r.segments.map(s => String(s || '')) : [];
    const weak = new Set(Array.isArray(r.weak) ? r.weak.map(s => String(s || '')) : []);
    for (let k = 1; k < segs.length; k++) {
      if (!weak.has(segs[k])) continue;
      const predPages = segmentPageRange(segs[k - 1]), succPages = segmentPageRange(segs[k]);
      if (!predPages || !succPages) continue;
      const pair = { original: String(r.original || ''), pred: segs[k - 1], succ: segs[k], predPages, succPages };
      pairs.push(pair);
      for (const n of [pair.pred, pair.succ]) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(pair); }
    }
  }
  return { pairs, byName, landed: new Map() };
}
// The value check (Oracle C6). Inputs = { supplier, ref, date } as the pipeline STORED them (strings | null).
//   'inconclusive' — a supplier is blank on either side (→ the caller holds both: fail toward Review)
//   'release'      — different suppliers; or the later page reads its own number / its own date (a first page)
//   'hold'         — same supplier AND (no number and no date on the later page — the orphan arm; OR the same
//                    number as the earlier page with no date or the same date — the same-document arm)
// Suppliers compare on suffix-stripped tokens with the separator's prefix tolerance (segmentation.same_supplier);
// numbers after text_normalise + a separator strip + a digit-confusable fold (O/0, I/l/1, S/5, B/8, Z/2 — the fold can
// only ever ADD a hold); dates via the ONE parser (date_parse.parseDate) — an unparseable date is EMPTY (hold direction).
const _LEGAL_SUFFIXES = new Set(['ltd', 'limited', 'plc', 'llc', 'inc', 'co', 'company', 'corp', 'corporation', 'gmbh', 'uk', 'group', 'holdings']);
const _CONFUSABLE = { o: '0', i: '1', l: '1', s: '5', b: '8', z: '2' };
function _supplierTokens(v) {
  const { normaliseForTokens } = require('../../../database/modules/text_normalise');
  const toks = normaliseForTokens(v).split(/[^a-z0-9']+/).filter(Boolean);
  while (toks.length && _LEGAL_SUFFIXES.has(toks[toks.length - 1].replace(/'/g, ''))) toks.pop();
  return toks;
}
function sameSupplier(a, b) {
  const ta = _supplierTokens(a), tb = _supplierTokens(b);
  if (!ta.length || !tb.length) return false;
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) if (ta[i] !== tb[i]) return false;
  return true;
}
function normRef(v) {
  const { normaliseForTokens } = require('../../../database/modules/text_normalise');
  return normaliseForTokens(v).replace(/[^a-z0-9]/g, '').replace(/[oilsbz]/g, c => _CONFUSABLE[c]);
}
function normDate(v) {
  const { parseDate, formatDate } = require('../../../database/modules/date_parse');
  const d = v ? parseDate(String(v)) : null;
  return d ? formatDate(d) : '';
}
// Oracle C6b (2026-09-17, after the e2e exposed the blur shape): the rule is the PRINCIPLE, not a list of arms — a weak
// later page is RELEASED only on POSITIVE evidence that it is a document of its own (its OWN number AND its OWN date,
// both read, and not the same-document shape); with the same supplier, ANY missing piece on the later page is
// 'inconclusive' → the caller holds both (fail toward Review; both halves are already parked by their own gaps, the belt
// adds the durable mark + the "check both" pointer so a later File-All cannot file them). A REPEATED value is never
// evidence of an own document (the Sage-class header repeats the number AND the date). The ONE shape that must STAY a
// release: the earlier page's number unread + a COMPLETE later page (own number + own date) — holding it would tax every
// neighbour of an unreadable first page; recorded as a census count, revisited on the number.
function pairHoldDecision(pred, succ) {
  const ps = _supplierTokens(pred && pred.supplier), ss = _supplierTokens(succ && succ.supplier);
  if (!ps.length || !ss.length) return 'inconclusive';
  if (!sameSupplier(pred.supplier, succ.supplier)) return 'release';
  const sRef = normRef(succ.ref), sDate = normDate(succ.date), pRef = normRef(pred.ref), pDate = normDate(pred.date);
  if (!sRef && !sDate) return 'hold';                                          // the orphan arm
  if (sRef && pRef && sRef === pRef) {
    return (!sDate || sDate === pDate) ? 'hold' : 'release';                   // the same-document arm; an own DIFFERENT date releases (the same-serial alert shape)
  }
  if (sRef && sDate) return 'release';                                         // own number + own date = a document of its own (incl. after an unread earlier number)
  if (!sRef && sDate && pDate && sDate !== pDate) return 'release';            // no number but a date of its OWN (not the earlier page's) — a first page
  return 'inconclusive';                                                       // any other missing piece: a repeated date without a number, a number without a date …
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
// (Oracle C5, 2026-09-17: EVERY mark-bearing sentence is carried — a row holding a mig-176 sentence AND a pair sentence
// keeps both; `filter`, never `find`.) A sentence already present on some merged row is not duplicated.
function carrySegmentHold(existingRows, mergedRows, roles = {}) {
  const src = (existingRows || []).find(r => hasSegmentHold(r && r.validation_note));
  if (!src) return mergedRows;
  const mergedText = (mergedRows || []).map(r => String((r && r.validation_note) || '')).join(' ');
  const seen = new Set();
  const sentences = [];
  for (const r of (existingRows || [])) {
    for (const part of String((r && r.validation_note) || '').split(/(?<=— confirm once\.)/)) {
      const s = part.trim();
      if (s && hasSegmentHold(s) && !seen.has(s)) { seen.add(s); sentences.push(s); }
    }
  }
  if (!sentences.length) sentences.push(segmentHoldNote(0, 0));
  const missing = sentences.filter(s => !mergedText.includes(s));
  if (!missing.length) return mergedRows;
  const sentence = missing.join(' ');
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

// ── Graphical page-split: marks + removed → page GROUPS (2026-09-20; barry+eric+gary+oscar → Oracle SIGN-OFF-W/COND ×2) ──
// The visual splitter: the user clicks the FIRST page of each sub-document (1-based `marks`) and may
// select pages to REMOVE (blank backs → `removed`). This turns them into explicit page GROUPS for
// pdf_splitter.py --groups-file — NOT a range STRING, because a range gap FRAGMENTS a sub-document into
// one file per contiguous run (a duplex scan with interspersed blanks would shatter into single pages).
// A group may be non-contiguous; the splitter's writer keeps it as ONE file.
//
// STRICT on a destructive path: reject any non-integer / out-of-range mark or removed page (never CLAMP —
// parse_ranges clamps, which would be fail-toward-wrong here). Page 1 is always an implicit boundary.
// N MUST be the PDF-authoritative page count (read server-side, never the renderer's echo).
// Returns { ok, error?, groups, expectedSegments, outputPageCount, N }:
//   groups           = arrays of 1-based page numbers (removal applied; empty groups dropped)
//   expectedSegments = groups.length — the EXACT file count the splitter must produce (the delete guard)
//   outputPageCount  = N − |removed ∩ [1..N]| — pages that survive into some output file
function marksToGroups(marks, removed, N) {
  N = Number(N);
  if (!Number.isInteger(N) || N < 1) return { ok: false, error: 'bad-page-count' };
  const clean = (arr) => {
    const out = [];
    for (const v of (Array.isArray(arr) ? arr : [])) {
      if (!Number.isInteger(v)) return null;      // any non-integer → reject the whole request
      if (v < 1 || v > N) return null;            // out of range → reject (no clamp)
      out.push(v);
    }
    return out;
  };
  const m = clean(marks);   if (m === null) return { ok: false, error: 'bad-mark' };
  const r = clean(removed); if (r === null) return { ok: false, error: 'bad-removed' };
  const removedSet = new Set(r);                              // dedupe
  const boundaries = Array.from(new Set([1, ...m])).sort((a, b) => a - b);  // implicit 1, unique, ascending
  const groups = [];
  for (let i = 0; i < boundaries.length; i++) {
    const lo = boundaries[i];
    const hi = (i + 1 < boundaries.length) ? boundaries[i + 1] - 1 : N;
    const pages = [];
    for (let p = lo; p <= hi; p++) if (!removedSet.has(p)) pages.push(p);
    if (pages.length) groups.push(pages);                     // drop empty (whole sub-doc / boundary removed)
  }
  return { ok: true, groups, expectedSegments: groups.length, outputPageCount: N - removedSet.size, N };
}

// The PROCEED gate for a marks-split (the ONLY thing that authorises the destructive delete/move-aside):
//   expectedSegments>=1 AND outputPageCount>=1 AND (expectedSegments>=2 OR outputPageCount<N)
// The strictly-fewer clause (outputPageCount<N) blocks the identical-re-import hazard (Chris r5 card 7)
// for the single-file "remove blanks, no split" case; the >=2 clause covers a genuine split. This is SAFE
// ONLY because the original is preserved recoverably in .sf_separated_originals (the move-aside) — the two
// are LOAD-BEARING TOGETHER (Oracle 2026-09-20 seam): restoring a hard-delete OR dropping the strictly-fewer
// clause makes this unsound. Pinned in test_split_removal_guard.js.
function splitMarksAllowed(plan) {
  if (!plan || !plan.ok) return { ok: false, error: plan && plan.error || 'bad-plan' };
  if (plan.outputPageCount < 1) return { ok: false, error: 'all-pages-removed' };
  if (plan.expectedSegments < 1) return { ok: false, error: 'nothing-to-do' };
  if (plan.expectedSegments >= 2) return { ok: true };
  if (plan.outputPageCount < plan.N) return { ok: true };     // no split, but ≥1 page removed → a real clean
  return { ok: false, error: 'no-op' };                       // one whole-doc output, nothing removed
}

// JS mirror of pdf_splitter.parse_ranges' NON-EMPTY group count — the expected output-file count for the
// LEGACY free-text `ranges` path, so its move-aside guard is exact (createdFiles.length === expected). Mirrors
// the clamp/drop/reversed-skip/empty-skip rules exactly (pin: test_split_removal_guard.js keeps them in step).
function expectedRangeFiles(rangesStr, N) {
  N = Number(N);
  let files = 0;
  for (let part of String(rangesStr || '').split(',')) {
    part = part.trim();
    if (!part) continue;
    if (part.includes('-')) {
      const [a, b] = part.split('-', 2);
      const start = Math.max(1, parseInt(a, 10));
      const end   = Math.min(N, parseInt(b, 10));
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end) files++;
    } else {
      const p = parseInt(part, 10);
      if (Number.isInteger(p) && p >= 1 && p <= N) files++;
    }
  }
  return files;
}

module.exports = { buildSegmentArgs, buildSplitPlan, toRanges,
  marksToGroups, splitMarksAllowed, expectedRangeFiles,
  MULTI_PAGE_SEGMENT_RE, SEGMENT_HOLD_MARK, segmentHoldNote, hasSegmentHold, segmentHoldRange,
  segmentHoldPages, carrySegmentHold,
  // segment pair hold (2026-09-17)
  SEGMENT_PAIR_MARK, SEGMENT_PAGE_RE, weakPagesOf, weakSegmentIdx, weakSegmentNames, segmentPageRange, pairSentences,
  pairPartnerPage, hasMergedSegmentHold, hasPairSegmentHold, segmentHoldKind, clearPairSentence, buildPairContext,
  sameSupplier, normRef, normDate, pairHoldDecision };
