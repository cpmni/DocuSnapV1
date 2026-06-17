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


def _gate_value(text, val_type, field_key, validation_patterns, format_lookup):
    """Shared accept/reject (+ date salvage) for a crop read, used by the
    absolute-target fast path, the anchor-derived path AND the drift fallback so
    all three apply IDENTICAL gates (the sequence was previously duplicated).

    Order:
      1. date-salvage FALLBACK (Fix C1) — when a date crop fails the strict date
         credibility gate, rescue/normalise it via validator.salvage_date;
      2. _crop_is_credible — the value must match the field's validation pattern
         (free-text only rejects obvious debris);
      3. _format_rejects — reject a value contradicting the learned per-
         (supplier,doctype,field) shape, once one exists.

    Returns (value, salvaged); (None, False) when the value is rejected."""
    if not text:
        return None, False
    salvaged = False
    if val_type == 'date' and not _crop_is_credible(text, val_type, validation_patterns):
        rescued = _salvage_date_value(text, val_type)
        if rescued:
            text, salvaged = rescued, True
    if not _crop_is_credible(text, val_type, validation_patterns):
        return None, False
    if _format_rejects(text, field_key, format_lookup):
        return None, False
    return text, salvaged


def _mapping_result(value, full_confidence, expanded, salvaged, anchor):
    """Build a Stage 0.5 result dict with the shared confidence tiers used by the
    absolute fast path and the anchor-derived path. `full_confidence` selects the
    90 (anchor located / anchor_text present) vs 78 (no label) base; `expanded`
    discounts a widened-retry read; `salvaged` (a date rescued from junk) caps
    confidence so it can't outrank a clean Stage 1/2 read, and tags the method."""
    confidence = 90 if full_confidence else 78
    if expanded:
        confidence -= 12
    method = "template_mapping_expanded" if expanded else "template_mapping"
    if salvaged:
        confidence = min(confidence, 70)
        method += "_salvaged"
    return {
        "value":      value,
        "confidence": max(50, min(96, confidence)),
        "method":     method,
        "anchor":     anchor,
    }


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
    abs_text, abs_salvaged = _gate_value(abs_text, val_type, field_key,
                                         validation_patterns, format_lookup)
    if abs_text:
        return _mapping_result(abs_text, bool(mapping.get("anchor_text")),
                               abs_expanded, abs_salvaged,
                               mapping.get("anchor_text") or field_key)

    # ── REGISTRATION RUNG (P4, "register, then read"): the drawn box at its
    # stored coords didn't yield a credible value, so the page is shifted/skewed/
    # scaled. If a per-page transform was fitted from the template's landmarks,
    # map the taught target box THROUGH it and read there — the value follows the
    # page's actual geometry (scale+rotation+translation), not a single-label
    # translation guess. Sits ABOVE the single-label path; falls through if the
    # transform read doesn't clear the gates. Confidence reflects the fit quality.
    if page_transform is not None:
        reg_box = page_transform.apply_box(target_box)
        _rcap = ((lambda c: slice_capture(field_key, "template_registration", page_idx,
                   (reg_box["x_norm"], reg_box["y_norm"], reg_box["w_norm"], reg_box["h_norm"]),
                   c, "target")) if slice_capture else None)
        rtext = _crop_and_ocr(page, reg_box, val_type, ocr_text_fn, capture=_rcap)
        r_expanded = False
        if not rtext and expansion > 0:
            rtext = _crop_and_ocr(page, _expand_box(reg_box, expansion), val_type, ocr_text_fn)
            r_expanded = bool(rtext)
        rtext, r_salvaged = _gate_value(rtext, val_type, field_key, validation_patterns, format_lookup)
        if rtext:
            conf = registration.registration_confidence(page_transform)
            if r_expanded:
                conf -= 12
            method = "template_registration_expanded" if r_expanded else "template_registration"
            if r_salvaged:
                conf = min(conf, 70)
                method += "_salvaged"
            return {
                "value":      rtext,
                "confidence": max(50, min(96, conf)),
                "method":     method,
                "anchor":     mapping.get("anchor_text") or field_key,
            }

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

    # Derive the target from where the anchor ACTUALLY is, not from the absolute
    # saved coordinates — handles the anchor having drifted since the sample doc.
    #
    # The stored offset is BOX-origin → BOX-origin (saveMapping records
    # target_x − anchor_x using the admin-drawn box corners), but _locate_anchor
    # reports the label's TIGHT OCR word-bbox, which sits inset to the right of /
    # below the drawn anchor box by its margin. Applying the box-based offset to
    # the tight origin shifted every derived target right/down by that margin —
    # clipping leading glyphs (the observed "PROFILE" → "ROFILE"). Re-derive the
    # located anchor's box-origin equivalent first (assume the label is roughly
    # centred in the drawn box, so the inset ≈ half the width/height slack) so
    # the offset is applied origin-to-origin as intended. General to every
    # mapping — not tuned to one template.
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

    text, salvaged = _gate_value(text, val_type, field_key, validation_patterns, format_lookup)
    if not text:
        return None
    return _mapping_result(
        text,
        located.get("matched_text") is not None and bool(mapping.get("anchor_text")),
        expanded, salvaged, mapping.get("anchor_text") or field_key)


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
