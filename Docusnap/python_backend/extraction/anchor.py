"""
extraction/anchor.py
--------------------
Stage 2 extraction — spatial anchor matching.
Uses learned label positions to find field values directly in OCR text.
Faster and more accurate than LLM for known document layouts.
"""

import re

from PIL import Image

# Stage 0.5 (template_mapper) already implements the sanctioned drift-tolerant
# "find the anchor text live, then derive the value zone from where it ACTUALLY
# is" model. Stage 2 learned anchors mirror it by reusing the SAME relocation
# primitives (_ocr_lines word-grouping, _label_score fuzzy match, geometry
# helpers) rather than a second copy — one relocation implementation, system-wide.
from extraction import template_mapper

# How far around the stored value position to hunt for the anchor LABEL.
# _RELOCATE_EXPANSION is the symmetric band used by the geometric fallback.
# The word reader uses an ASYMMETRIC band instead: generous HORIZONTALLY (the
# label sits to the side of the value and the value column must be reached) but
# TIGHT VERTICALLY — a tall band pulls in many unrelated rows and wrecks the
# per-region OCR (overlapping boxes, cross-row noise). For direction=right the
# value is on the label's own row; for below/above it is one row away, so a few
# rows of vertical slack is enough while still absorbing realistic drift.
# Stored absolute coordinates only NARROW the search; never the source of truth.
_RELOCATE_EXPANSION       = 0.15
_RELOCATE_EXPAND_X        = 0.18
_RELOCATE_EXPAND_Y        = 0.045
_RELOCATE_MATCH_THRESHOLD = 0.6


def extract_with_anchors(ocr_text: str, anchors: list[dict],
                         supplier_name: str | None,
                         document_type: str | None,
                         page_images: list | None = None,
                         field_patterns: dict | None = None) -> dict:
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

        # Poisoned-label fallback: the ⊕ capture can accidentally fold a variable
        # per-document token into the saved label (e.g. a ticket number ahead of
        # the recurring "Work Address"), so the stored label no longer matches any
        # OTHER document in the family. Try the ORIGINAL label first (unchanged
        # behaviour for clean labels); only when it is absent from THIS page do we
        # fall back to its recurring core ("2605-0805-1 Work Address" -> "Work
        # Address") — and only if that core is actually present here. General rule,
        # no specific numbers/suppliers. See _core_label.
        effective_label = label
        if not _label_in_text(label, ocr_text):
            core = _core_label(anchor["anchor_label"])
            if core:
                core_l = core.lower().strip()
                if _label_in_text(core_l, ocr_text):
                    effective_label = core_l

        crop_value = None
        text_value = None
        value      = None
        method     = "anchor"

        # ── Primary: relocate to the LIVE anchor label, then crop + re-OCR ────
        # NORTH STAR: the changing value is found relative to the recurring
        # anchor text, not by replaying absolute saved coordinates. We first try
        # to find anchor_label where it ACTUALLY sits on this scan and derive the
        # value box from there (drift-tolerant); only if the label can't be
        # relocated do we fall back to the legacy absolute crop — so behaviour is
        # never worse than before for documents where relocation can't help.
        if x_norm > 0 and y_norm > 0 and page0 is not None:
            w_norm   = anchor.get("w_norm") or 0.0
            h_norm   = anchor.get("h_norm") or 0.0
            val_type = (field_patterns or {}).get(field_key, {}).get("validation")
            crop_value = _relocate_and_read(page0, anchor, val_type,
                                            match_label=effective_label)
            if crop_value is None:
                crop_value = _crop_and_ocr(page0, x_norm, y_norm, w_norm, h_norm, val_type)

        # ── Text-based search — always runs as a crosscheck ──────────────────
        # The crop path uses stored absolute coordinates that drift when
        # page-registration shifts between scans (different scan margins,
        # printer alignment).  The text search anchors to the LABEL STRING in
        # the current OCR output so it is inherently drift-tolerant.
        # For direction=right we always prefer the text result when it
        # disagrees with the crop: column bleed is not a risk on same-line
        # extraction, and disagreement is the clearest signal of crop drift.
        # For direction=below/above the text search is kept as a fallback only
        # because adjacent-column lines can bleed into the "below" region in
        # multi-column OCR output, making it less reliable than the crop there.
        label_found_in_ocr = False
        pattern = _label_pattern(effective_label)
        for i, line in enumerate(lines):
            m = pattern.search(line.lower()) if pattern else None
            if not m:
                continue
            label_found_in_ocr = True   # label IS on this page, even if no value follows

            if direction == "right":
                remainder = line[m.end():].strip().lstrip(":").strip()
                # Truncate at first column gap (4+ spaces) — OCR of multi-column
                # layouts produces runs of spaces between columns; everything after
                # the first such gap belongs to an adjacent column, not this field.
                col_gap = re.search(r'\s{4,}', remainder)
                if col_gap:
                    remainder = remainder[:col_gap.start()].strip()
                # Reject single-token abbreviations (e.g. "Po.", "No.", "Ref.") —
                # these arise when a generic anchor label ("Customer") matches the
                # start of a longer label on the page ("Customer Po.") and the
                # remainder is just the abbreviated suffix, not a real field value.
                if remainder and re.match(r'^[A-Za-z]{1,3}\.$', remainder):
                    remainder = ''
                if remainder:
                    text_value = remainder

            elif direction == "below":
                for j in range(i + 1, min(i + 4, len(lines))):
                    candidate = lines[j].strip()
                    if candidate:
                        text_value = candidate
                        break

            elif direction == "above":
                for j in range(i - 1, max(i - 4, -1), -1):
                    candidate = lines[j].strip()
                    if candidate:
                        text_value = candidate
                        break

            if text_value:
                break

        # ── Reconcile crop vs text results ────────────────────────────────────
        if crop_value and text_value:
            if direction == "right":
                if not _values_agree(crop_value, text_value):
                    # Disagreement on a same-line field → crop coordinates
                    # drifted (different scan registration). Text is drift-tolerant.
                    value  = text_value
                    method = "anchor"
                elif len(text_value.strip()) < len(crop_value.strip()):
                    # Consistent pair but text is shorter — the longer crop
                    # reading has trailing content from the right-edge padding;
                    # the tighter text-anchored result is cleaner.
                    value  = text_value
                    method = "anchor"
                else:
                    value  = crop_value
                    method = "anchor_crop"
            else:
                value  = crop_value
                method = "anchor_crop"
        elif crop_value:
            if label_found_in_ocr:
                # Label is on the page but direction/layout prevented text
                # extraction (e.g. value is in a box below a header cell).
                # The coordinates were saved for a document where this label
                # was present, so the crop is plausibly aimed correctly.
                value  = crop_value
                method = "anchor_crop"
            # else: label completely absent from OCR — the saved coordinates
            # were recorded for a different document version or layout. The
            # crop has no anchor to rely on and is likely pointing at unrelated
            # content. Leave value=None so the field stays empty (forces
            # review) rather than returning a plausibly-formatted wrong value.
        else:
            value = text_value   # may still be None if text search also failed

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

def _crop_and_ocr(page_image: "Image.Image", x_norm: float, y_norm: float,
                  w_norm: float = 0.0, h_norm: float = 0.0,
                  val_type: str | None = None) -> str | None:
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
            half_w = int(w_norm * w / 2) + 8
            half_h = int(h_norm * h / 2) + 8
        else:
            half_w = 200
            half_h = 60

        x1 = max(0, cx - half_w)
        y1 = max(0, cy - half_h)
        x2 = min(w, cx + half_w)
        y2 = min(h, cy + half_h)

        crop = page_image.crop((x1, y1, x2, y2))
        # Scale up 2× — Tesseract accuracy improves significantly on larger text
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)

        text = pytesseract.image_to_string(crop, config="--oem 3 --psm 6").strip()
        return _segment_value(text, val_type)
    except Exception:
        return None


def _segment_value(text: str, val_type: str | None) -> str | None:
    """Shared crop-OCR text cleaning for every learned-anchor read path
    (the legacy absolute crop AND the relocated crop below), so a value is
    shaped identically however the crop was positioned.

    Multiple spaces = Tesseract column gap. A leading 4+ digit run signals an
    address/postal-code boundary for text fields but must be preserved for
    numeric fields (reference numbers, amounts) — scope accordingly. Text-type
    fields (supplier_name, billing_address, …) may span multiple OCR output
    lines within the crop — collect and join them; non-text fields keep
    first-segment-only behaviour (a reference "INV-001" followed by noise on a
    second line must not become "INV-001 12345").
    """
    if not text:
        return None
    split_pattern = (r' {4,}|\s+\d{4,}' if val_type in ('text', 'multiline_text')
                     else r' {4,}')
    segments: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            if segments:
                break   # blank line after content signals end of value
            continue
        segment = re.split(split_pattern, line)[0].strip()
        if not segment:
            continue
        # A line containing "word:" is from an adjacent label leaking in —
        # stop before it contaminates the value.
        if re.search(r'[A-Za-z]{2,}\s*:', segment):
            break
        # City/address separator: word ending in "," after the 2nd word
        parts = segment.split()
        end = len(parts)
        for i, w in enumerate(parts):
            if i >= 2 and w.endswith(','):
                end = i
                break
        segment = ' '.join(parts[:end]).rstrip(',;').strip()
        if segment:
            segments.append(segment)
            # Non-text fields: take only the first usable segment
            if val_type not in ('text', 'multiline_text'):
                break
            if len(segments) >= 3:  # cap at 3 lines for text fields
                break
    if not segments:
        return None
    return ' '.join(segments)


# ── Poisoned-label normalisation ──────────────────────────────────────────────

def _is_variable_token(tok: str) -> bool:
    """A token that varies per document: pure punctuation, or containing a digit
    (ticket/reference/order numbers, dates). Such a token captured into a taught
    label stops it matching any other document in the family."""
    stripped = tok.strip("()[]{}.,:;-/\\|")
    if not stripped:
        return True                       # punctuation-only
    return any(c.isdigit() for c in tok)  # digit-bearing → variable


def _core_label(label: str) -> str | None:
    """Strip a LEADING run of variable tokens from a taught label to expose its
    recurring core, e.g. '2605-0805-1 Work Address' -> 'Work Address'.

    Conservative and general (no specific numbers/suppliers):
      • only a leading contiguous run of variable tokens is removed — interior
        and trailing content is untouched;
      • returns a core ONLY when it still carries a strong recurring anchor
        (>= 4 alphabetic chars AND at least one wholly-alphabetic word >= 2
        chars), so a label is never reduced to a weak fragment like "No";
      • returns None when nothing is stripped, everything is stripped, or the
        core would equal the original — the caller then keeps the original.
    Used strictly as a FALLBACK (only after the original label fails to match),
    so a legitimate number-led label that DOES appear as-is is never altered."""
    if not label:
        return None
    tokens = label.split()
    if len(tokens) < 2:
        return None
    i = 0
    while i < len(tokens) and _is_variable_token(tokens[i]):
        i += 1
    if i == 0 or i >= len(tokens):
        return None
    core_tokens = tokens[i:]
    core = " ".join(core_tokens)
    alpha    = sum(c.isalpha() for c in core)
    has_word = any(t.isalpha() and len(t) >= 2 for t in core_tokens)
    if alpha < 4 or not has_word:
        return None
    if core.strip().lower() == label.strip().lower():
        return None
    return core


def _label_in_text(label: str, ocr_text: str) -> bool:
    """Whitespace-tolerant presence test for a label anywhere in the OCR text,
    using the same pattern builder as extraction so 'found' and 'extractable'
    agree."""
    pat = _label_pattern(label)
    return bool(pat and pat.search(ocr_text.lower()))


# ── Anchor relocation (Stage 2 drift tolerance — mirrors template_mapper) ─────

def _stored_value_box(anchor: dict) -> dict:
    """The value box exactly as the ⊕ tool saved it. The renderer stores x/y as
    the value box CENTRE (see review/renderer.js saveFieldAnchor), so convert
    back to a top-left box. Falls back to a modest default size when no
    dimensions were captured."""
    val_w = anchor.get("w_norm") or 0.08
    val_h = anchor.get("h_norm") or 0.03
    cx    = anchor.get("x_norm") or 0.0
    cy    = anchor.get("y_norm") or 0.0
    return {
        "x_norm": template_mapper._clamp01(cx - val_w / 2.0),
        "y_norm": template_mapper._clamp01(cy - val_h / 2.0),
        "w_norm": val_w,
        "h_norm": val_h,
    }


def _derive_value_box(label_box: dict, direction: str, stored: dict) -> dict:
    """Place the value box relative to the anchor label's LIVE position.

    Drift is dominated by the axis the label sits on relative to the value:
      • right  → value follows the label horizontally on the same row, so both
                 axes track the live label (x just past the label, y on its row);
      • below/above → the value is stacked under/over the label, so the VERTICAL
                 position tracks the live label while the horizontal position
                 keeps the stored value x (horizontal drift is negligible, and
                 the value is often indented differently from the label).
    Stored value SIZE is reused throughout — what moves is position, not extent.
    """
    lx, ly = label_box["x_norm"], label_box["y_norm"]
    lw, lh = label_box["w_norm"], label_box["h_norm"]
    if direction == "below":
        return {"x_norm": stored["x_norm"], "y_norm": template_mapper._clamp01(ly + lh),
                "w_norm": stored["w_norm"], "h_norm": stored["h_norm"]}
    if direction == "above":
        return {"x_norm": stored["x_norm"],
                "y_norm": template_mapper._clamp01(ly - stored["h_norm"]),
                "w_norm": stored["w_norm"], "h_norm": stored["h_norm"]}
    # direction == "right" (default): value begins just past the label, on its row
    return {"x_norm": template_mapper._clamp01(lx + lw),
            "y_norm": template_mapper._clamp01(ly + lh / 2.0 - stored["h_norm"] / 2.0),
            "w_norm": stored["w_norm"],
            "h_norm": max(stored["h_norm"], lh)}


def _best_value_box(page, label: str, stored: dict, direction: str,
                    ocr_lines_fn=None) -> dict | None:
    """Find the anchor label live within a local band around the stored value
    position and return the value box derived from its CURRENT location. When
    the label appears more than once, the candidate whose derived value box is
    nearest the stored absolute position wins — the only role the stored
    coordinates play (tie-break + search-narrowing), never the source of truth.
    Returns None when the label can't be relocated."""
    ocr_lines_fn = ocr_lines_fn or template_mapper._ocr_lines
    search = template_mapper._clamp_box(
        template_mapper._expand_box(stored, _RELOCATE_EXPANSION))
    crop = template_mapper._crop(page, search)
    if crop is None:
        return None
    lines = ocr_lines_fn(crop)
    if not lines:
        return None

    needle    = template_mapper._normalise(label)
    stored_cx = stored["x_norm"] + stored["w_norm"] / 2.0
    stored_cy = stored["y_norm"] + stored["h_norm"] / 2.0
    best, best_dist = None, None
    for ln in lines:
        score = template_mapper._label_score(
            needle, template_mapper._normalise(ln.get("text", "")))
        if score < _RELOCATE_MATCH_THRESHOLD:
            continue
        # crop-relative → page-relative
        label_box = {
            "x_norm": search["x_norm"] + ln["x_norm"] * search["w_norm"],
            "y_norm": search["y_norm"] + ln["y_norm"] * search["h_norm"],
            "w_norm": ln["w_norm"] * search["w_norm"],
            "h_norm": ln["h_norm"] * search["h_norm"],
        }
        # Merged inline line guard: for direction=right the value sits to the
        # right of the label. If the matched line already extends past where the
        # value should be, the label and value were OCR'd as ONE line — deriving
        # "just past the label" would land beyond the value. Skip it and let the
        # label-anchored text search (preferred for direction=right) handle it.
        if direction == "right" and (label_box["x_norm"] + label_box["w_norm"]) >= stored_cx:
            continue
        derived = _derive_value_box(label_box, direction, stored)
        dcx = derived["x_norm"] + derived["w_norm"] / 2.0
        dcy = derived["y_norm"] + derived["h_norm"] / 2.0
        dist = (dcx - stored_cx) ** 2 + (dcy - stored_cy) ** 2
        if best is None or dist < best_dist:
            best, best_dist = derived, dist
    return best


def _relocate_and_read(page, anchor: dict, val_type: str | None,
                       match_label: str | None = None,
                       ocr_words_fn=None, ocr_lines_fn=None) -> str | None:
    """Drift-tolerant Stage 2 read. PRIMARY path: find the live anchor label and
    read the value from OCR WORD boxes immediately next to it, stopping at the
    first column boundary (see _relocate_value_words) — this reads the actual
    text rather than re-OCRing a rigid geometric crop that frequently landed
    empty on real layouts. SECONDARY (fallback only): the geometric
    derived-crop relocation, kept for cases the word reader can't resolve.
    Returns None when neither relocates (caller then uses the absolute crop).

    match_label overrides the text used to FIND the label (the caller's
    original-then-core poisoned-label fallback); the anchor's stored coordinates
    still drive the search band and tie-break."""
    label = (match_label or anchor.get("anchor_label") or "").strip()
    if not label:
        return None
    value = _relocate_value_words(page, anchor, val_type, ocr_words_fn,
                                  match_label=label)
    if value:
        return value
    # Secondary fallback: geometric derived crop (demoted from the main path).
    stored    = _stored_value_box(anchor)
    direction = (anchor.get("direction") or "right").lower()
    box = _best_value_box(page, label, stored, direction, ocr_lines_fn)
    if box is None:
        return None
    return _crop_and_ocr_box(page, box, val_type)


# A horizontal gap between consecutive words wider than this many times the
# local text HEIGHT marks a COLUMN boundary, not a word space. Pixel-based and
# height-relative, so it is independent of scan resolution, page aspect and font
# size. Tuned conservatively high: ordinary inter-word spacing inside a value
# ("Beaumont Care Homes Ltd") never splits, while the wide gap between table
# columns ("…0849-1   Work Address …") does. General to every layout — no
# supplier/document tuning.
_COLUMN_GAP_FACTOR = 2.2

# A "word" whose bounding-box height is below this fraction of the anchor
# label's text height is an OCR speck / graphical artifact (stray rules, logo
# bleed, the "�" replacement glyph), not real text — these come back ~3-4px tall
# next to ~30px real characters. Dropping them stops leading/trailing noise
# ("- 2603-1351-1 oe") from polluting an otherwise-clean relocated value.
# Height-relative ⇒ resolution/font independent and reusable across layouts.
_NOISE_HEIGHT_FRACTION = 0.4


def _expand_xy(box: dict, fx: float, fy: float) -> dict:
    """Grow a box by independent horizontal/vertical fractions, clamped to [0,1]."""
    x0 = max(0.0, box["x_norm"] - fx)
    y0 = max(0.0, box["y_norm"] - fy)
    x1 = min(1.0, box["x_norm"] + box["w_norm"] + fx)
    y1 = min(1.0, box["y_norm"] + box["h_norm"] + fy)
    return {"x_norm": x0, "y_norm": y0,
            "w_norm": max(0.0, x1 - x0), "h_norm": max(0.0, y1 - y0)}


def _ocr_words(image) -> list[dict]:
    """OCR a crop to WORD-level boxes (crop-relative normalised), each tagged
    with its (block, par, line) row key so callers can group words into rows and
    measure inter-word horizontal gaps. Same prep/engine as
    template_mapper._ocr_lines, but words are kept SEPARATE — we need per-word x
    to find the column boundary the line-grouped version hides."""
    try:
        import pytesseract
        from pytesseract import Output
    except ImportError:
        return []
    try:
        img = template_mapper._prep(image)
        w, h = img.size
        if not w or not h:
            return []
        data = pytesseract.image_to_data(img, config="--oem 3 --psm 6",
                                         output_type=Output.DICT)
    except Exception:
        return []
    words = []
    for i in range(len(data.get("text", []))):
        t = (data["text"][i] or "").strip()
        if not t:
            continue
        words.append({
            "text":   t,
            "x_norm": data["left"][i] / w,
            "y_norm": data["top"][i] / h,
            "w_norm": data["width"][i] / w,
            "h_norm": data["height"][i] / h,
            "row":    (data["block_num"][i], data["par_num"][i], data["line_num"][i]),
        })
    return words


def _find_label_span(row_words: list[dict], needle: str):
    """Indices (i0, i1) of the smallest contiguous word run in a row whose joined
    normalised text contains the label `needle`. Rows are short, so the nested
    scan is cheap. Returns None when the label is not on this row."""
    if not needle:
        return None
    norms = [template_mapper._normalise(w["text"]) for w in row_words]
    for i in range(len(norms)):
        acc = ""
        for j in range(i, len(norms)):
            acc = norms[j] if not acc else acc + " " + norms[j]
            if needle in acc:
                return (i, j)
    return None


def _collect_value_words(seq: list[dict], height_ref: float):
    """Walk a left-to-right ordered word sequence and collect words until the
    first column-boundary gap (gap > _COLUMN_GAP_FACTOR × text height). Returns
    the collected words (possibly empty). Pixel units throughout."""
    out = []
    prev = None
    noise_floor = _NOISE_HEIGHT_FRACTION * height_ref
    for wd in seq:
        if wd["h"] < noise_floor:
            continue  # OCR speck / graphical artifact, not real text
        if prev is not None:
            gap = wd["x0"] - prev["x1"]
            h   = max(wd["h"], prev["h"], height_ref, 1.0)
            if gap > _COLUMN_GAP_FACTOR * h:
                break
        out.append(wd)
        prev = wd
    return out


def _relocate_value_words(page, anchor: dict, val_type: str | None,
                          ocr_words_fn=None, match_label: str | None = None) -> str | None:
    """Read the value from OCR word boxes positioned relative to the LIVE anchor
    label. direction=right reads the words following the label on its row;
    below/above read the nearest row under/over the label. The stop rule
    (_collect_value_words) keeps the value to a single column. Stored absolute
    position only narrows the search band and breaks ties between repeated
    labels — never the source of truth. match_label overrides the matched label
    text (poisoned-label core fallback) while keeping the anchor's coordinates."""
    label = (match_label or anchor.get("anchor_label") or "").strip()
    if not label:
        return None
    ocr_words_fn = ocr_words_fn or _ocr_words
    stored    = _stored_value_box(anchor)
    direction = (anchor.get("direction") or "right").lower()

    search = template_mapper._clamp_box(
        _expand_xy(stored, _RELOCATE_EXPAND_X, _RELOCATE_EXPAND_Y))
    crop = template_mapper._crop(page, search)
    if crop is None:
        return None
    words = ocr_words_fn(crop)
    if not words:
        return None

    # Project crop-relative boxes to absolute PAGE PIXELS so horizontal gaps and
    # text heights are compared in the same physical unit (normalised x and y do
    # not share a scale on a non-square page).
    W, H = page.size
    for wd in words:
        x0 = (search["x_norm"] + wd["x_norm"] * search["w_norm"]) * W
        y0 = (search["y_norm"] + wd["y_norm"] * search["h_norm"]) * H
        wd["x0"] = x0
        wd["x1"] = x0 + wd["w_norm"] * search["w_norm"] * W
        wd["y0"] = y0
        wd["y1"] = y0 + wd["h_norm"] * search["h_norm"] * H
        wd["h"]  = wd["h_norm"] * search["h_norm"] * H

    rows = {}
    for wd in words:
        rows.setdefault(wd["row"], []).append(wd)
    for r in rows.values():
        r.sort(key=lambda d: d["x0"])

    needle    = template_mapper._normalise(label)
    stored_cx = (stored["x_norm"] + stored["w_norm"] / 2.0) * W
    stored_cy = (stored["y_norm"] + stored["h_norm"] / 2.0) * H

    best_text, best_dist = None, None
    for key, rw in rows.items():
        span = _find_label_span(rw, needle)
        if span is None:
            continue
        i0, i1 = span
        collected = _read_value_for_direction(rw, i0, i1, rows, direction)
        if not collected:
            continue
        cx = (collected[0]["x0"] + collected[-1]["x1"]) / 2.0
        cy = (collected[0]["y0"] + collected[-1]["y1"]) / 2.0
        dist = (cx - stored_cx) ** 2 + (cy - stored_cy) ** 2
        if best_dist is None or dist < best_dist:
            best_dist = dist
            best_text = " ".join(w["text"] for w in collected)

    if not best_text:
        return None
    return _segment_value(best_text, val_type)


def _read_value_for_direction(label_row: list[dict], i0: int, i1: int,
                              rows: dict, direction: str):
    """Return the ordered value words for the located label, per direction, or []."""
    label_words = label_row[i0:i1 + 1]
    href = max((w["h"] for w in label_words), default=1.0)

    if direction in ("below", "above"):
        ly0 = min(w["y0"] for w in label_words)
        ly1 = max(w["y1"] for w in label_words)
        lx0 = min(w["x0"] for w in label_words)
        target, best_dy = None, None
        for rw in rows.values():
            ry0 = min(w["y0"] for w in rw)
            ry1 = max(w["y1"] for w in rw)
            if direction == "below":
                if ry0 < ly1 - 1.0:
                    continue
                dy = ry0 - ly1
            else:
                if ry1 > ly0 + 1.0:
                    continue
                dy = ly0 - ry1
            if best_dy is None or dy < best_dy:
                best_dy, target = dy, rw
        if not target:
            return []
        # Read the target row from the label's column leftward boundary onward.
        col_start = lx0 - href  # small tolerance so a slightly-indented value starts here
        seq = [w for w in sorted(target, key=lambda d: d["x0"]) if w["x1"] >= col_start]
        return _collect_value_words(seq, href)

    # direction == "right": value follows the label on the same row.
    if i1 + 1 >= len(label_row):
        return []
    return _collect_value_words(label_row[i1 + 1:], href)


def _crop_and_ocr_box(page, box: dict, val_type: str | None) -> str | None:
    """Crop a page-relative top-left box and re-OCR it, cleaning the result with
    the same _segment_value rules as the legacy centre-based crop."""
    try:
        import pytesseract
        w, h = page.size
        cb = template_mapper._clamp_box(box)
        x1 = int(cb["x_norm"] * w)
        y1 = int(cb["y_norm"] * h)
        x2 = int((cb["x_norm"] + cb["w_norm"]) * w)
        y2 = int((cb["y_norm"] + cb["h_norm"]) * h)
        if x2 <= x1 or y2 <= y1:
            return None
        crop = page.crop((x1, y1, x2, y2))
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
        text = pytesseract.image_to_string(crop, config="--oem 3 --psm 6").strip()
        return _segment_value(text, val_type)
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


def _values_agree(a: str, b: str) -> bool:
    """True when two extracted values are consistent enough to trust the crop.

    One being a substring of the other handles the common case where text
    search returns a truncated or slightly expanded form of the crop result
    (e.g. crop="Beaumont Care Homes Ltd", text="Beaumont Care Homes Ltd -
    Tuderdale") — both readings are from the same field, so the crop should
    not be discarded on the basis of the extra trailing text.
    """
    a = a.strip().lower()
    b = b.strip().lower()
    if not a or not b:
        return False
    if a == b:
        return True
    # Substring match only when the shorter string is long enough to be meaningful.
    # Single characters or very short strings ("a", "hs") appear as substrings of
    # almost any text and would make every crop "agree" with every text result.
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) >= 5:
        return shorter in longer
    return False


def _hamming(h1: str, h2: str) -> int:
    if not h1 or not h2 or len(h1) != len(h2):
        return 64
    dist = 0
    for c1, c2 in zip(h1, h2):
        xor = int(c1, 16) ^ int(c2, 16)
        dist += bin(xor).count("1")
    return dist
