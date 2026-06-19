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
from extraction.anchor import _crop_is_credible, _repair_single_token, clean_crop_segment
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
            min_search=_ANCHOR_SEARCH_MIN, capture=_acap)

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
                    page_images[page_idx], lms, ocr_lines_fn)

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
                               format_lookup=format_lookup)
        if outcome:
            results[field_key] = outcome
    return results


def resolve_geometry(page, mapping, field_patterns=None):
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

    res = extract_with_mappings([page], [mapping], field_patterns=field_patterns,
                                slice_capture=_cap)
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
        "target_box": captured.get("target"),
    }


def _fit_page_transform(page, landmarks, ocr_lines_fn):
    """Locate each taught landmark on THIS page and fit a similarity transform
    mapping taught centroids -> located centroids. Returns a registration.Transform
    or None (too few/poor correspondences -> caller falls through). Reuses
    _locate_anchor — the SAME image_to_data the anchor path already runs — so the
    fit adds no OCR beyond locating the landmark words."""
    src, dst = [], []
    for lm in landmarks:
        try:
            box = {"x_norm": float(lm["x_norm"]), "y_norm": float(lm["y_norm"]),
                   "w_norm": float(lm["w_norm"]), "h_norm": float(lm["h_norm"])}
        except (KeyError, TypeError, ValueError):
            continue
        text = lm.get("label_text")
        found = _locate_anchor(page, box, text, 0.0, ocr_lines_fn,
                               min_search=_ANCHOR_SEARCH_MIN)
        if not (found and found.get("matched_text") is not None):
            found = _locate_anchor(page, box, text, 1.0, ocr_lines_fn,
                                   min_search=_ANCHOR_SEARCH_MIN)
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
                shape_mode='drop'):
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
    shape_warn = False
    if shape_mode != 'ignore' and _format_rejects(text, field_key, format_lookup):
        if shape_mode == 'flag':
            shape_warn = True
        else:
            return None, False, False
    return text, salvaged, shape_warn


def _mapping_result(value, full_confidence, expanded, salvaged, anchor, shape_warn=False):
    """Build a Stage 0.5 result dict with the shared confidence tiers used by the
    absolute fast path and the anchor-derived path. `full_confidence` selects the
    90 (anchor located / anchor_text present) vs 78 (no label) base; `expanded`
    discounts a widened-retry read; `salvaged` (a date rescued from junk) caps
    confidence so it can't outrank a clean Stage 1/2 read, and tags the method.
    `shape_warn` (a type-valid DERIVED-rung read that differs from the learned
    shape) caps confidence, tags the method `_shapewarn` and attaches a review
    note — the value is kept (manual authority) but surfaced for verification."""
    confidence = 90 if full_confidence else 78
    if expanded:
        confidence -= 12
    method = "template_mapping_expanded" if expanded else "template_mapping"
    if salvaged:
        confidence = min(confidence, 70)
        method += "_salvaged"
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
    per-document tuning. Conservative: requires a GENUINE label match — a
    proximity-only locate (matched_text None) never counts as drift, so a blank /
    unfound label keeps today's absolute-first behaviour."""
    if not located or located.get("matched_text") is None:
        return False
    def _cx(b): return (b.get("x_norm") or 0.0) + (b.get("w_norm") or 0.0) / 2.0
    def _cy(b): return (b.get("y_norm") or 0.0) + (b.get("h_norm") or 0.0) / 2.0
    tol_x = max((anchor_box.get("w_norm") or 0.0) / 2.0, _DRIFT_FLOOR)
    tol_y = max((anchor_box.get("h_norm") or 0.0) / 2.0, _DRIFT_FLOOR)
    return abs(_cx(located) - _cx(anchor_box)) > tol_x \
        or abs(_cy(located) - _cy(anchor_box)) > tol_y


def _relocate_and_read(page, mapping, anchor_box, target_box, located, val_type,
                       ocr_text_fn, expansion, validation_patterns, format_lookup,
                       slice_capture, page_idx, field_key):
    """Derive the value crop from where the anchor label ACTUALLY landed
    (located + drift-invariant stored offset, inset-corrected) and read it. Shared
    by the early drift branch and the late single-label fallback in _extract_one.
    Returns a Stage 0.5 result dict, or None if the relocated crop fails the gate.

    The stored offset is BOX-origin → BOX-origin (saveMapping records
    target_x − anchor_x from the admin-drawn box corners), but _locate_anchor
    reports the label's TIGHT OCR word-bbox, inset to the right of / below the drawn
    anchor box. Re-derive the located anchor's box-origin equivalent first (assume
    the label is roughly centred, so the inset ≈ half the width/height slack) so the
    offset is applied origin-to-origin — otherwise leading glyphs get clipped
    ("PROFILE" → "ROFILE"). General to every mapping, not tuned to one template."""
    # Refuse to relocate off a whole-ROW match (cross-column OCR merge) — its
    # left-anchored box would derive a wrong-column crop and read garbage. Better
    # to fall through (early branch) / omit the field (late path) than commit junk.
    if _located_too_wide(anchor_box, located):
        return None
    dx = mapping.get("offset_dx_norm") or 0.0
    dy = mapping.get("offset_dy_norm") or 0.0
    inset_x = max(0.0, (anchor_box["w_norm"] - located["w_norm"]) / 2.0)
    inset_y = max(0.0, (anchor_box["h_norm"] - located["h_norm"]) / 2.0)
    derived_target = {
        "x_norm": _clamp01(located["x_norm"] - inset_x + dx),
        "y_norm": _clamp01(located["y_norm"] - inset_y + dy),
        "w_norm": target_box["w_norm"],
        "h_norm": target_box["h_norm"],
    }

    _cap = ((lambda c: slice_capture(field_key, "template_mapping", page_idx,
               (derived_target["x_norm"], derived_target["y_norm"],
                derived_target["w_norm"], derived_target["h_norm"]), c, "target")) if slice_capture else None)
    text = _crop_and_ocr(page, derived_target, val_type, ocr_text_fn, capture=_cap)
    expanded = False
    if not text and expansion > 0:
        text = _crop_and_ocr(page, _expand_box(derived_target, expansion), val_type, ocr_text_fn)
        expanded = bool(text)

    # DERIVED rung (label-relocated crop): regex/type is a hard gate; a learned-
    # shape mismatch flags-and-keeps rather than drops (this is the rung where
    # column-bleed actually happens).
    text, salvaged, shapewarn = _gate_value(
        text, val_type, field_key, validation_patterns, format_lookup,
        shape_mode='flag')
    if not text:
        return None
    return _mapping_result(
        text,
        located.get("matched_text") is not None and bool(mapping.get("anchor_text")),
        expanded, salvaged, mapping.get("anchor_text") or field_key,
        shape_warn=shapewarn)


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
    if r_shapewarn:
        result["confidence"] = min(result["confidence"], 70)
        result["method"] += "_shapewarn"
        result["validation_note"] = _SHAPE_WARN_NOTE
    return result


def _extract_one(page, mapping, field_patterns, ocr_lines_fn, ocr_text_fn,
                 located=_UNSET, page_transform=None,
                 slice_capture=None, page_idx=0,
                 validation_patterns=None, format_lookup=None):
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
    abs_text = _crop_and_ocr(page, target_box, val_type, ocr_text_fn, capture=_tcap)
    abs_expanded = False
    if not abs_text and expansion > 0:
        abs_text = _crop_and_ocr(page, _expand_box(target_box, expansion), val_type, ocr_text_fn)
        abs_expanded = bool(abs_text)
    # ABSOLUTE drawn-box read: qualify on the field's REGEX/TYPE only
    # (shape_mode='ignore'). A manual anchor is an explicit human instruction —
    # it must win on type validity even when the operator is CORRECTING a field
    # whose learned history now disagrees. A stationary box can't drift into a
    # neighbour, so the learned-shape veto added no safety here, only the bug:
    # it silently dropped a type-valid manual value and let the wrong auto value win.
    abs_text, abs_salvaged, _ = _gate_value(abs_text, val_type, field_key,
                                            validation_patterns, format_lookup,
                                            shape_mode='ignore')
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
    if abs_text and anchor_text and located is not _UNSET:
        drift_located = located or _locate_anchor(
            page, anchor_box, anchor_text, 1.0, ocr_lines_fn,
            min_search=_ANCHOR_SEARCH_MIN)
        if drift_located and _label_drifted(anchor_box, drift_located):
            relocated = _relocate_and_read(page, mapping, anchor_box, target_box,
                                           drift_located, val_type, ocr_text_fn,
                                           expansion, validation_patterns,
                                           format_lookup, slice_capture, page_idx,
                                           field_key)
            if relocated:
                return relocated
    # ── REGISTRATION ARBITER (drift detected by the GLOBAL page transform) ──────
    # The per-field label-drift guard above didn't fire (a generic / merged-row
    # label, or the label wasn't displaced locally), but a fitted page transform
    # is the most reliable, global drift signal. If it says the taught target box
    # maps to a MEANINGFULLY moved position (box_divergence beyond the same
    # "still on this row?" band _label_drifted uses), the stationary absolute read
    # is on the wrong row — a credible-but-WRONG type-valid neighbour that
    # shape_mode='ignore' can't catch — so prefer the registration read. Clean
    # pages → transform ≈ identity → divergence ≈ 0 → arbiter never fires → the
    # absolute fast path below is byte-identical. A failed reg read falls through.
    if (abs_text and page_transform is not None
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
                               mapping.get("anchor_text") or field_key)

    # ── REGISTRATION FALLBACK RUNG ("register, then read"): the drawn box at its
    # stored coords read nothing credible, so map the taught target box through the
    # fitted transform and read there. Sits ABOVE the single-label path; falls
    # through if the transform read doesn't clear the gates. (Same helper the
    # arbiter above uses.)
    if page_transform is not None:
        reg = _read_registration(page, mapping, target_box, val_type, ocr_text_fn,
                                 expansion, page_transform, validation_patterns,
                                 format_lookup, slice_capture, page_idx, field_key)
        if reg:
            return reg

    # ── SINGLE-LABEL LOCAL REFINEMENT: the drawn box read nothing credible and
    # the registration transform (if any) didn't resolve it either. Find the
    # field's own label and derive the value crop from where it ACTUALLY landed
    # (anchor + relative-offset) — the per-field fallback for templates without a
    # usable landmark fit. ─────────────────────────────────────────────────────
    if located is _UNSET:
        located = _locate_anchor(page, anchor_box, anchor_text, expansion,
                                 ocr_lines_fn, min_search=_ANCHOR_SEARCH_MIN)
    # Page-wide relocation ("try again to actually FIND the label"): when the
    # label isn't in the drawn box ± local margin — a cropped/heavily-shifted
    # scan moves it out — search the WHOLE page for the distinctive label. The
    # target is still derived from where the label ACTUALLY is, so the value
    # follows the label however far it moved. Guarded by the fuzzy threshold and
    # only attempted when a label needle exists. Generic to every template.
    if not located and anchor_text:
        located = _locate_anchor(page, anchor_box, anchor_text, 1.0,
                                 ocr_lines_fn, min_search=_ANCHOR_SEARCH_MIN)
    if not located:
        # Nothing located — omit the field (it falls through to the rest of the
        # pipeline / manual review), exactly as before.
        return None

    # Derive the value from where the anchor label ACTUALLY landed — handles the
    # anchor having drifted since the sample doc. Same helper the early drift guard
    # above uses; returns the relocated read or None (gate failed → field omitted).
    return _relocate_and_read(page, mapping, anchor_box, target_box, located,
                              val_type, ocr_text_fn, expansion, validation_patterns,
                              format_lookup, slice_capture, page_idx, field_key)


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


def _locate_anchor(page, anchor_box, anchor_text, expansion, ocr_lines_fn,
                   min_search=0.0, capture=None):
    """
    Search the (optionally expanded) drawn anchor region for the stored label
    text and report where it ACTUALLY sits on this page, in page-relative
    normalised coordinates. Returns None when nothing usable is found there —
    the caller's documented signal to fall back to the rest of the pipeline.

    `min_search` floors the search margin (used by callers even when the mapping
    stored no search_expansion) so a tight/misaligned box or a shifted scan still
    finds its label; it widens only WHERE we search — the located position and the
    fuzzy threshold are unchanged, so a wrong nearby label is still rejected.
    """
    eff = max(expansion, min_search)
    search_box = _expand_box(anchor_box, eff) if eff > 0 else dict(anchor_box)
    crop_box = _clamp_box(search_box)
    crop = _crop(page, crop_box)
    if crop is None:
        return None
    if capture:
        try: capture(crop)
        except Exception: pass   # dev-only slice capture; never disrupt relocation

    lines = ocr_lines_fn(crop)
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
        rest = bwords[len(run):]
        if rest:
            inline_value = " ".join(wd["text"] for wd in rest).strip() or None

    return {
        "x_norm":       crop_box["x_norm"] + best["x_norm"] * crop_box["w_norm"],
        "y_norm":       crop_box["y_norm"] + best["y_norm"] * crop_box["h_norm"],
        "w_norm":       best["w_norm"] * crop_box["w_norm"],
        "h_norm":       best["h_norm"] * crop_box["h_norm"],
        "matched_text": best.get("text") if needle else None,
        "match_score":  chosen_score,
        "label_box":    label_box,
        "inline_value": inline_value,
    }


# ── Geometry helpers (pure — independently unit-testable) ────────────────────

def _norm_box(mapping, prefix):
    keys = (f"{prefix}_x_norm", f"{prefix}_y_norm", f"{prefix}_w_norm", f"{prefix}_h_norm")
    values = [mapping.get(k) for k in keys]
    if any(v is None for v in values):
        return None
    x, y, w, h = (float(v) for v in values)
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


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
    """
    if not needle:
        return 1.0
    if not haystack:
        return 0.0
    if needle in haystack:
        return 1.0
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


def _ocr_lines(image):
    """
    OCR the crop and group word-level results (image_to_data) into lines by
    (block, paragraph, line), each with crop-relative normalised bounding
    boxes: [{"text","x_norm","y_norm","w_norm","h_norm"}]. Multi-word labels
    like "Invoice Number" then match as a single unit instead of fragmenting.
    """
    if pytesseract is None:
        return []
    try:
        img = _prep(image)
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


def _crop_and_ocr(page, box, val_type, ocr_text_fn, capture=None):
    crop = _crop(page, _clamp_box(box))
    if crop is None:
        return None
    if capture:
        try: capture(crop)
        except Exception: pass   # dev-only slice capture; never disrupt OCR
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
