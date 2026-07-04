"""
extraction/template_mapper.py
-----------------------------
Stage 0.5 extraction — admin-drawn anchor -> target zone mappings.

Companion to anchor.py's learned spatial anchors, but sourced from
`template_field_mappings` (drawn on a pinned sample document via
Settings -> Templates, see database/modules/templates.js::saveMapping)
rather than mined from confirmed-document corrections.

Primary model (per the admin tool's design — do NOT reduce this to a fixed
grid lookup): locate the anchor's label text near its drawn position, then
re-derive the target zone from the anchor's ACTUAL location plus the stored
*relative* offset (offset_dx_norm/offset_dy_norm). This makes the mapping
robust to scan/print drift instead of trusting absolute saved coordinates.
The 8-cell `region_hint` recorded alongside each mapping is intentionally
unused here — it is an optimisation hint for a future coarse-skip pass, not
part of this primary anchor+offset mechanism (see CLAUDE.md).

Returns the same shape as anchor.extract_with_anchors:
    {field_key: {"value": str, "confidence": int, "method": str, "anchor": str}}
so engine.py can merge results with its existing confidence-comparison logic
and zero special-casing. When the anchor cannot be located at all, the field
is simply omitted — guaranteeing the documented fallback to the rest of the
pipeline (keyword/anchor/LLM) for that field.
"""

import difflib
import math
import re

from PIL import Image, ImageFilter, ImageOps

from extraction import registration
# Reuse the SAME credibility test the learned-anchor stage uses, so a template
# mapping is held to the same "is this value plausible for the field?" standard
# (typed fields must match their validation pattern; free-text must not be debris).
from extraction.anchor import _crop_is_credible, _repair_single_token, clean_crop_segment, _ocr_crop_laddered, _FREE_TEXT_RESCUE_CONF
# And the SAME learned-format check Stage 4.5 uses, so the failsafe below judges a
# value against the shape this field has historically taken on this template
# (learned from confirmed docs) — label- and field-key-agnostic, one source of truth.
from extraction.format_anomaly_checker import check_value as _check_learned_format

try:
    import pytesseract
    from pytesseract import Output
except ImportError:  # pragma: no cover - exercised only when Tesseract absent
    pytesseract = None
    Output = None

_FUZZY_MATCH_THRESHOLD = 0.6

# Proximity tie-break: when a label REPEATS on the page and several lines match
# the anchor EQUALLY well, prefer the one nearest the original anchor position.
# This must NEVER let a nearer but LOWER-scoring line beat a higher-scoring match
# — doing so picked "Ticket Type" (0.70) over the real "Ticket No." (0.75) merely
# because it sat fractionally closer, returning the wrong row's value. So only
# EXACT-score ties (within this tiny float epsilon) are decided by proximity;
# a meaningfully higher score always wins outright.
_SCORE_TIE_EPSILON = 1e-6

# Floor on the anchor SEARCH margin (page-normalised, every edge), applied even
# when a mapping stored no search_expansion. A drawn anchor box is often tight or
# slightly misaligned, and a shifted scan moves the label further; without a
# margin the label falls outside the box and never relocates. Generic for every
# template -- it only widens WHERE the label is sought; the fuzzy-match threshold
# still rejects a wrong nearby label, so coverage improves without false matches.
_ANCHOR_SEARCH_MIN = 0.06
_UNSET = object()         # "located not provided" sentinel (distinct from a None relocation)
# Minimum normalised drift (per axis) before the absolute drawn box is distrusted
# in favour of the label-relative relocation. A small floor so a tiny anchor box
# still needs a REAL move, not OCR jitter, to count as drift (see _label_drifted).
_DRIFT_FLOOR = 0.02

# Review note attached when a manually-mapped value PASSES the field's regex/type
# but differs from the learned per-(supplier,doctype,field) shape on a DERIVED rung
# (registration / relocation). The value is kept (manual authority) but flagged for
# a human to verify, rather than silently dropped (the old behaviour that let the
# wrong auto value win) or silently committed (a possible wrong-column drift read).
_SHAPE_WARN_NOTE = ("manually mapped value differs from the usual format for this "
                    "field — please verify")

# Types whose format is fully defined by their own precise validator/normaliser, so the
# learned-SHAPE veto must be skipped (they vary legitimately — see _gate_value).
_SELF_VALIDATING_TYPES = frozenset({'date', 'currency', 'currency_code',
                                    'mac_address', 'ip_address'})


def extract_with_mappings(page_images, mappings, field_patterns=None,
                          ocr_lines_fn=None, ocr_text_fn=None, slice_capture=None,
                          validation_patterns=None, format_lookup=None,
                          template_landmarks=None, registration_enabled=False):
    """
    Run every enabled mapping against `page_images` and return resolved fields.

    `ocr_lines_fn`/`ocr_text_fn` default to the real Tesseract-backed helpers
    below; tests inject deterministic stubs (matching this codebase's existing
    convention of testing extraction logic directly rather than through OCR —
    see tests/test_validator_ocr_sanitisation.py) so the geometry, relocation
    and merge behaviour can be verified without Tesseract installed.
    """
    if not page_images or not mappings:
        return {}
    ocr_lines_fn = ocr_lines_fn or _ocr_lines
    ocr_text_fn  = ocr_text_fn  or _ocr_text

    # Enabled mappings that point at a valid, present page (filtered once).
    usable = []
    for mapping in mappings:
        if mapping.get("enabled") is False or mapping.get("enabled") == 0:
            continue
        if not mapping.get("field_key"):
            continue
        page_idx = mapping.get("page_number") or 0
        if page_idx < 0 or page_idx >= len(page_images) or page_images[page_idx] is None:
            continue
        usable.append((page_idx, mapping))

    # Per-page OCR cache (Stage 1 / #4): memoises full-page image_to_data so the
    # transform fit + every per-field page-wide relocation share ONE pass per page
    # (see _locate_anchor). One dict for the whole call; keyed by (page, crop_box).
    line_cache = {}

    # Pre-pass: relocate every mapping's anchor ONCE and cache it so _extract_one
    # reuses it (no anchor OCR'd twice) for the single-label local-refinement path.
    located_cache = {}
    for page_idx, mapping in usable:
        anchor_box = _norm_box(mapping, "anchor")
        if not anchor_box:
            located_cache[id(mapping)] = None
            continue
        _acap = ((lambda c, _m=mapping, _p=page_idx, _ab=anchor_box:
                    slice_capture(_m.get("field_key"), "template_mapping", _p,
                                  (_ab["x_norm"], _ab["y_norm"], _ab["w_norm"], _ab["h_norm"]),
                                  c, "anchor")) if slice_capture else None)
        located_cache[id(mapping)] = _locate_anchor(
            page_images[page_idx], anchor_box, mapping.get("anchor_text"),
            float(mapping.get("search_expansion") or 0.0), ocr_lines_fn,
            min_search=_ANCHOR_SEARCH_MIN, capture=_acap, line_cache=line_cache)

    # Per-page registration transform ("register, then read", P4): when the
    # template carries taught landmarks, RE-locate them on THIS page and fit a
    # robust similarity transform ONCE per page (not per field), so taught target
    # boxes follow a shifted/skewed/scaled scan. Gated by registration_enabled; a
    # too-few/poor fit yields None and every field falls through to the existing
    # anchor/offset path — never worse than today.
    page_transform = {}
    if registration_enabled and template_landmarks:
        lm_by_page = {}
        for lm in template_landmarks:
            lm_by_page.setdefault(int(lm.get("page_number") or 0), []).append(lm)
        for page_idx in {pi for pi, _ in usable}:
            lms = lm_by_page.get(page_idx)
            if lms:
                page_transform[page_idx] = _fit_page_transform(
                    page_images[page_idx], lms, ocr_lines_fn, line_cache=line_cache)

    results = {}
    for page_idx, mapping in usable:
        field_key = mapping["field_key"]
        if field_key in results:
            continue
        outcome = _extract_one(page_images[page_idx], mapping, field_patterns,
                               ocr_lines_fn, ocr_text_fn,
                               located=located_cache[id(mapping)],
                               page_transform=page_transform.get(page_idx),
                               slice_capture=slice_capture, page_idx=page_idx,
                               validation_patterns=validation_patterns,
                               format_lookup=format_lookup, line_cache=line_cache)
        if outcome:
            results[field_key] = outcome
    return results


def resolve_geometry(page, mapping, field_patterns=None, template_landmarks=None):
    """Where does this mapping RESOLVE on `page`? Returns the located anchor-label
    box and the target box actually READ (after any drift relocation / registration),
    plus the read value — for the Template Wizard's "show where it reads" overlay, so
    the operator SEES the anchor/target track the document instead of sitting at the
    drawn coordinates. Reuses the SAME locate + the real extractor (the resolved
    target is captured via the existing slice_capture hook = the winning rung's
    actual crop), so the overlay matches extraction exactly. This is an on-demand
    ADMIN preview path, so the extra OCR locate is acceptable (not the hot path).

    Returns: {value, confidence, method,
              anchor_box: [x,y,w,h]|None,   # where the label was located (None if not found / merged-row)
              target_box: [x,y,w,h]|None}   # the crop actually read (the resolved value position)
    All boxes page-normalised, matching the drawn-coordinate space."""
    anchor_box  = _norm_box(mapping, "anchor")
    anchor_text = mapping.get("anchor_text")
    located = None
    if anchor_box:
        located = _locate_anchor(page, anchor_box, anchor_text,
                                 float(mapping.get("search_expansion") or 0),
                                 _ocr_lines, min_search=_ANCHOR_SEARCH_MIN)
        if not located and anchor_text:
            located = _locate_anchor(page, anchor_box, anchor_text, 1.0,
                                     _ocr_lines, min_search=_ANCHOR_SEARCH_MIN)

    captured = {}
    def _cap(_fk, _stage, _pi, bbox, _img, kind):
        captured[kind] = [round(float(v), 5) for v in bbox] if bbox else None

    # Pass the template's landmarks (when provided) so the resolved geometry tracks the
    # page through the SAME registration transform reprocess uses — the admin "preview
    # registration across docs" overlay then shows where each box ACTUALLY lands on a
    # shifted scan. None/empty -> no registration (the per-field anchor path), as before.
    res = extract_with_mappings([page], [mapping], field_patterns=field_patterns,
                                slice_capture=_cap, template_landmarks=template_landmarks,
                                registration_enabled=bool(template_landmarks))
    val = res.get(mapping.get("field_key")) or {}

    # Show the located LABEL box (not the drawn search region) so the operator sees
    # the anchor where it ACTUALLY landed — unless it was a merged-row match the
    # relocation would refuse anyway (then we have no trustworthy anchor position).
    anchor_resolved = None
    if located and not _located_too_wide(anchor_box, located):
        lb = located.get("label_box") or located
        anchor_resolved = [round(float(lb[k]), 5) for k in ("x_norm", "y_norm", "w_norm", "h_norm")]

    return {
        "value":      val.get("value"),
        "confidence": val.get("confidence"),
        "method":     val.get("method"),
        "anchor_box": anchor_resolved,
        # Prefer the WINNING rung's own read box (threaded out via target_geom) over
        # the last-captured crop — every rung captures kind="target", incl. a rung
        # whose value was later rejected, so captured['target'] could be a non-winning
        # box one row off the answer. Fall back to it only if no rung tagged its box.
        "target_box": val.get("target_geom") or captured.get("target"),
    }


def _fit_page_transform(page, landmarks, ocr_lines_fn, line_cache=None):
    """Locate each taught landmark on THIS page and fit a similarity transform
    mapping taught centroids -> located centroids. Returns a registration.Transform
    or None (too few/poor correspondences -> caller falls through). Reuses
    _locate_anchor — the SAME image_to_data the anchor path already runs — so the
    fit adds no OCR beyond locating the landmark words. `line_cache` shares the
    per-page OCR with the per-field locates (each landmark's page-wide fallback
    otherwise re-ran a full-page pass)."""
    src, dst = [], []
    for lm in landmarks:
        try:
            box = {"x_norm": float(lm["x_norm"]), "y_norm": float(lm["y_norm"]),
                   "w_norm": float(lm["w_norm"]), "h_norm": float(lm["h_norm"])}
        except (KeyError, TypeError, ValueError):
            continue
        text = lm.get("label_text")
        found = _locate_anchor(page, box, text, 0.0, ocr_lines_fn,
                               min_search=_ANCHOR_SEARCH_MIN, line_cache=line_cache)
        if not (found and found.get("matched_text") is not None):
            found = _locate_anchor(page, box, text, 1.0, ocr_lines_fn,
                                   min_search=_ANCHOR_SEARCH_MIN, line_cache=line_cache)
        if not (found and found.get("matched_text") is not None):
            continue
        src.append([box["x_norm"] + box["w_norm"] / 2.0,
                    box["y_norm"] + box["h_norm"] / 2.0])
        dst.append([found["x_norm"] + found["w_norm"] / 2.0,
                    found["y_norm"] + found["h_norm"] / 2.0])
    if len(src) < 2:
        return None
    return registration.fit_transform(src, dst, kind="similarity")


# ── Per-mapping resolution ────────────────────────────────────────────────────

def _format_rejects(text, field_key, format_lookup):
    """True when a LEARNED format exists for this field and `text` doesn't match
    it — the universal, label-agnostic failsafe.

    Conservative by construction: only constrains a field once it HAS a learned
    format (build_format_class_index requires ≥3 confirmed values and drops
    free-text/varied groups), and only when a lookup was supplied. Otherwise
    returns False (pass through), so a brand-new template/field is never
    rejected until it has actually learned its shape — and as a new but genuine
    value shape recurs and is confirmed, the count-gated shape model adds it to
    the accepted set, so the system keeps working for ANY future document."""
    if not text or format_lookup is None:
        return False
    try:
        entry = format_lookup(field_key)
    except Exception:
        return False
    if not entry:
        return False
    return _check_learned_format(str(text), entry) is not None


def _salvage_date_value(text, val_type):
    """Rescue a real date embedded in noisy OCR (whitespace around separators, or a
    date sitting inside surrounding junk) — reusing validator.salvage_date, the
    SAME recovery Stage 4 already applies to keyword/anchor dates. Used only as a
    FALLBACK when the crop has already failed the strict date credibility gate, so
    Stage 0.5 normalises and keeps a salvageable "27 -05- 2026" instead of dropping
    the field (the observed worksheet "Date: Not found").

    Returns the normalised DD-MM-YYYY date, or None when nothing date-shaped is
    present. Lazy import mirrors the module's other cross-stage imports; no-op for
    non-date fields. Generalises to EVERY template's date field, not one layout.

    Limitation (intentional): salvage handles spacing / embedded-junk dates, NOT
    glyph misreads (e.g. a year OCR'd as "202G") — those still fall to review."""
    if not text or val_type != 'date':
        return None
    try:
        from extraction import validator
        d = validator.salvage_date(text)
    except Exception:
        return None
    return d.strftime("%d-%m-%Y") if d else None


def _gate_value(text, val_type, field_key, validation_patterns, format_lookup,
                shape_mode='drop', ocr_conf=None):
    """Shared accept/reject (+ date salvage) for a crop read, used by the
    absolute-target fast path, the anchor-derived path AND the drift fallback so
    all three apply IDENTICAL regex/type gating (the sequence was previously
    duplicated).

    Order:
      1. date-salvage FALLBACK (Fix C1) — when a date crop fails the strict date
         credibility gate, rescue/normalise it via validator.salvage_date;
      2. _crop_is_credible — the value must match the field's validation pattern
         (free-text only rejects obvious debris). ALWAYS enforced — this is the
         field's REGEX/TYPE qualification, the only thing a manual anchor must
         pass to win.
      3. _format_rejects — the LEARNED per-(supplier,doctype,field) SHAPE check.
         This is statistical history, NOT the field's type, so its severity is
         governed by `shape_mode` (a manual anchor is an explicit human override
         of that history and must not be vetoed by it):
           'ignore' — skip the learned-shape check entirely. Used for the
                      ABSOLUTE drawn-box read: the operator's own box on a
                      non-drifted page reads exactly what they validated, and it
                      cannot drift into a neighbouring column, so regex/type alone
                      is the correct (and OCR-safe) qualifier.
           'flag'   — apply the check but DON'T drop on mismatch; return
                      shape_warn=True so the caller keeps the value, caps its
                      confidence and forces review. Used for the DERIVED rungs
                      (registration / single-label relocation), where a type-valid
                      value can be a wrong-column bleed — surface it for review
                      instead of silently committing OR silently dropping it.
           'drop'   — legacy hard reject on mismatch (default; kept for safety).

    Returns (value, salvaged, shape_warn); (None, False, False) when REJECTED by
    regex/type (step 1-2) or by a 'drop'-mode learned-shape mismatch."""
    if not text:
        return None, False, False
    salvaged = False
    if val_type == 'date' and not _crop_is_credible(text, val_type, validation_patterns):
        rescued = _salvage_date_value(text, val_type)
        if rescued:
            text, salvaged = rescued, True
    if not _crop_is_credible(text, val_type, validation_patterns):
        return None, False, False
    # Free-text OCR-debris guard: a mis-aligned or low-quality crop on a name/
    # address field returns fragmented junk ("aan EE ..... 4 4.3 Fs . J... .")
    # that scrapes past the lax free-text credibility check and commits. Reject it
    # so the caller falls through to registration/relocation (or omits the field)
    # rather than persisting garbage. Typed fields have their own strict pattern,
    # so this only applies to free-text (val_type falsy).
    if not val_type and _is_ocr_debris(text):
        return None, False, False
    # Name-quality gate (Part 3 mirror): a NAME/company/address mapping that read a
    # garbled MULTI-WORD value is OCR junk, not a real name — reject so a credible
    # keyword/hint can fill it instead of persisting garbage. Single-token brands
    # ("3M") aren't judged. Same rule as anchor.py. See extraction/value_quality.py.
    if not val_type and field_key and len(str(text).split()) >= 2:
        from extraction.value_quality import is_name_like_field, name_quality
        if is_name_like_field(field_key) and name_quality(text) < 0.5:
            return None, False, False
    # Free-text OCR-CONFIDENCE floor (Stage C — parity with Stage 2's _strict_credible):
    # a drawn-box read whose mean confidence is below _FREE_TEXT_RESCUE_CONF is a
    # clipped/drifted crop whose garbage clears the loose free-text credibility (there's
    # no regex to catch it). Reject so the caller defers to the drift-correcting rungs
    # (single-label relocation / registration), exactly as Stage 2 routes a low-conf
    # rigid read to its inline harvest — and so a low-conf Stage 0.5 read can't WIN the
    # engine merge over the correct value. ocr_conf is threaded ONLY from the ABSOLUTE
    # drawn-box read (the rigid fast path); the derived/inline/registration rungs pass
    # None -> no floor on the rescue itself, so a clean read and every other rung stay
    # byte-identical. Free-text only (structured trusts its regex).
    if not val_type and ocr_conf is not None and ocr_conf < _FREE_TEXT_RESCUE_CONF:
        return None, False, False
    shape_warn = False
    # A field whose FORMAT is fully defined by its own precise validator/normaliser
    # (date, currency, MAC, IP — already qualified by _crop_is_credible above) must NOT
    # ALSO be vetoed/flagged by the learned-SHAPE statistics: those values vary
    # legitimately (every device a different IP, every doc a different date/amount), so a
    # "differs from the usual format" flag on a type-valid value is a false positive. CODE
    # types (alphanumeric/reference/job_reference) keep the shape check — that's where a
    # wrong-column bleed of the right shape actually happens.
    if (shape_mode != 'ignore' and val_type not in _SELF_VALIDATING_TYPES
            and _format_rejects(text, field_key, format_lookup)):
        if shape_mode == 'flag':
            shape_warn = True
        else:
            return None, False, False
    return text, salvaged, shape_warn


def _mapping_result(value, full_confidence, expanded, salvaged, anchor, shape_warn=False,
                    ocr_conf=None, val_type=None, geom=None):
    """Build a Stage 0.5 result dict with the shared confidence tiers used by the
    absolute fast path and the anchor-derived path. `full_confidence` selects the
    90 (anchor located / anchor_text present) vs 78 (no label) base; `expanded`
    discounts a widened-retry read; `salvaged` (a date rescued from junk) caps
    confidence so it can't outrank a clean Stage 1/2 read, and tags the method.
    `shape_warn` (a type-valid DERIVED-rung read that differs from the learned
    shape) caps confidence, tags the method `_shapewarn` and attaches a review
    note — the value is kept (manual authority) but surfaced for verification.
    `ocr_conf` (the read's mean word confidence, when the ladder captured it) caps a
    FREE-TEXT value's confidence at ocr_conf+5 — mirroring anchor.py — so a garbled crop
    ("504 Ald Unkesand Band 20|0U0U…") scores by its real read quality (~70 -> review)
    instead of the synthetic 90. SCOPED to free-text: a structured value already validated
    by its regex/type is NOT capped (Tesseract under-reads dashed refs)."""
    confidence = 90 if full_confidence else 78
    if expanded:
        confidence -= 12
    method = "template_mapping_expanded" if expanded else "template_mapping"
    if salvaged:
        confidence = min(confidence, 70)
        method += "_salvaged"
    # Free-text confidence shaping from the real OCR mean (anchor.py parity): a garbled
    # read can no longer commit at a synthetic 90; structured (regex-validated) fields
    # are exempt because Tesseract under-reads their dashed/spaced digit groups.
    if ocr_conf is not None and val_type in (None, "text", "multiline_text"):
        confidence = min(confidence, int(ocr_conf) + 5)
    result = {
        "value":      value,
        "confidence": max(50, min(96, confidence)),
        "method":     method,
        "anchor":     anchor,
    }
    if shape_warn:
        result["confidence"] = min(result["confidence"], 70)
        result["method"] += "_shapewarn"
        result["validation_note"] = _SHAPE_WARN_NOTE
    # Diagnostic only: carry the box this rung actually READ so resolve_geometry can
    # show the WINNING rung's box (not the last-captured, maybe-rejected, crop). Set
    # ONLY in diagnostic/preview mode (callers pass geom only when slice_capture is
    # active), so a normal extraction result dict is byte-identical (no extra key).
    if geom is not None:
        result["target_geom"] = geom
    return result


def _is_ocr_debris(text):
    """True when a FREE-TEXT read is fragmented OCR junk rather than a real
    name/address. Signals: the OCR replacement char (failed glyphs), or — for a
    multi-token read — most tokens being single chars or mostly-punctuation
    ("aan EE ..... 4 4.3 Fs . J... ."). Conservative: short reads (<4 tokens) are
    never judged, so normal short values pass; a token counts as junk only if it
    is ≤1 char or less than half alphanumeric."""
    if not text:
        return False
    if '�' in text:
        return True
    toks = text.split()
    if len(toks) < 4:
        return False
    def _junk(t):
        return len(t) <= 1 or (sum(c.isalnum() for c in t) / len(t)) < 0.5
    return sum(1 for t in toks if _junk(t)) >= len(toks) * 0.5


def _located_too_wide(anchor_box, located):
    """True when a located 'label' spans far more than the operator's drawn anchor
    box — i.e. it is a whole OCR'd ROW, not a tight caption. Cross-column form
    layouts merge "Ticket No. … Work Address …" into one OCR line, so a page-wide
    label search matches the entire row with a left-anchored box; relocating the
    value off that left edge lands in the wrong column (garbage). Refuse to relocate
    off such a match. Threshold scales with the drawn box (≥2.5× its width) but
    never below an absolute 0.30 of page width (no single field label is that wide)."""
    if not located:
        return False
    w = located.get("w_norm") or 0.0
    return w > max(0.30, (anchor_box.get("w_norm") or 0.0) * 2.5)


def _label_drifted(anchor_box, located):
    """True when the located anchor LABEL has moved off its taught position beyond
    a per-axis tolerance — the signal that the page has DRIFTED (e.g. a cropped vs
    uncropped scan shifts every row down), so the STATIONARY drawn target box now
    covers a neighbouring line and must not be trusted. Compares box CENTRES (the
    label sits roughly centred in the drawn anchor box, so on a non-drifted page
    the located centre ≈ the drawn-box centre regardless of the label's inset);
    tolerance is half the drawn box's own size per axis (its natural "still on this
    row/column?" band), floored by _DRIFT_FLOOR, so it auto-scales with no
    per-document tuning. The VERTICAL band ALSO takes half the LOCATED line height
    into account: a label-ABOVE mapping draws a SHORT anchor box, so against the
    fixed floor alone a tall-font / low-res scan's within-line jitter could exceed it
    and false-flag a row move (then a needless relocation). Tying tol_y to the line
    actually read here means "drifted" stays "moved roughly a row" regardless of
    font size, while a true one-line shift (≥ a line height) still trips it. (Inline
    key/value rows don't depend on this — the harvest fires on inline_value directly.)
    Conservative: requires a GENUINE label match — a proximity-only locate
    (matched_text None) never counts as drift, so a blank / unfound label keeps
    today's absolute-first behaviour."""
    if not located or located.get("matched_text") is None:
        return False
    def _cx(b): return (b.get("x_norm") or 0.0) + (b.get("w_norm") or 0.0) / 2.0
    def _cy(b): return (b.get("y_norm") or 0.0) + (b.get("h_norm") or 0.0) / 2.0
    tol_x = max((anchor_box.get("w_norm") or 0.0) / 2.0, _DRIFT_FLOOR)
    tol_y = max((anchor_box.get("h_norm") or 0.0) / 2.0,
                (located.get("h_norm") or 0.0) / 2.0, _DRIFT_FLOOR)
    return abs(_cx(located) - _cx(anchor_box)) > tol_x \
        or abs(_cy(located) - _cy(anchor_box)) > tol_y


def _relocate_and_read(page, mapping, anchor_box, target_box, located, val_type,
                       ocr_text_fn, expansion, validation_patterns, format_lookup,
                       slice_capture, page_idx, field_key):
    """Derive the value crop from where the anchor label ACTUALLY landed
    (located + drift-invariant stored offset, inset-corrected) and read it. Shared
    by the early drift branch and the late single-label fallback in _extract_one.
    Returns a Stage 0.5 result dict, or None if the relocated crop fails the gate.

    Two paths, in order (parity with Stage 2 anchor.py):
      1. INLINE HARVEST — in a key/value row the value shares the located label's OCR
         line ("label …gap… value") and sits in a far column a geometric crop can't
         reach, so read it STRAIGHT off the line (`located['inline_value']`), held to
         the SAME gate as a crop read. THIS is what makes "Ticket No.  2605-0769-1"
         read the ref, not the row above — and it was entirely missing from Stage 0.5.
      2. GEOMETRIC DERIVATION — value not on the label's line (label-above layouts):
         seat a crop at located-label-origin + stored offset. Uses the TIGHT label box
         (`located['label_box']`), NOT the whole OCR line (which overshoots a "label
         …gap… value" row — the root of the relocation silently deriving the wrong row).

    The stored offset is BOX-origin → BOX-origin (saveMapping records target − anchor
    from the drawn box corners); the inset re-derives the located label's box-origin
    (label ≈ centred in the drawn anchor box) so the offset applies origin-to-origin
    (else leading glyphs clip, "PROFILE"→"ROFILE"). Returns a result dict or None."""
    dx = mapping.get("offset_dx_norm") or 0.0
    dy = mapping.get("offset_dy_norm") or 0.0

    def _geometric():
        # GEOMETRIC DERIVATION (RIGID OFFSET): seat the value box at the LOCATED label's
        # origin + the stored label→value offset, with the operator's DRAWN dimensions —
        # "20px across, 2px down" STAYS 20px across, 2px down. This is what the operator
        # drew; the value moves rigidly WITH the label, it does not slide with OCR
        # line-segmentation. Off the tight LABEL box (falls back to the whole line only
        # when no label_box, and only then does _located_too_wide guard it).
        lb = located.get("label_box")
        if lb is None:
            if _located_too_wide(anchor_box, located):
                return None
            lb = located
        inset_x = max(0.0, (anchor_box["w_norm"] - (lb.get("w_norm") or 0.0)) / 2.0)
        inset_y = max(0.0, (anchor_box["h_norm"] - (lb.get("h_norm") or 0.0)) / 2.0)
        derived_target = {
            "x_norm": _clamp01(lb["x_norm"] - inset_x + dx),
            "y_norm": _clamp01(lb["y_norm"] - inset_y + dy),
            "w_norm": target_box["w_norm"],
            "h_norm": target_box["h_norm"],
        }
        _cap = ((lambda c: slice_capture(field_key, "template_mapping", page_idx,
                   (derived_target["x_norm"], derived_target["y_norm"],
                    derived_target["w_norm"], derived_target["h_norm"]), c, "target")) if slice_capture else None)
        _d_meta = {}
        text = _crop_and_ocr(page, derived_target, val_type, ocr_text_fn, capture=_cap, meta=_d_meta)
        expanded = False
        if not text and expansion > 0:
            text = _crop_and_ocr(page, _expand_box(derived_target, expansion), val_type, ocr_text_fn, meta=_d_meta)
            expanded = bool(text)
        # DERIVED rung (label-relocated crop): regex/type is a hard gate; a learned-
        # shape mismatch flags-and-keeps rather than drops (the rung where column-bleed
        # actually happens).
        text, salvaged, shapewarn = _gate_value(
            text, val_type, field_key, validation_patterns, format_lookup, shape_mode='flag')
        if not text:
            return None
        return _mapping_result(
            text,
            located.get("matched_text") is not None and bool(mapping.get("anchor_text")),
            expanded, salvaged, mapping.get("anchor_text") or field_key,
            shape_warn=shapewarn, ocr_conf=_d_meta.get('conf'), val_type=val_type,
            geom=_box_list(derived_target) if slice_capture else None)

    def _inline():
        # INLINE HARVEST off the located label's OWN line (no extra OCR — the line was
        # already read during the locate). Reads the value words that follow the label on
        # the SAME line. Robust to a value in a FAR column the drawn box width can't reach,
        # but it 'slides' with OCR line-segmentation — so it is the FALLBACK to the rigid
        # geometric read above (and the PRIMARY read only for a legacy offset-less mapping).
        iv = located.get("inline_value")
        if not iv:
            return None
        hv = _clean_value(iv, val_type)
        if hv and val_type == "alphanumeric" and " " in hv:
            hv = hv.split()[0]          # a code column is one token; drop trailing captions
        hv, iv_salvaged, iv_shapewarn = _gate_value(
            hv, val_type, field_key, validation_patterns, format_lookup, shape_mode='flag')
        if not hv:
            return None
        ib = located.get("inline_box")
        if slice_capture and ib:
            try:
                pw, ph = page.size
                _icrop = page.crop((int(ib["x_norm"] * pw), int(ib["y_norm"] * ph),
                                    int((ib["x_norm"] + ib["w_norm"]) * pw),
                                    int((ib["y_norm"] + ib["h_norm"]) * ph)))
                slice_capture(field_key, "template_mapping", page_idx,
                              (ib["x_norm"], ib["y_norm"], ib["w_norm"], ib["h_norm"]),
                              _icrop, "target")
            except Exception:
                pass                # dev-only; never disrupt extraction
        return _mapping_result(
            hv, located.get("matched_text") is not None and bool(mapping.get("anchor_text")),
            False, iv_salvaged, mapping.get("anchor_text") or field_key,
            shape_warn=iv_shapewarn, val_type=val_type,
            geom=_box_list(ib) if (slice_capture and ib) else None)

    # RIGID OFFSET PRIMARY (the operator's model): when the mapping stored a label→value
    # offset, the value box follows the located label by that EXACT offset + drawn
    # dimensions — geometric read FIRST; the line harvest is only the fallback when the
    # rigid read fails its gate (a far column / an imperfect offset). A LEGACY mapping
    # with NO stored offset has no rigid link, so the line harvest stays its primary read.
    if dx or dy:
        return _geometric() or _inline()
    return _inline() or _geometric()


def _read_registration(page, mapping, target_box, val_type, ocr_text_fn, expansion,
                       page_transform, validation_patterns, format_lookup,
                       slice_capture, page_idx, field_key):
    """"Register, then read": map the taught target box THROUGH the fitted page
    transform and read there, so the value follows the page's actual geometry
    (translation+scale+rotation), not a single-label guess. Returns a Stage 0.5
    result dict (method template_registration[_expanded][_salvaged][_shapewarn]) or
    None when the transform-mapped crop fails the gate. Shared by the registration
    ARBITER (drift detected via box_divergence before the absolute read commits)
    and the FALLBACK rung (reached when the absolute read found nothing credible).
    Confidence reflects the fit quality. DERIVED rung → shape_mode='flag' (a learned
    -shape mismatch is kept+capped+noted for review, not dropped or silently kept)."""
    reg_box = page_transform.apply_box(target_box)
    _rcap = ((lambda c: slice_capture(field_key, "template_registration", page_idx,
               (reg_box["x_norm"], reg_box["y_norm"], reg_box["w_norm"], reg_box["h_norm"]),
               c, "target")) if slice_capture else None)
    rtext = _crop_and_ocr(page, reg_box, val_type, ocr_text_fn, capture=_rcap)
    r_expanded = False
    if not rtext and expansion > 0:
        rtext = _crop_and_ocr(page, _expand_box(reg_box, expansion), val_type, ocr_text_fn)
        r_expanded = bool(rtext)
    rtext, r_salvaged, r_shapewarn = _gate_value(
        rtext, val_type, field_key, validation_patterns, format_lookup, shape_mode='flag')
    if not rtext:
        return None
    conf = registration.registration_confidence(page_transform)
    if r_expanded:
        conf -= 12
    method = "template_registration_expanded" if r_expanded else "template_registration"
    if r_salvaged:
        conf = min(conf, 70)
        method += "_salvaged"
    result = {
        "value":      rtext,
        "confidence": max(50, min(96, conf)),
        "method":     method,
        "anchor":     mapping.get("anchor_text") or field_key,
    }
    if slice_capture:                       # diagnostic: the registered box this rung read
        result["target_geom"] = _box_list(reg_box)
    if r_shapewarn:
        result["confidence"] = min(result["confidence"], 70)
        result["method"] += "_shapewarn"
        result["validation_note"] = _SHAPE_WARN_NOTE
    return result


def _extract_one(page, mapping, field_patterns, ocr_lines_fn, ocr_text_fn,
                 located=_UNSET, page_transform=None,
                 slice_capture=None, page_idx=0,
                 validation_patterns=None, format_lookup=None, line_cache=None):
    anchor_box = _norm_box(mapping, "anchor")
    target_box = _norm_box(mapping, "target")
    if not anchor_box or not target_box:
        return None

    expansion   = float(mapping.get("search_expansion") or 0.0)
    anchor_text = mapping.get("anchor_text")
    field_key   = mapping.get("field_key", "")
    val_type    = (field_patterns or {}).get(field_key, {}).get("validation")

    # ── FAST PATH: read the EXACT box the operator drew ───────────────────────
    # The drawn target box is what the Template Wizard's live zone-OCR (region.py)
    # read when the field was taught, so on a page that has NOT drifted it reads
    # the value cleanly — exactly what the operator saw and validated. TRUST the
    # saved coordinates FIRST (mirroring anchor.py's rigid-crop-then-relocate
    # model); only when this read fails the shared credibility/format/date-salvage
    # gate do we fall through to anchor relocation. No offset/inset arithmetic
    # happens here, so this path cannot reintroduce the leading-glyph inset clip
    # the derived path below corrects for. THIS is what makes first-instance
    # extraction match the live "targeted selection": previously a located anchor
    # ALWAYS re-derived the crop and the drawn box was never read on a clean page.
    _tcap = ((lambda c: slice_capture(field_key, "template_mapping", page_idx,
               (target_box["x_norm"], target_box["y_norm"],
                target_box["w_norm"], target_box["h_norm"]), c, "target")) if slice_capture else None)
    _abs_meta = {}
    abs_text = _crop_and_ocr(page, target_box, val_type, ocr_text_fn, capture=_tcap, meta=_abs_meta)
    abs_expanded = False
    if not abs_text and expansion > 0:
        abs_text = _crop_and_ocr(page, _expand_box(target_box, expansion), val_type, ocr_text_fn, meta=_abs_meta)
        abs_expanded = bool(abs_text)
    # ABSOLUTE drawn-box read: qualify on the field's REGEX/TYPE only
    # (shape_mode='ignore'). A manual anchor is an explicit human instruction —
    # it must win on type validity even when the operator is CORRECTING a field
    # whose learned history now disagrees. A stationary box can't drift into a
    # neighbour, so the learned-shape veto added no safety here, only the bug:
    # it silently dropped a type-valid manual value and let the wrong auto value win.
    abs_text, abs_salvaged, _ = _gate_value(abs_text, val_type, field_key,
                                            validation_patterns, format_lookup,
                                            shape_mode='ignore', ocr_conf=_abs_meta.get('conf'))
    # ── DRIFT GUARD (before trusting the stationary drawn box) ────────────────
    # Only relevant when the absolute box DID read a credible value (`abs_text`):
    # on a shifted page (e.g. a cropped sample vs an uncropped reprocess pushes
    # every row down) that value is a credible-but-WRONG neighbouring line, which
    # shape_mode='ignore' cannot catch — so it would otherwise commit here. If a
    # REAL anchor label is found displaced beyond tolerance, the page has drifted;
    # the stored offset is drift-invariant, so re-derive the value from the label's
    # ACTUAL position and prefer it. The pre-cached `located` is a LOCAL search, so
    # a large shift can miss it — only THEN do one page-wide locate (so a clean
    # page, where the local locate already found the label at its spot, pays no
    # extra OCR). Fires ONLY on a genuine displaced match (anchor_text present,
    # matched_text set); blank-label / unfound paths fall through unchanged. A
    # failed relocation also falls through (no worse than today).
    # ANCHOR-OFFSET LINK FIRST: when this field's OWN anchor label is located, the
    # value sits at the label's position + the stored offset — a LOCAL, rigid
    # label→value link that is strictly more reliable than a global page transform
    # (a poor landmark fit drifts boxes per-region, floating the value off a
    # correctly-anchored label: the "anchor and data point aren't linked" bug).
    #   • label found + DISPLACED  → re-derive via the stored offset and win;
    #   • label found + at its spot → the absolute read already IS that anchored read,
    #                                 so mark it stable and let it stand.
    anchor_stable = False
    if abs_text and anchor_text and located is not _UNSET:
        drift_located = located or _locate_anchor(
            page, anchor_box, anchor_text, 1.0, ocr_lines_fn,
            min_search=_ANCHOR_SEARCH_MIN, line_cache=line_cache)
        # Prefer the rigid label→value read over the stationary drawn box ONLY when the
        # page has actually DRIFTED (the label is found displaced beyond tolerance). On a
        # NON-drifted page the operator's drawn box already sits on the value, so the clean
        # absolute read it produced — the same one the live draw tool reads at 100% — must
        # STAND. (Previously this also fired "regardless of drift" whenever the value was
        # inline on the label's row, i.e. every key/value layout — which re-read the whole
        # OCR LINE and could replace a clean box read with a garbled line read, e.g.
        # "Beaumont Care Homes Ltd - Comber" → "pantionahe MUGS Liu COTVCE". Genuine drift
        # that the per-label test misses is caught by the REGISTRATION ARBITER just below.)
        if (drift_located and drift_located.get("matched_text") is not None
                and _label_drifted(anchor_box, drift_located)):
            relocated = _relocate_and_read(page, mapping, anchor_box, target_box,
                                           drift_located, val_type, ocr_text_fn,
                                           expansion, validation_patterns,
                                           format_lookup, slice_capture, page_idx,
                                           field_key)
            if relocated:
                return relocated
        elif drift_located:
            anchor_stable = True
    # ── REGISTRATION ARBITER (global page transform) — FALLBACK ONLY ────────────
    # Fires ONLY when the anchor is NOT a usable local signal (not found, or a
    # too-wide merged-row match the relocation refused → anchor_stable stays False).
    # A fitted page transform is then the global drift signal: if it says the taught
    # target box maps to a MEANINGFULLY moved position (box_divergence beyond the
    # same "still on this row?" band _label_drifted uses), the stationary absolute
    # read is on the wrong row — a credible-but-WRONG type-valid neighbour that
    # shape_mode='ignore' can't catch — so prefer the registration read. A
    # correctly-anchored value (anchor_stable) is NEVER overridden by the transform.
    # Clean pages → divergence ≈ 0 → arbiter never fires → the absolute fast path
    # below is byte-identical. A failed reg read falls through.
    if (abs_text and page_transform is not None and not anchor_stable
            and registration.box_divergence(page_transform, target_box)
                > max(target_box["h_norm"] * 0.5, _DRIFT_FLOOR)):
        reg = _read_registration(page, mapping, target_box, val_type, ocr_text_fn,
                                 expansion, page_transform, validation_patterns,
                                 format_lookup, slice_capture, page_idx, field_key)
        if reg:
            return reg
    if abs_text:
        return _mapping_result(abs_text, bool(mapping.get("anchor_text")),
                               abs_expanded, abs_salvaged,
                               mapping.get("anchor_text") or field_key,
                               ocr_conf=_abs_meta.get('conf'), val_type=val_type,
                               geom=_box_list(target_box) if slice_capture else None)

    # ── SINGLE-LABEL LOCAL REFINEMENT (anchor + stored offset) — PREFERRED ──────
    # The drawn box read nothing credible. Find THIS field's OWN label and derive
    # the value from where the label ACTUALLY landed (located + the drift-invariant
    # stored offset). This now runs BEFORE the global page transform: when the
    # anchor is findable, the rigid label→value link must win — a poor landmark fit
    # otherwise floats the value off a correctly-anchored label (the "anchor and
    # data point aren't linked" bug, abs-empty path). Mirrors the arbiter precedence
    # above (anchor first, transform fallback).
    if located is _UNSET:
        located = _locate_anchor(page, anchor_box, anchor_text, expansion,
                                 ocr_lines_fn, min_search=_ANCHOR_SEARCH_MIN,
                                 line_cache=line_cache)
    # Page-wide relocation ("try again to actually FIND the label"): when the
    # label isn't in the drawn box ± local margin — a cropped/heavily-shifted
    # scan moves it out — search the WHOLE page for the distinctive label. The
    # target is still derived from where the label ACTUALLY is, so the value
    # follows the label however far it moved. Guarded by the fuzzy threshold and
    # only attempted when a label needle exists. Generic to every template.
    if not located and anchor_text:
        located = _locate_anchor(page, anchor_box, anchor_text, 1.0,
                                 ocr_lines_fn, min_search=_ANCHOR_SEARCH_MIN,
                                 line_cache=line_cache)
    if located:
        # Derive the value from where the anchor label ACTUALLY landed — handles the
        # anchor having drifted since the sample doc. Same helper the early drift
        # guard above uses; returns the relocated read or None (gate failed).
        relocated = _relocate_and_read(page, mapping, anchor_box, target_box, located,
                                       val_type, ocr_text_fn, expansion, validation_patterns,
                                       format_lookup, slice_capture, page_idx, field_key)
        if relocated:
            return relocated

    # ── REGISTRATION FALLBACK ("register, then read") — LAST RESORT ─────────────
    # Only NOW, when the label couldn't be found or its relocation failed the gate,
    # map the taught target box through the fitted transform and read there. Falls
    # through to None (field omitted) if the transform read doesn't clear the gates.
    if page_transform is not None:
        reg = _read_registration(page, mapping, target_box, val_type, ocr_text_fn,
                                 expansion, page_transform, validation_patterns,
                                 format_lookup, slice_capture, page_idx, field_key)
        if reg:
            return reg
    return None


# ── Anchor relocation ─────────────────────────────────────────────────────────

def _match_label_run(words, needle):
    """The leading contiguous words on the located line that form the matched
    LABEL, so the trailing VALUE words of a "label …gap… value" key/value row are
    excluded. Grows the run left→right and keeps the SMALLEST run that MAXIMISES
    the label match — a prefix of a multi-word label (e.g. "Serial") scores high
    on ratio() alone but the full "Serial number" scores higher, and adding the
    value words doesn't improve it, so the label-complete run wins. Returns the
    word-dict list, or None when even the best run is below threshold (caller then
    uses the whole-line box, as before)."""
    if not needle or not words:
        return None
    best_k, best_score = 0, -1.0
    for k in range(1, len(words) + 1):
        acc = _normalise(" ".join(wd["text"] for wd in words[:k]))
        s = _label_score(needle, acc)
        if s > best_score + 1e-9:        # strictly better → smaller k keeps ties
            best_score, best_k = s, k
    if best_score < _FUZZY_MATCH_THRESHOLD:
        return None
    return words[:best_k]


def cluster_value_words(words, expect_x=None):
    """Pick the VALUE's own column from the harvested post-label words, so a far
    neighbouring heading/column on the SAME OCR line can't leak into the value.

    The inline-harvest reads a whole Tesseract line (full page width) and takes
    EVERY word after the matched label — so "ABC12345 …gap… DOCUSYS MODEL NAME"
    returns the heading too. The drawn box width is discarded on this path and the
    only downstream guard (clean_crop_segment's 4-space split) misses a 1-3 space
    column boundary. This re-imposes the column boundary by HORIZONTAL GAP: split
    `words` into runs wherever the inter-word gap exceeds a DPI-invariant threshold
    (a true inter-COLUMN gap is several text-heights wide, far larger than a normal
    inter-word space, so a legitimate multi-word value like "Beaumont Care Homes
    Ltd" stays whole), and return the run nearest/after `expect_x` (the located
    label's right edge → the value-adjacent column). Mirrors the renderer's
    nearestLeftCluster. Pure; never empty (single run → that run). Falls back to the
    whole list when word boxes are missing (e.g. a born-digital line with no
    per-word geometry), so behaviour is byte-identical there."""
    ws = [w for w in (words or []) if isinstance(w, dict)]
    if len(ws) <= 1:
        return ws
    try:
        xs = [(float(w["x_norm"]), float(w["w_norm"]), float(w.get("h_norm", 0.0)), w)
              for w in ws]
    except (KeyError, TypeError, ValueError):
        return ws   # incomplete geometry → don't cluster (legacy whole-line join)
    xs.sort(key=lambda t: t[0])
    heights = sorted(h for _, _, h, _ in xs if h > 0)
    med_h = heights[len(heights) // 2] if heights else 0.0
    # Inter-COLUMN gap ≈ several text-heights; a normal inter-word space is a small
    # fraction of one. Tie the break to median word height → DPI/zoom invariant.
    thresh = max(med_h * 1.2, 1e-4)
    clusters = [[xs[0]]]
    for i in range(1, len(xs)):
        px, pw = xs[i - 1][0], xs[i - 1][1]
        if xs[i][0] - (px + pw) > thresh:
            clusters.append([xs[i]])
        else:
            clusters[-1].append(xs[i])
    if len(clusters) == 1:
        return ws   # one column → unchanged
    if expect_x is None:
        chosen = clusters[0]
    else:
        # Prefer the cluster at/after expect_x (the value column adjacent to the
        # label's right edge), nearest first; this drops both a trailing heading and
        # a far right-hand column.
        chosen = min(clusters,
                     key=lambda cl: (0 if cl[0][0] >= expect_x else 1,
                                     abs(cl[0][0] - expect_x)))
    return [t[3] for t in chosen]


def _locate_anchor(page, anchor_box, anchor_text, expansion, ocr_lines_fn,
                   min_search=0.0, capture=None, line_cache=None, confirm_value=None):
    """
    Search the (optionally expanded) drawn anchor region for the stored label
    text and report where it ACTUALLY sits on this page, in page-relative
    normalised coordinates. Returns None when nothing usable is found there —
    the caller's documented signal to fall back to the rest of the pipeline.

    `min_search` floors the search margin (used by callers even when the mapping
    stored no search_expansion) so a tight/misaligned box or a shifted scan still
    finds its label; it widens only WHERE we search — the located position and the
    fuzzy threshold are unchanged, so a wrong nearby label is still rejected.

    `line_cache` (optional, supplied by the orchestrators) memoises the OCR of a
    given crop region by (page, crop_box). Every PAGE-WIDE locate (expansion ≥ 1.0)
    expands+clamps to the SAME full-page crop_box (0,0,1,1) regardless of anchor, so
    without this each landmark-fit and each per-field relocation re-ran a full-page
    image_to_data (~2s each). Caching collapses them to ONE pass per page. The OCR is
    deterministic for a given crop, so reuse is exactly equivalent — read quality is
    unchanged. Skipped when `capture` is set (dev slice trace stays byte-identical).
    """
    eff = max(expansion, min_search)
    search_box = _expand_box(anchor_box, eff) if eff > 0 else dict(anchor_box)
    crop_box = _clamp_box(search_box)
    cache_key = None
    if line_cache is not None and capture is None:
        cache_key = (id(page), round(crop_box["x_norm"], 4), round(crop_box["y_norm"], 4),
                     round(crop_box["w_norm"], 4), round(crop_box["h_norm"], 4))
    if cache_key is not None and cache_key in line_cache:
        lines = line_cache[cache_key]
    else:
        crop = _crop(page, crop_box)
        if crop is None:
            return None
        if capture:
            try: capture(crop)
            except Exception: pass   # dev-only slice capture; never disrupt relocation
        lines = ocr_lines_fn(crop)
        if cache_key is not None:
            line_cache[cache_key] = lines
    if not lines:
        return None

    needle = _normalise(anchor_text) if anchor_text else None
    scored = []
    for line in lines:
        haystack = _normalise(line.get("text", ""))
        if not haystack:
            continue
        scored.append((_label_score(needle, haystack), line))

    if not scored:
        return None
    best_score = max(s for s, _ in scored)
    if needle and best_score < _FUZZY_MATCH_THRESHOLD:
        return None

    # Among EQUALLY-best candidates, prefer the one closest to the original anchor
    # position. For a unique best match this is a no-op (it wins on score, even if
    # the scan shifted it far). It matters only when a label REPEATS on the page
    # with the SAME score: without this a page-wide search could lock onto a far
    # duplicate; with it, the nearest true label is chosen. Only EXACT score ties
    # are decided by proximity — a higher score ALWAYS wins, so a lower-scoring but
    # marginally-closer WRONG label (e.g. "Ticket Type" 0.70 vs "Ticket No." 0.75)
    # can never be picked.
    acx = anchor_box["x_norm"] + anchor_box["w_norm"] / 2.0
    acy = anchor_box["y_norm"] + anchor_box["h_norm"] / 2.0

    def _page_dist(ln):
        cx = crop_box["x_norm"] + (ln["x_norm"] + ln["w_norm"] / 2.0) * crop_box["w_norm"]
        cy = crop_box["y_norm"] + (ln["y_norm"] + ln["h_norm"] / 2.0) * crop_box["h_norm"]
        return math.hypot(cx - acx, cy - acy)

    floor = max(best_score - _SCORE_TIE_EPSILON, (_FUZZY_MATCH_THRESHOLD if needle else 0.0))
    candidates = [(s, ln) for s, ln in scored if s >= floor]
    # VALUE-AGREEMENT: when the caller passes a trustworthy rigid read (confirm_value),
    # prefer the label occurrence whose LINE actually carries that value — even a
    # LOWER-scoring one. A section header "Item Information" scores 1.0 but its
    # neighbour is "Information"; the real row "ttem 1102V03NL1" scores only 0.75
    # (OCR garbled the "Item" label to "ttem") yet carries the taught value. Value
    # agreement is stable where the label OCR is not, so this beats any geometric
    # tie-break. Restricted to fuzzy-threshold occurrences; if NONE carry the value
    # (a genuinely DRIFTED rigid read isn't beside any label — the case the label-lock
    # exists to fix), selection is unchanged and relocation proceeds as before.
    if confirm_value:
        cv = _normalise(str(confirm_value))
        carriers = [(s, ln) for s, ln in scored
                    if s >= _FUZZY_MATCH_THRESHOLD and cv and cv in _normalise(ln.get("text", ""))]
        if carriers:
            candidates = carriers
    chosen_score, best = min(candidates, key=lambda sl: (_page_dist(sl[1]), -sl[0]))

    # Recover the matched LABEL's own sub-box from the line's word boxes, plus any
    # VALUE sharing the line. A key/value row OCRs as "label …gap… value" on ONE
    # line, so the line box (returned in x/y/w/h below) spans BOTH — using it for
    # geometric placement seats the value crop past the value. label_box restores
    # correct geometry (value to the right of the LABEL, not the line) and
    # inline_value lets the caller harvest the value straight off the located line
    # (the only reliable read when the value sits in a far column, not adjacent).
    # Additive: callers that ignore these keys behave exactly as before.
    label_box = None
    inline_value = None
    inline_box = None
    bwords = best.get("words") or []
    run = _match_label_run(bwords, needle) if needle else None
    if run:
        rx1 = min(wd["x_norm"] for wd in run)
        rx2 = max(wd["x_norm"] + wd["w_norm"] for wd in run)
        ry1 = min(wd["y_norm"] for wd in run)
        ry2 = max(wd["y_norm"] + wd["h_norm"] for wd in run)
        label_box = {
            "x_norm": crop_box["x_norm"] + rx1 * crop_box["w_norm"],
            "y_norm": crop_box["y_norm"] + ry1 * crop_box["h_norm"],
            "w_norm": (rx2 - rx1) * crop_box["w_norm"],
            "h_norm": (ry2 - ry1) * crop_box["h_norm"],
        }
        # Clip the harvest to the value's OWN column (drop a far heading/column that
        # shares the OCR line) by horizontal-gap clustering off the label's right edge.
        rest = cluster_value_words(bwords[len(run):], expect_x=rx2)
        if rest:
            inline_value = " ".join(wd["text"] for wd in rest).strip() or None
            # Page-space bbox of the VALUE words (crop-relative → page), so the dev
            # trace can highlight where an inline-harvested value was actually read.
            vx1 = min(wd["x_norm"] for wd in rest)
            vx2 = max(wd["x_norm"] + wd["w_norm"] for wd in rest)
            vy1 = min(wd["y_norm"] for wd in rest)
            vy2 = max(wd["y_norm"] + wd["h_norm"] for wd in rest)
            inline_box = {
                "x_norm": crop_box["x_norm"] + vx1 * crop_box["w_norm"],
                "y_norm": crop_box["y_norm"] + vy1 * crop_box["h_norm"],
                "w_norm": (vx2 - vx1) * crop_box["w_norm"],
                "h_norm": (vy2 - vy1) * crop_box["h_norm"],
            }

    return {
        "x_norm":       crop_box["x_norm"] + best["x_norm"] * crop_box["w_norm"],
        "y_norm":       crop_box["y_norm"] + best["y_norm"] * crop_box["h_norm"],
        "w_norm":       best["w_norm"] * crop_box["w_norm"],
        "h_norm":       best["h_norm"] * crop_box["h_norm"],
        "matched_text": best.get("text") if needle else None,
        "match_score":  chosen_score,
        "label_box":    label_box,
        "inline_value": inline_value,
        "inline_box":   inline_box,
    }


# ── Geometry helpers (pure — independently unit-testable) ────────────────────

def _norm_box(mapping, prefix):
    keys = (f"{prefix}_x_norm", f"{prefix}_y_norm", f"{prefix}_w_norm", f"{prefix}_h_norm")
    values = [mapping.get(k) for k in keys]
    if any(v is None for v in values):
        return None
    x, y, w, h = (float(v) for v in values)
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def _box_list(box):
    """A box dict → the [x, y, w, h] normalised list resolve_geometry's overlay
    expects (rounded to match captured.get('target')). Used to carry the WINNING
    rung's actual read box out on the result (`target_geom`) for the admin preview,
    so the diagnostic box reflects what really won — not the last rung that merely
    captured a (possibly rejected) crop. Returns None for a missing box."""
    if not box:
        return None
    return [round(float(box["x_norm"]), 5), round(float(box["y_norm"]), 5),
            round(float(box["w_norm"]), 5), round(float(box["h_norm"]), 5)]


def _expand_box(box, fraction):
    """Grow a box by `fraction` of the page in every direction, clamped to [0,1]."""
    if not fraction:
        return dict(box)
    x0 = max(0.0, box["x_norm"] - fraction)
    y0 = max(0.0, box["y_norm"] - fraction)
    x1 = min(1.0, box["x_norm"] + box["w_norm"] + fraction)
    y1 = min(1.0, box["y_norm"] + box["h_norm"] + fraction)
    return {"x_norm": x0, "y_norm": y0, "w_norm": max(0.0, x1 - x0), "h_norm": max(0.0, y1 - y0)}


def _clamp_box(box):
    x = _clamp01(box["x_norm"])
    y = _clamp01(box["y_norm"])
    w = max(0.0, min(1.0 - x, box["w_norm"]))
    h = max(0.0, min(1.0 - y, box["h_norm"]))
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def _clamp01(value):
    return max(0.0, min(1.0, value))


def _normalise(text):
    return re.sub(r'\s+', ' ', (text or '')).strip().lower()


def _label_score(needle, haystack):
    """How well the anchor LABEL (`needle`) is present in an OCR line
    (`haystack`), independent of how much extra text the line carries.

    SequenceMatcher.ratio() penalises a longer haystack (2·M/(len_n+len_h)), so
    an anchor box drawn deliberately wider than its label — capturing padding or
    a neighbouring word on the same OCR line — scored below threshold and failed
    to relocate, even on a perfect label match. Instead, measure the fraction of
    the needle found as a contiguous run in the haystack (a substring scores
    1.0), blended with ratio() so a tight exact line still scores high. A
    different nearby label shares little of the needle, so it stays rejected —
    preferring the correct local label without widening the search.

    WORD-BOUNDARY GUARD: plain substring containment is too loose — "total" sits
    inside "subtotal", "date" inside "mandate", "amount" inside "amount due" — so
    a short label would score a PERFECT 1.0 on a DIFFERENT, longer on-page label
    and, on the resulting score tie, be chosen by mere PROXIMITY, silently
    relocating e.g. a Total anchor onto the Subtotal row (variable line-item
    layouts float the totals block, so which is nearer flips per document). A
    whole-needle occurrence counts only when it is NOT glued to a surrounding
    alphanumeric — the same (?<![a-z0-9])…(?![a-z0-9]) guard keyword._label_pattern
    uses. A needle that appears ONLY as a glued sub-token is rejected OUTRIGHT
    (0.0) so its incidental character overlap can't sneak past the threshold via
    ratio() when the real standalone label is absent. This also closes the second
    false-1.0 path: find_longest_match's whole-needle run only reaches 1.0 when
    the needle is a substring, which is now handled here first. A genuine
    boundary-aligned prefix ("serial" of "serial number") still scores 1.0.
    """
    if not needle:
        return 1.0
    # A taught label usually keeps its trailing caption punctuation ("Total:"), but OCR may
    # or may not read the colon. A colon-glued needle DEFEATS the word-boundary guard below
    # when the separator is dropped: "total:" scores a fuzzy 0.83 on BOTH "total" AND
    # "subtotal", tying → proximity silently relocates a Total anchor onto the Subtotal row.
    # Strip the needle's EDGE caption punctuation (but keep a bare "#") so the boundary guard
    # is robust to however OCR read the colon — "total:" → "total" → "subtotal" scores 0.0.
    _core = re.sub(r'^[^a-z0-9#]+|[^a-z0-9#]+$', '', needle)
    if _core:
        needle = _core
    if not haystack:
        return 0.0
    # Boundary-aligned occurrence of the whole needle = a true label hit.
    if re.search(r'(?<![a-z0-9])' + re.escape(needle) + r'(?![a-z0-9])', haystack):
        return 1.0
    # Present, but glued inside a larger token (sub|total) → a false label. Reject
    # so it can neither win a 1.0 tie nor pass threshold on shared characters.
    if needle in haystack:
        return 0.0
    sm = difflib.SequenceMatcher(None, needle, haystack)
    longest = sm.find_longest_match(0, len(needle), 0, len(haystack)).size
    return max(longest / len(needle), sm.ratio())


# ── Image / OCR primitives ────────────────────────────────────────────────────

def _crop(page, box):
    try:
        w, h = page.size
        x1 = int(box["x_norm"] * w)
        y1 = int(box["y_norm"] * h)
        x2 = int((box["x_norm"] + box["w_norm"]) * w)
        y2 = int((box["y_norm"] + box["h_norm"]) * h)
        if x2 <= x1 or y2 <= y1:
            return None
        return page.crop((x1, y1, x2, y2))
    except Exception:
        return None


def _prep(image):
    """
    Same greyscale -> upscale -> autocontrast -> sharpen recipe as
    ocr/region.py and anchor._crop_and_ocr, so OCR behaviour stays consistent
    across every crop-and-read path in the system.
    """
    img = image.convert("L")
    w, h = img.size
    if w < 300:
        scale = max(2, 300 // max(1, w))
        img = img.resize((w * scale, h * scale), Image.LANCZOS)
    else:
        img = img.resize((w * 2, h * 2), Image.LANCZOS)
    img = ImageOps.autocontrast(img, cutoff=2)
    return img.filter(ImageFilter.SHARPEN)


def _ocr_text(image):
    if pytesseract is None:
        return None
    try:
        img = _prep(image)
        text = pytesseract.image_to_string(img, config="--oem 3 --psm 7").strip()
        if not text:
            text = pytesseract.image_to_string(img, config="--oem 3 --psm 6").strip()
        return text or None
    except Exception:
        return None


def _prep_for_lines(image):
    """Prep for the LOCATE (image_to_data line/word boxes) — distinct from _prep, which
    is tuned for reading a small value CROP and UPSCALES x2. The locate routinely runs on
    the WHOLE page, where x2 balloons a 2481px page to ~4962px and image_to_data takes
    ~3.8s. Position-finding only needs enough resolution to MATCH the label/landmark text
    and return NORMALISED boxes, so CAP the width (~1100px ≈ 120 DPI for A4): the full-page
    locate finds the SAME lines in well under half the time (the dominant per-doc cost on
    import AND reprocess). A small region is upscaled so a short label still reads. Boxes
    are normalised to the prepped size in _ocr_lines, so the downscale is geometry-neutral.
    Greyscale + autocontrast, no sharpen (matches the light read)."""
    img = image.convert("L")
    w, h = img.size
    _MAX, _MIN = 1100, 600
    if w > _MAX:
        s = _MAX / w
        img = img.resize((_MAX, max(1, int(h * s))), Image.LANCZOS)
    elif w < _MIN:
        s = max(2, _MIN // max(1, w))
        img = img.resize((w * s, h * s), Image.LANCZOS)
    return ImageOps.autocontrast(img, cutoff=2)


def _ocr_lines(image):
    """
    OCR the crop and group word-level results (image_to_data) into lines by
    (block, paragraph, line), each with crop-relative normalised bounding
    boxes: [{"text","x_norm","y_norm","w_norm","h_norm"}]. Multi-word labels
    like "Invoice Number" then match as a single unit instead of fragmenting.

    Uses _prep_for_lines (caps the width) NOT _prep (x2 upscale): the locate is the
    dominant per-doc OCR cost and only needs to find positions, so it reads a
    width-capped page in <half the time with the same lines. Boxes are normalised to
    the prepped image size below, so the cap is geometry-neutral.
    """
    if pytesseract is None:
        return []
    try:
        img = _prep_for_lines(image)
        w, h = img.size
        if w == 0 or h == 0:
            return []
        data = pytesseract.image_to_data(img, config="--oem 3 --psm 6", output_type=Output.DICT)
    except Exception:
        return []

    groups = {}
    for i in range(len(data.get("text", []))):
        word = (data["text"][i] or "").strip()
        if not word:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        x, y = data["left"][i], data["top"][i]
        ww, hh = data["width"][i], data["height"][i]
        x2, y2 = x + ww, y + hh
        wd = {"text": word, "_x": x, "_y": y, "_w": ww, "_h": hh}
        g = groups.get(key)
        if g is None:
            groups[key] = {"words": [wd], "x1": x, "y1": y, "x2": x2, "y2": y2}
        else:
            g["words"].append(wd)
            g["x1"] = min(g["x1"], x)
            g["y1"] = min(g["y1"], y)
            g["x2"] = max(g["x2"], x2)
            g["y2"] = max(g["y2"], y2)

    lines = []
    for g in groups.values():
        # Per-word boxes (crop-relative normalised) are kept ALONGSIDE the line
        # box so a caller can recover the matched LABEL's own sub-box instead of
        # the whole "label …gap… value" line. Additive — existing line-level keys
        # are unchanged.
        words = [{"text": wd["text"], "x_norm": wd["_x"] / w, "y_norm": wd["_y"] / h,
                  "w_norm": wd["_w"] / w, "h_norm": wd["_h"] / h} for wd in g["words"]]
        lines.append({
            "text":   " ".join(wd["text"] for wd in g["words"]),
            "x_norm": g["x1"] / w,
            "y_norm": g["y1"] / h,
            "w_norm": (g["x2"] - g["x1"]) / w,
            "h_norm": (g["y2"] - g["y1"]) / h,
            "words":  words,
        })
    return lines


def _crop_and_ocr(page, box, val_type, ocr_text_fn, capture=None, meta=None):
    crop = _crop(page, _clamp_box(box))
    if crop is None:
        return None
    if capture:
        try: capture(crop)
        except Exception: pass   # dev-only slice capture; never disrupt OCR
    # The IMAGE-OCR read now goes through the SAME light-first ladder anchor.py and
    # region.py use (Oscar): the unconditional heavy autocontrast+SHARPEN recipe was
    # mangling clean printed lines (a company name -> punctuation soup) — Stage 0.5 was
    # the last crop path still on the heavy-only recipe. The ladder also writes the real
    # OCR confidence into `meta` so _mapping_result can shape it instead of a synthetic
    # constant. A CUSTOM reader (a test stub, or a future text-layer fn) keeps the legacy
    # path untouched, so existing mapping tests are unaffected.
    if ocr_text_fn is _ocr_text:
        try:
            # Pass the page + the (clamped) drawn box so the ladder's free-text preview
            # fast-path can re-crop at the ~108 DPI preview scale the draw tool reads.
            return _ocr_crop_laddered(crop, val_type, verify_fn=None, meta=meta,
                                      page=page, box=_clamp_box(box)) or None
        except Exception:
            return None
    text = ocr_text_fn(crop)
    if not text:
        return None
    cleaned = _clean_value(text, val_type)
    # Same single-token separator repair the Stage 2 anchor crop uses: a serial /
    # reference read as one token can come back with a spurious "/" "\" "|"; re-read
    # the prepped crop as a single word and keep it only if the glyphs are otherwise
    # identical. Reuses anchor._repair_single_token (already cross-imported) so both
    # crop paths behave the same. No-op for multi-word values and date fields, and
    # safe under test stubs (it try/excepts when the crop isn't a real image).
    if cleaned:
        try:
            cleaned = _repair_single_token(_prep(crop), cleaned, val_type)
        except Exception:
            pass
    return cleaned


def _clean_value(text, val_type):
    """Delegates to the SHARED anchor.clean_crop_segment so a drawn target zone is
    cleaned identically to a learned-anchor crop (column-gap split, shape-aware
    postcode/year trim for free-text, trailing-city-comma cut) — one rule across
    both crop paths. See clean_crop_segment for the per-rule rationale."""
    return clean_crop_segment(text, val_type)
