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
import re

from PIL import Image, ImageFilter, ImageOps

try:
    import pytesseract
    from pytesseract import Output
except ImportError:  # pragma: no cover - exercised only when Tesseract absent
    pytesseract = None
    Output = None

_FUZZY_MATCH_THRESHOLD = 0.6


def extract_with_mappings(page_images, mappings, field_patterns=None,
                          ocr_lines_fn=None, ocr_text_fn=None):
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

    results = {}
    for mapping in mappings:
        if mapping.get("enabled") is False or mapping.get("enabled") == 0:
            continue
        field_key = mapping.get("field_key")
        if not field_key or field_key in results:
            continue
        page_idx = mapping.get("page_number") or 0
        if page_idx < 0 or page_idx >= len(page_images) or page_images[page_idx] is None:
            continue

        outcome = _extract_one(page_images[page_idx], mapping, field_patterns,
                               ocr_lines_fn, ocr_text_fn)
        if outcome:
            results[field_key] = outcome
    return results


# ── Per-mapping resolution ────────────────────────────────────────────────────

def _extract_one(page, mapping, field_patterns, ocr_lines_fn, ocr_text_fn):
    anchor_box = _norm_box(mapping, "anchor")
    target_box = _norm_box(mapping, "target")
    if not anchor_box or not target_box:
        return None

    expansion = float(mapping.get("search_expansion") or 0.0)
    located = _locate_anchor(page, anchor_box, mapping.get("anchor_text"),
                             expansion, ocr_lines_fn)
    if not located:
        return None

    # Heart of the "anchor + relative target zone" model: derive the target
    # from where the anchor ACTUALLY is, not from the absolute saved target
    # coordinates — handles the anchor having drifted since the sample doc.
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

    field_key = mapping.get("field_key", "")
    val_type = (field_patterns or {}).get(field_key, {}).get("validation")

    text = _crop_and_ocr(page, derived_target, val_type, ocr_text_fn)
    expanded = False
    if not text and expansion > 0:
        text = _crop_and_ocr(page, _expand_box(derived_target, expansion), val_type, ocr_text_fn)
        expanded = bool(text)
    if not text:
        return None

    confidence = 90 if located.get("matched_text") is not None and mapping.get("anchor_text") else 78
    if expanded:
        confidence -= 12
    return {
        "value":      text,
        "confidence": max(50, min(96, confidence)),
        "method":     "template_mapping_expanded" if expanded else "template_mapping",
        "anchor":     mapping.get("anchor_text") or field_key,
    }


# ── Anchor relocation ─────────────────────────────────────────────────────────

def _locate_anchor(page, anchor_box, anchor_text, expansion, ocr_lines_fn):
    """
    Search the (optionally expanded) drawn anchor region for the stored label
    text and report where it ACTUALLY sits on this page, in page-relative
    normalised coordinates. Returns None when nothing usable is found there —
    the caller's documented signal to fall back to the rest of the pipeline.
    """
    search_box = _expand_box(anchor_box, expansion) if expansion > 0 else dict(anchor_box)
    crop_box = _clamp_box(search_box)
    crop = _crop(page, crop_box)
    if crop is None:
        return None

    lines = ocr_lines_fn(crop)
    if not lines:
        return None

    needle = _normalise(anchor_text) if anchor_text else None
    best, best_score = None, 0.0
    for line in lines:
        haystack = _normalise(line.get("text", ""))
        if not haystack:
            continue
        score = _label_score(needle, haystack)
        if score > best_score:
            best, best_score = line, score

    if best is None:
        return None
    if needle and best_score < _FUZZY_MATCH_THRESHOLD:
        return None

    return {
        "x_norm":       crop_box["x_norm"] + best["x_norm"] * crop_box["w_norm"],
        "y_norm":       crop_box["y_norm"] + best["y_norm"] * crop_box["h_norm"],
        "w_norm":       best["w_norm"] * crop_box["w_norm"],
        "h_norm":       best["h_norm"] * crop_box["h_norm"],
        "matched_text": best.get("text") if needle else None,
        "match_score":  best_score,
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
        x2, y2 = x + data["width"][i], y + data["height"][i]
        g = groups.get(key)
        if g is None:
            groups[key] = {"words": [word], "x1": x, "y1": y, "x2": x2, "y2": y2}
        else:
            g["words"].append(word)
            g["x1"] = min(g["x1"], x)
            g["y1"] = min(g["y1"], y)
            g["x2"] = max(g["x2"], x2)
            g["y2"] = max(g["y2"], y2)

    lines = []
    for g in groups.values():
        lines.append({
            "text":   " ".join(g["words"]),
            "x_norm": g["x1"] / w,
            "y_norm": g["y1"] / h,
            "w_norm": (g["x2"] - g["x1"]) / w,
            "h_norm": (g["y2"] - g["y1"]) / h,
        })
    return lines


def _crop_and_ocr(page, box, val_type, ocr_text_fn):
    crop = _crop(page, _clamp_box(box))
    if crop is None:
        return None
    text = ocr_text_fn(crop)
    if not text:
        return None
    return _clean_value(text, val_type)


def _clean_value(text, val_type):
    """Mirrors anchor._crop_and_ocr's segment-selection so a drawn target zone
    is cleaned up exactly like a learned-anchor crop (column-gap / digit-run /
    trailing-city-comma truncation), keeping value shape consistent system-wide."""
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        split_pattern = (r' {4,}|\s+\d{4,}' if val_type in ('text', 'multiline_text')
                         else r' {4,}')
        segment = re.split(split_pattern, line)[0].strip()
        parts = segment.split()
        end = len(parts)
        for i, word in enumerate(parts):
            if i >= 2 and word.endswith(','):
                end = i
                break
        segment = ' '.join(parts[:end]).rstrip(',;').strip()
        if segment:
            return segment
    return None
