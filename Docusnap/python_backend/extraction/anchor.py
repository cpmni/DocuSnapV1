"""
extraction/anchor.py
--------------------
Stage 2 extraction — spatial anchor matching.
Uses learned label positions to find field values directly in OCR text.
Faster and more accurate than LLM for known document layouts.
"""

import re

from PIL import Image


def extract_with_anchors(ocr_text: str, anchors: list[dict],
                         supplier_name: str | None,
                         document_type: str | None,
                         page_images: list | None = None,
                         field_patterns: dict | None = None,
                         validation_patterns: dict | None = None,
                         slice_capture = None) -> dict:
    """
    Attempt to extract field values using saved structural anchors.

    When an anchor has x_norm/y_norm coordinates (set by the user via the ⊕
    selection tool), the page image is cropped to a tight region around the
    value and re-OCR'd. This is far more accurate than full-page text search
    for multi-column layouts where columns bleed into each other in OCR text.

    Falls back to text-based search for anchors without coordinates.

    Returns dict of {field_key: {"value": str, "confidence": int, "method": str}}
    """
    if not anchors or not ocr_text:
        return {}

    relevant = _filter_anchors(anchors, supplier_name, document_type)
    if not relevant:
        return {}

    lines   = ocr_text.split("\n")
    results = {}
    page0   = page_images[0] if page_images else None

    for anchor in relevant:
        field_key   = anchor["field_key"]
        label       = anchor["anchor_label"].lower().strip()
        direction   = anchor["direction"]
        usage_count = anchor.get("usage_count", 1)
        conf_factor = anchor.get("confidence", 0.5)
        x_norm      = anchor.get("x_norm") or 0.0
        y_norm      = anchor.get("y_norm") or 0.0

        if field_key in results:
            continue  # already found by higher-priority anchor

        value    = None
        method   = "anchor"
        val_type = (field_patterns or {}).get(field_key, {}).get("validation")

        # ── Primary: image crop + re-OCR (accurate, avoids column bleed) ──────
        if x_norm > 0 and y_norm > 0 and page0 is not None:
            w_norm   = anchor.get("w_norm") or 0.0
            h_norm   = anchor.get("h_norm") or 0.0
            _cap = ((lambda c: slice_capture(field_key, "anchor_crop", 0,
                       (x_norm, y_norm, w_norm, h_norm), c, "target")) if slice_capture else None)
            crop_value = _crop_and_ocr(page0, x_norm, y_norm, w_norm, h_norm, val_type, capture=_cap)
            # A fixed crop is positionally rigid: when an upstream line wraps or
            # the block shifts on a sibling layout, the box can land off-target
            # and return a NON-EMPTY but wrong value (e.g. ">alifornia" from the
            # line below the name). Keep the crop only when it is credible for
            # this field; otherwise leave value=None so the anchor_label +
            # direction search below runs and gets a chance to relocate it.
            if crop_value and _crop_is_credible(crop_value, val_type, validation_patterns):
                value  = crop_value
                method = "anchor_crop"

        # ── Fallback: text-based search in full OCR output ────────────────────
        if not value:
            pattern = _label_pattern(label)
            for i, line in enumerate(lines):
                m = pattern.search(line.lower()) if pattern else None
                if not m:
                    continue

                if direction == "right":
                    remainder = line[m.end():].strip().lstrip(":").strip()
                    if remainder:
                        value = remainder

                elif direction == "below":
                    for j in range(i + 1, min(i + 4, len(lines))):
                        candidate = lines[j].strip()
                        if candidate:
                            value = candidate
                            break

                elif direction == "above":
                    for j in range(i - 1, max(i - 4, -1), -1):
                        candidate = lines[j].strip()
                        if candidate:
                            value = candidate
                            break

                if value:
                    break

        # Never commit an implausible value — whether from a drifted crop or a
        # fallback line that landed on an adjacent label (e.g. ". Ship Mode:").
        # Leaving the field empty routes it to review/manual entry instead of a
        # confidently-wrong read; a credible value (the normal case) is kept.
        if value and not _crop_is_credible(value, val_type, validation_patterns):
            value = None

        if value:
            conf = min(95, 55 + (usage_count * 5) + int(conf_factor * 20))
            if method == "anchor_crop":
                conf = min(97, conf + 5)  # image crop is more reliable
            results[field_key] = {
                "value":      value.strip(),
                "confidence": conf,
                "method":     method,
                "anchor":     anchor["anchor_label"],
            }

    return results


def try_logo_supplier_match(page_image: Image.Image,
                            logos: list[dict],
                            threshold: int = 12) -> dict | None:
    """
    Attempt to identify supplier from logo perceptual hash.
    Returns {"supplier_name": str, "confidence": int} or None.
    """
    if not logos or page_image is None:
        return None

    try:
        import imagehash
        from PIL import ImageOps, ImageFilter

        w, h   = page_image.size
        crop   = page_image.crop((0, 0, w // 2, h // 5)).convert("L")
        crop   = ImageOps.autocontrast(crop, cutoff=5)
        crop   = crop.resize((256, 256), Image.LANCZOS)
        crop   = crop.filter(ImageFilter.GaussianBlur(radius=1))
        phash  = str(imagehash.phash(crop, hash_size=8))

        best = None
        best_dist = threshold + 1

        for fp in logos:
            dist = _hamming(phash, fp.get("phash", ""))
            if dist < best_dist:
                best_dist = dist
                best = {
                    "supplier_name": fp["supplier_name"],
                    "confidence":    max(0, 100 - dist * 6),
                    "match_count":   fp.get("match_count", 1),
                }

        return best if best and best["confidence"] >= 60 else None

    except ImportError:
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _crop_is_credible(value: str, val_type: str | None,
                      validation_patterns: dict | None) -> bool:
    """
    Decide whether an anchor result is trustworthy enough to COMMIT, or whether
    it is likely crop drift / a fallback line that landed on the wrong row and
    should be discarded (so the field falls to review instead of a wrong value).

    Reusable across every anchored supplier/field — no supplier, filename, or
    coordinate is referenced:
      * Typed/structured fields (date, currency, alphanumeric, currency_code):
        reuse the SAME validation_patterns the keyword stage trusts — the value
        must match one of them.
      * Free-text fields (text/multiline_text, or no configured type): there is
        no strict pattern, so only reject obvious debris — a value whose first
        real character is punctuation (the ">alifornia" / ". Ship Mode:" failure
        mode) or that is mostly non-alphanumeric. Clean names/addresses pass.
    """
    v = (value or "").strip()
    if not v:
        return False

    pats = (validation_patterns or {}).get(val_type) if val_type else None
    if pats:
        return any(re.search(p, v, re.IGNORECASE) for p in pats)

    # Free-text: must start with an alphanumeric char and be mostly alphanumeric.
    if not v[0].isalnum():
        return False
    nonspace = [c for c in v if not c.isspace()]
    alnum    = sum(c.isalnum() for c in nonspace)
    return alnum >= len(nonspace) * 0.5


def _crop_and_ocr(page_image: "Image.Image", x_norm: float, y_norm: float,
                  w_norm: float = 0.0, h_norm: float = 0.0,
                  val_type: str | None = None, capture = None) -> str | None:
    """
    Crop a tight region centred on the stored value coordinates and re-OCR it.
    Uses the exact selection dimensions saved by the ⊕ tool (w_norm/h_norm) so
    the crop never bleeds into adjacent columns or fields. Falls back to a
    conservative 200×60px half-size when no dimensions are stored.

    val_type (the field's configured `validation` type, e.g. "alphanumeric",
    "currency", "text") gates the digit-run truncation below — see the comment
    at the split-pattern selection for why this matters.
    """
    try:
        import pytesseract
        w, h = page_image.size
        cx = int(x_norm * w)
        cy = int(y_norm * h)

        # Use stored selection size + small padding, or conservative default
        if w_norm > 0 and h_norm > 0:
            half_w = int(w_norm * w / 2) + 20
            half_h = int(h_norm * h / 2) + 20
        else:
            half_w = 200
            half_h = 60

        x1 = max(0, cx - half_w)
        y1 = max(0, cy - half_h)
        x2 = min(w, cx + half_w)
        y2 = min(h, cy + half_h)

        crop = page_image.crop((x1, y1, x2, y2))
        if capture:
            try: capture(crop)
            except Exception: pass   # dev-only slice capture; never disrupt OCR
        # Scale up 2× — Tesseract accuracy improves significantly on larger text
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)

        text = pytesseract.image_to_string(crop, config="--oem 3 --psm 6").strip()
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            # Multiple spaces = Tesseract column gap (any field — safe to
            # split on regardless of type). A leading 4+ digit run ALSO
            # signals an address/postal-code boundary for free-text name and
            # address fields ("Ann Blume 10115 Berlin" -> "Ann Blume") — but
            # reference numbers, amounts and other numeric-shaped values
            # legitimately CONTAIN a 4+ digit run as their actual value
            # ("# 16384" -> truncating at " 16384" would discard the value
            # itself, keeping only the meaningless "#"). Scope the digit-run
            # split to the same text/multiline-text validation types
            # keyword.py::_clean_value already treats as name/address shaped,
            # so every other field (including unknown/custom types, where
            # destructively dropping digits would be the worse default) keeps
            # its digits intact.
            split_pattern = (r' {4,}|\s+\d{4,}' if val_type in ('text', 'multiline_text')
                             else r' {4,}')
            segment = re.split(split_pattern, line)[0].strip()
            # After 2+ words, a word ending in "," is a city separator, not part of the value
            parts = segment.split()
            end = len(parts)
            for i, w in enumerate(parts):
                if i >= 2 and w.endswith(','):
                    end = i
                    break
            segment = ' '.join(parts[:end]).rstrip(',;').strip()
            if segment:
                return segment
        return None
    except Exception:
        return None


def _filter_anchors(anchors: list[dict],
                    supplier_name: str | None,
                    document_type: str | None) -> list[dict]:
    """
    Return anchors relevant to this supplier/doc type, sorted by priority.
    Priority: exact supplier+type match > supplier only > type only > global
    """
    def priority(a):
        s_match = (a.get("supplier_name") or "").lower() in \
                  (supplier_name or "").lower()
        t_match = (a.get("document_type") or "") == (document_type or "")
        if s_match and t_match: return 0
        if s_match:             return 1
        if t_match:             return 2
        return 3

    filtered = [
        a for a in anchors
        if _anchor_matches(a, supplier_name, document_type)
    ]
    return sorted(filtered, key=lambda a: (priority(a), -a.get("usage_count", 1)))


def _anchor_matches(anchor: dict, supplier_name: str | None,
                    document_type: str | None) -> bool:
    a_sup  = (anchor.get("supplier_name") or "").lower().strip()
    a_type = anchor.get("document_type") or ""
    s_name = (supplier_name or "").lower().strip()
    d_type = document_type or ""

    # Global anchors always apply
    if a_sup in ("__unknown__", "__global__", ""):
        return True
    # Supplier match — exact (normalised), not substring. Substring matching
    # ("a_sup in s_name or s_name in a_sup") lets one supplier's anchors fire
    # on another whenever one name contains the other (e.g. a short supplier
    # name that happens to be a substring of a longer one) — the same
    # collision class that made the 'PO' template anchor match inside
    # "Polychemtex Inc.".
    if a_sup and s_name and a_sup == s_name:
        return True
    # Doc type match
    if a_type and d_type and a_type == d_type:
        return True

    return False


def _label_pattern(label: str) -> "re.Pattern | None":
    """
    Build a regex tolerant of OCR whitespace merging/splitting between a
    saved anchor label's words — the same fix already applied to Stage 1
    keyword matching (see keyword.py's _label_pattern). A label captured via
    strip-OCR at teach time ("Purchase Order No") and the same text seen in
    a later full-page OCR pass ("PURCHASE ORDERNO") commonly disagree on
    whether inter-word spacing collapsed; allowing zero-or-more whitespace
    between each word covers both, for any current or future label.

    The returned pattern's match span is used directly for extraction (see
    extract_with_anchors), so "does it match" and "where does the value
    start" are always answered by the same regex — eliminating the previous
    inconsistency where a loose word-overlap match could pass here while the
    subsequent exact-length line.find(label) silently failed or misaligned
    the extracted value.

    Single-word alphabetic labels also get a word-boundary guard, mirroring
    template_matcher.py::_find_by_anchor's existing fix for the same
    collision class — a short generic label ("PO", "Ref") must not match
    inside an unrelated word ("Polychemtex", "Refinishing"). Without this,
    the two label-matching paths would disagree on the same kind of label.
    """
    words = label.split()
    if not words:
        return None
    body = r'\s*'.join(re.escape(w) for w in words)
    if len(words) == 1 and words[0].isalpha():
        return re.compile(r'(?<![a-z0-9])' + body + r'(?![a-z0-9])')
    return re.compile(body)


def _hamming(h1: str, h2: str) -> int:
    if not h1 or not h2 or len(h1) != len(h2):
        return 64
    dist = 0
    for c1, c2 in zip(h1, h2):
        xor = int(c1, 16) ^ int(c2, 16)
        dist += bin(xor).count("1")
    return dist
