"""
extraction/anchor.py
--------------------
Stage 2 extraction — spatial anchor matching.
Uses learned label positions to find field values directly in OCR text.
Faster and more accurate than LLM for known document layouts.
"""

import re

from PIL import Image

from extraction import registration   # pure NumPy; no cycle (registration imports nothing here)


def _qualify_against_format(value, field_key, format_lookup):
    """Qualify a learned-anchor value against the field's LEARNED format (the same
    doc-type-scoped shape model Stage 4.5 uses). Returns the value to commit —
    possibly TRIMMED to the learned shape (e.g. a column-bleed read reduced to the
    reference) — or None when it's inconsistent with the learned format and no
    accepted-shape substring can be recovered (so a confidently-wrong crop like
    "Bookinc" is rejected instead of committed). No lookup / no learned format /
    already-consistent value → returned unchanged. Only ever TIGHTENS for fields
    that have actually learned a format; never loosens. Lazy import avoids any
    module-load cycle."""
    if not value or format_lookup is None:
        return value
    try:
        entry = format_lookup(field_key)
    except Exception:
        return value
    if not entry:
        return value
    from extraction.format_anomaly_checker import check_value, extract_accepted_shape
    if check_value(str(value), entry) is None:
        return value
    cleaned = extract_accepted_shape(str(value), entry)
    return cleaned or None


def extract_with_anchors(ocr_text: str, anchors: list[dict],
                         supplier_name: str | None,
                         document_type: str | None,
                         page_images: list | None = None,
                         field_patterns: dict | None = None,
                         validation_patterns: dict | None = None,
                         slice_capture = None,
                         format_lookup = None,
                         page_transform = None,
                         on_reject = None) -> dict:
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

        # "Did this crop read a value we'd actually commit?" — the same
        # credibility + learned-format gate the merge below applies. Passed into
        # the crop reader so a degraded TEXT line that fails it triggers the
        # heavier denoise/adaptive re-read (text fields only); a passing read
        # short-circuits with zero extra work.
        def _verify(t, _vt=val_type, _fk=field_key):
            return (bool(t)
                    and _crop_is_credible(t, _vt, validation_patterns)
                    and bool(_qualify_against_format(t, _fk, format_lookup)))

        # ── Primary: image crop + re-OCR (accurate, avoids column bleed) ──────
        if x_norm > 0 and y_norm > 0 and page0 is not None:
            w_norm   = anchor.get("w_norm") or 0.0
            h_norm   = anchor.get("h_norm") or 0.0
            _cap = ((lambda c: slice_capture(field_key, "anchor_crop", 0,
                       (x_norm, y_norm, w_norm, h_norm), c, "target")) if slice_capture else None)
            crop_value = _crop_and_ocr(page0, x_norm, y_norm, w_norm, h_norm, val_type, capture=_cap, verify_fn=_verify)
            # A fixed crop is positionally rigid: when an upstream line wraps or
            # the block shifts on a sibling layout, the box can land off-target
            # and return a NON-EMPTY but wrong value (e.g. ">alifornia" from the
            # line below the name). Keep the crop only when it is credible for
            # this field; otherwise leave value=None so the anchor_label +
            # direction search below runs and gets a chance to relocate it.
            if crop_value and not _crop_is_credible(crop_value, val_type, validation_patterns):
                if on_reject: on_reject(field_key, "anchor_crop", crop_value, "not_credible")
            elif crop_value:
                # Also qualify against the learned format: a fixed crop that drifted
                # onto the wrong row reads a NON-EMPTY, credible-looking but wrong
                # value ("Bookinc" where the reference is shaped "####-####-#").
                # Reject/trim it so value stays None and the label search below gets
                # a chance to relocate the right value, instead of committing the
                # garbage at high confidence.
                qualified = _qualify_against_format(crop_value, field_key, format_lookup)
                if qualified:
                    value  = qualified
                    method = "anchor_crop"
                elif on_reject:
                    on_reject(field_key, "anchor_crop", crop_value, "format")

        # ── Registration recovery: map the taught value box through the per-page
        # transform (fitted from the template's landmarks) so the value FOLLOWS a
        # shifted/skewed/scaled page even when the field's OWN label can't be
        # re-found — the failure that leaves a worksheet date empty. A multi-
        # landmark similarity fit (scale+rotation+translation, RANSAC) is stronger
        # than the single-label relocation below, so it runs FIRST. Runs only
        # after the rigid crop failed; the mapped read still clears the SAME
        # credibility + learned-format gates. INERT (ladder byte-identical to
        # before) when no transform was fitted (flag off / no landmarks / poor fit).
        if not value and page_transform is not None and x_norm > 0 and y_norm > 0 and page0 is not None:
            w_norm = anchor.get("w_norm") or 0.0
            h_norm = anchor.get("h_norm") or 0.0
            # field_anchors stores the value CENTRE; Transform.apply_box wants a
            # top-left box. Convert in → map → recentre, KEEPING the original tight
            # w/h (apply_box's AABB can inflate under rotation; we only want the
            # corrected POSITION, not a ballooned crop).
            tl = {"x_norm": x_norm - w_norm / 2.0, "y_norm": y_norm - h_norm / 2.0,
                  "w_norm": w_norm, "h_norm": h_norm}
            mapped = page_transform.apply_box(tl)
            rcx = mapped["x_norm"] + mapped["w_norm"] / 2.0
            rcy = mapped["y_norm"] + mapped["h_norm"] / 2.0
            _gcap = ((lambda c: slice_capture(field_key, "anchor_registration", 0,
                        (rcx, rcy, w_norm, h_norm), c, "target")) if slice_capture else None)
            gval = _crop_and_ocr(page0, rcx, rcy, w_norm, h_norm, val_type, capture=_gcap, verify_fn=_verify)
            if gval and not _crop_is_credible(gval, val_type, validation_patterns):
                if on_reject: on_reject(field_key, "anchor_registration", gval, "not_credible")
            elif gval:
                q = _qualify_against_format(gval, field_key, format_lookup)
                if q:
                    value  = q
                    method = "anchor_registration"
                elif on_reject:
                    on_reject(field_key, "anchor_registration", gval, "format")

        # ── Drift recovery: locate the label, then read the value beside it ───
        # The fixed crop is positionally RIGID — on a shifted/cropped scan (the
        # page registered higher, a top band clipped) the value moves off the
        # stored box and the rigid crop reads the wrong row, which the
        # credibility/format gates above then REJECT (value stays None). Here we
        # re-find the TAUGHT label on this page and re-derive the value crop from
        # where the label ACTUALLY sits + the taught direction, so the value
        # FOLLOWS the label however far the page drifted. This is the same
        # anchor+relative-target model Stage 0.5 (template_mapper) uses, brought
        # to ⊕-taught anchors so coordinates are only a HINT. Runs ONLY after the
        # rigid crop already failed, so the fast happy path is unchanged; the
        # relocated value still must clear the same credibility + learned-format
        # gates before it can win. Generic to every supplier/field.
        if not value and page0 is not None and (anchor.get("anchor_label") or "").strip():
            w_norm = anchor.get("w_norm") or 0.0
            h_norm = anchor.get("h_norm") or 0.0
            relo = _relocate_value_by_label(
                page0, anchor["anchor_label"], direction,
                (x_norm, y_norm, w_norm, h_norm),
                offset=(anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")))
            if relo:
                _rcap = ((lambda c: slice_capture(field_key, "anchor_relocate", 0,
                            relo, c, "target")) if slice_capture else None)
                rval = _crop_and_ocr(page0, relo[0], relo[1], relo[2], relo[3],
                                     val_type, capture=_rcap, verify_fn=_verify)
                if rval and not _crop_is_credible(rval, val_type, validation_patterns):
                    if on_reject: on_reject(field_key, "anchor_crop_relocated", rval, "not_credible")
                elif rval:
                    q = _qualify_against_format(rval, field_key, format_lookup)
                    if q:
                        value  = q
                        method = "anchor_crop_relocated"
                    elif on_reject:
                        on_reject(field_key, "anchor_crop_relocated", rval, "format")

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

        # Final learned-format gate — also covers the text-fallback value, so a
        # label-search read that grabbed the wrong token is rejected/trimmed too.
        if value:
            value = _qualify_against_format(value, field_key, format_lookup)

        if value:
            conf = min(95, 55 + (usage_count * 5) + int(conf_factor * 20))
            if method == "anchor_crop":
                conf = min(97, conf + 5)  # image crop is more reliable
            elif method == "anchor_crop_relocated":
                # Drift-relocated crop: more reliable than a blind text-line grab,
                # but a touch below a clean rigid crop since the page had shifted.
                conf = min(92, conf + 2)
            elif method == "anchor_registration":
                # Multi-landmark page transform — score by the FIT quality (inliers
                # + residual), not usage_count. Ranks above single-label relocate
                # (stronger geometry) and below a clean rigid crop.
                conf = min(93, registration.registration_confidence(page_transform))
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

def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _relocate_value_by_label(page0, anchor_label, direction, vbox,
                             offset=None):
    """Drift recovery for a ⊕-taught anchor: find `anchor_label` on THIS page and
    return a NEW value-crop box (cx, cy, w, h — same convention as _crop_and_ocr)
    positioned relative to the located label, or None if the label can't be found.

    `vbox` is the taught value box (cx, cy, w, h, all page-normalised).

    `offset` (offset_dx_norm, offset_dy_norm) is the DRIFT-INVARIANT label→value
    vector captured at teach time = (taught value-centre − taught label top-left),
    page-normalised. When present we place the value at located-label-top-left +
    offset — this is exact and reproduces the relationship the operator actually
    drew, so a correction taught on a clipped/shifted scan yields the SAME offset
    as one taught on a clean page (the poison-the-good-pages bug this closes).
    When absent (legacy anchors with no stored offset), fall back to the coarse
    geometric GUESS that the value sits immediately adjacent to the label in
    `direction` — preserving prior behaviour for un-migrated anchors.

    Reuses template_mapper's proven label locator (OCR word-grouping + fuzzy match
    + proximity tie-break). Lazy import avoids a module-load cycle (template_mapper
    imports anchor)."""
    label = (anchor_label or "").strip()
    if not label or page0 is None:
        return None
    cx, cy, vw, vh = (vbox[0] or 0.0), (vbox[1] or 0.0), (vbox[2] or 0.0), (vbox[3] or 0.0)
    if vw <= 0 or vh <= 0:
        return None
    hw, hh = vw / 2.0, vh / 2.0

    # Expected label box (top-left + size) in the OPPOSITE of `direction`.
    if direction == "right":      # label to the LEFT, same row
        lbox = {"x_norm": _clamp01(cx - hw - vw), "y_norm": _clamp01(cy - hh),
                "w_norm": vw, "h_norm": vh}
    elif direction == "below":    # label ABOVE the value
        lbox = {"x_norm": _clamp01(cx - hw), "y_norm": _clamp01(cy - hh - vh),
                "w_norm": vw, "h_norm": vh}
    elif direction == "above":    # label BELOW the value
        lbox = {"x_norm": _clamp01(cx - hw), "y_norm": _clamp01(cy + hh),
                "w_norm": vw, "h_norm": vh}
    else:
        return None

    from extraction import template_mapper as tm
    # Local search first (covers normal drift), then page-wide (clipped/heavily
    # shifted scans move the label out of the local window).
    located = tm._locate_anchor(page0, lbox, label, 0.0, tm._ocr_lines, min_search=0.10)
    if not located:
        located = tm._locate_anchor(page0, lbox, label, 1.0, tm._ocr_lines, min_search=0.10)
    if not located:
        return None

    Lx, Ly, Lw, Lh = (located["x_norm"], located["y_norm"],
                      located["w_norm"], located["h_norm"])

    # Precise path: replay the taught label→value offset from where the label
    # ACTUALLY landed. offset is value-centre relative to label TOP-LEFT (the
    # convention _locate_anchor reports), so this is drift-invariant.
    if offset is not None and offset[0] is not None and offset[1] is not None \
       and (offset[0] != 0.0 or offset[1] != 0.0):
        nx = Lx + float(offset[0])
        ny = Ly + float(offset[1])
        return (_clamp01(nx), _clamp01(ny), vw, vh)

    # Legacy fallback: coarse geometric guess (value immediately adjacent).
    Lcy = Ly + Lh / 2.0
    Lcx = Lx + Lw / 2.0
    gap = 0.004
    if direction == "right":
        nx = Lx + Lw + gap + hw      # value starts just right of the label
        ny = Lcy                     # vertically aligned to the label row
    elif direction == "below":
        nx = Lcx                     # centred under the label
        ny = Ly + Lh + gap + hh
    else:  # above
        nx = Lcx
        ny = Ly - gap - hh
    return (_clamp01(nx), _clamp01(ny), vw, vh)


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


def _repair_single_token(img, segment, val_type):
    """Fix the PSM-7 single-token separator artefact: a value that is ONE token
    (no spaces) — a serial, reference or part number — can come back from PSM 7
    with a spurious "/" "\\" or "|" wedged in ("H7R5326676" -> "H/7R5326676"),
    while PSM 8 (single word) reads the same crop cleanly.

    Re-OCR the SAME prepped crop as a single word and accept it ONLY when it is
    the same alphanumeric token with the junk separator removed — so this can
    never change which characters were recognised, only drop a separator that
    does not belong inside an unbroken token. Multi-word values (names/addresses,
    which contain a space) and date fields (where "/" is legitimate) are left
    untouched. Reusable across every supplier/field; no per-document logic."""
    try:
        if (not segment) or (" " in segment) or val_type == "date":
            return segment
        if not re.search(r"[\\/|]", segment):
            return segment
        # Never strip separators from a DATE-SHAPED token (its "/" "." "-" are the
        # date's own separators) even when the field wasn't typed 'date' — a custom
        # or mistyped field that happens to hold "22/06/2025" must not become
        # "22062025". Shape-based, so it protects every supplier/field; a real
        # serial misread with a spurious slash ("H/7R..", "12/34567") does NOT
        # match this strict layout and is still repaired.
        if re.fullmatch(r"\d{1,4}[./\-]\d{1,2}(?:[./\-]\d{1,4})?", segment):
            return segment
        import pytesseract
        # Re-read the SAME prepped crop with configs that cannot emit (or don't
        # invent) the spurious "/" "\\" "|": PSM 7 + alphanumeric whitelist (line
        # mode keeps robustness to padding), then PSM 8 / PSM 8+whitelist (single
        # word — reads tight serials cleanest). Accept the FIRST whose recognised
        # alphanumerics are identical to the corrupted read — so this only strips
        # a junk separator and never changes which glyphs were recognised.
        wl = ("-c tessedit_char_whitelist="
              "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-")
        target = re.sub(r"[^0-9A-Za-z]", "", segment)
        for cfg in ("--oem 3 --psm 7 " + wl,
                    "--oem 3 --psm 8 " + wl,
                    "--oem 3 --psm 8"):
            alt = pytesseract.image_to_string(img, config=cfg).strip().split("\n")[0].strip()
            if alt and re.sub(r"[^0-9A-Za-z]", "", alt) == target:
                return alt
    except Exception:
        pass
    return segment


def _trim_trailing_digit_boundary(segment: str) -> str:
    """Trim a postcode/year boundary from a free-text value: a 4+ digit run that
    is preceded by AT LEAST TWO alphabetic words ("Ann Blume 10115 Berlin" ->
    "Ann Blume"). Fewer leading alpha words means the digits are most likely the
    VALUE'S OWN number (e.g. "Unit 4 1024 Park", "Site 4012"), so the segment is
    kept whole — the previous blanket `\\s+\\d{4,}` split amputated such values
    (a worksheet name/address line cut down to a fragment). Never returns an
    empty head."""
    m = re.search(r'\s+\d{4,}', segment)
    if not m:
        return segment
    head = segment[:m.start()].strip()
    alpha_words = [w for w in head.split() if any(c.isalpha() for c in w)]
    return head if (len(alpha_words) >= 2 and len(head) >= 2) else segment


def clean_crop_segment(text: str | None, val_type: str | None) -> str | None:
    """Select the value segment from a (possibly multi-line) OCR crop read.

    SHARED by the Stage 2 anchor crop (_crop_and_ocr) and the Stage 0.5
    template-mapping crop (template_mapper._clean_value) so a drawn target zone
    is cleaned IDENTICALLY to a learned-anchor crop — one rule, system-wide.

    Rules, in order, on the first non-empty line:
      * Split off Tesseract column-gap noise: 4+ spaces (every field type).
      * For free-text name/address fields (text/multiline_text) ONLY, trim a
        TRAILING postcode/year boundary via _trim_trailing_digit_boundary —
        shape-aware so it never discards a value whose own token is the number
        (reference numbers/amounts are not text-typed and keep their digits).
      * After 2+ words, a word ending in "," is a city separator, not value.
    Returns None when nothing usable remains. Does NOT do single-token separator
    repair (that needs the prepped image; callers apply _repair_single_token)."""
    if not text:
        return None
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        segment = re.split(r' {4,}', line)[0].strip()
        if val_type in ('text', 'multiline_text'):
            segment = _trim_trailing_digit_boundary(segment)
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


def _crop_and_ocr(page_image: "Image.Image", x_norm: float, y_norm: float,
                  w_norm: float = 0.0, h_norm: float = 0.0,
                  val_type: str | None = None, capture = None,
                  verify_fn = None) -> str | None:
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
            # A free-text proper-noun line (a company name in a variable-height
            # block) needs more vertical headroom than a tight numeric token — a
            # clipped ascender/descender corrupts the read. Pad text fields more;
            # numerics keep the tight box (so they don't bleed into the next column).
            if val_type in ("text", "multiline_text"):
                half_h += int(h_norm * h * 0.4) + 6
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
        # Enhance + OCR with the SAME recipe as the ⊕ target-draw tool (region.py)
        # and the Stage 0.5 mapper (template_mapper._prep): greyscale → upscale →
        # autocontrast → sharpen, then PSM 7 (single line) first with PSM 6 as a
        # fallback. The previous plain 2× resize + PSM-6-only read was materially
        # lower quality on tight value crops — it inserted spurious separators
        # (a serial "H7R5326676" read as "H/7R5326676") even though the identical
        # crop read cleanly via the target tool, which uses this recipe. One OCR
        # recipe across every crop path keeps committed reads as good as the
        # preview, for every supplier/field. Lazy import avoids the
        # anchor<->template_mapper module-load cycle.
        from extraction import template_mapper as _tm
        img = _tm._prep(crop)
        text = pytesseract.image_to_string(img, config="--oem 3 --psm 7").strip()
        if not text:
            text = pytesseract.image_to_string(img, config="--oem 3 --psm 6").strip()
        # Shared segment selection (column-gap split, shape-aware postcode/year
        # trim for free-text, city-comma cut) — identical to the Stage 0.5
        # template-mapping crop path. See clean_crop_segment.
        segment = clean_crop_segment(text, val_type)
        if segment:
            segment = _repair_single_token(img, segment, val_type)

        # Degraded TEXT-LINE escalation (Oscar): the base recipe (SHARPEN + global
        # autocontrast) mangles a longer proper-noun line on a degraded scan, and
        # the caller's credibility/format gate then rejects the garbage (empty
        # field). ONLY for free-text fields, and ONLY when the caller says the base
        # read failed its gate (verify_fn) — so tight numerics, clean reads, and
        # the label/wizard paths (which pass no verify_fn) are byte-identical.
        # Re-read the SAME crop with a denoise + adaptive-threshold recipe and
        # accept it only if it now PASSES the gate (so a recovered-but-wrong name
        # still can't commit). See ocr/text_enhance.enhance_text_crop.
        if (verify_fn is not None and val_type in ("text", "multiline_text")
                and not (segment and verify_fn(segment))):
            try:
                from ocr import text_enhance
                eimg = text_enhance.enhance_text_crop(crop)
                etext = pytesseract.image_to_string(eimg, config="--oem 3 --psm 7").strip()
                if not etext:
                    etext = pytesseract.image_to_string(eimg, config="--oem 3 --psm 6").strip()
                eseg = clean_crop_segment(etext, val_type)
                if eseg and verify_fn(eseg):
                    return eseg
            except Exception:
                pass
        return segment or None
    except Exception:
        return None


def _auth_rank(anchor: dict) -> int:
    """Sortable recency rank for an EXPLICIT operator re-teach (⊕): the digits of
    `last_authoritative_at` as an int (e.g. '2026-06-16 18:30:00' -> 20260616183000),
    or 0 when the anchor was only passively auto-learned. A larger value = more
    recently human-corrected. Selection prefers this over raw usage_count so an
    operator's correction takes effect immediately instead of being out-voted by a
    stale anchor that merely accumulated passive confirmations."""
    raw = anchor.get("last_authoritative_at")
    if not raw:
        return 0
    digits = re.sub(r"\D", "", str(raw))
    return int(digits) if digits else 0


def _filter_anchors(anchors: list[dict],
                    supplier_name: str | None,
                    document_type: str | None) -> list[dict]:
    """
    Return anchors relevant to this supplier/doc type, sorted by priority.
    Priority: exact supplier+type match > supplier only > type only > global.
    Within a priority tier, a more-recently AUTHORITATIVELY-taught anchor (⊕
    re-teach) wins over one with merely a higher passive usage_count — so a human
    correction is honoured immediately. usage_count is the final tie-break.
    """
    def priority(a):
        s_match = (a.get("supplier_name") or "").lower() in \
                  (supplier_name or "").lower()
        t_match = (a.get("document_type") or "") == (document_type or "")
        if s_match and t_match: return 0
        if s_match:             return 1
        if t_match:             return 2
        return 3

    # An EXPLICIT operator teach (last_authoritative_at set) outranks ALL merely
    # passively-learned anchors, BEFORE supplier-priority is even considered — a
    # human correction must never lose to a stale auto-learned anchor just because
    # the latter happens to be tagged to the supplier the template/logo resolved.
    # Within each bucket the existing priority/recency/usage order applies; among
    # explicit teaches, the most recent wins.
    def auth_bucket(a):
        return 0 if _auth_rank(a) > 0 else 1

    filtered = [
        a for a in anchors
        if _anchor_matches(a, supplier_name, document_type)
    ]
    return sorted(filtered, key=lambda a: (
        auth_bucket(a), priority(a), -_auth_rank(a), -a.get("usage_count", 1)))


def _anchor_matches(anchor: dict, supplier_name: str | None,
                    document_type: str | None) -> bool:
    a_sup  = (anchor.get("supplier_name") or "").lower().strip()
    a_type = anchor.get("document_type") or ""
    s_name = (supplier_name or "").lower().strip()
    d_type = document_type or ""

    # A typed anchor must NOT cross into a DIFFERENT known doc type — even for the
    # same supplier. One supplier often sends several doc types (e.g. a supplier
    # that issues both purchase orders AND worksheets); without this guard, that
    # supplier's purchase_order anchors (po_number/po_date) fire on its worksheets
    # too, producing a Frankenstein field set from every type the supplier was
    # ever taught under. The doc-type IS the layout (see migration-20 note), so a
    # field taught for one layout must not leak onto another. Only enforced when
    # BOTH types are known; if detection couldn't resolve the doc type, the broad
    # supplier fallback below still applies (unchanged), so nothing regresses.
    type_conflict = bool(a_type and d_type and a_type != d_type)

    # Global anchors always apply — unless they carry a conflicting doc type.
    if a_sup in ("__unknown__", "__global__", ""):
        return not type_conflict
    # Supplier match — exact (normalised), not substring. Substring matching
    # ("a_sup in s_name or s_name in a_sup") lets one supplier's anchors fire
    # on another whenever one name contains the other (e.g. a short supplier
    # name that happens to be a substring of a longer one) — the same
    # collision class that made the 'PO' template anchor match inside
    # "Polychemtex Inc.". A doc-type conflict still vetoes a supplier match.
    if a_sup and s_name and a_sup == s_name:
        return not type_conflict
    # Doc type match (e.g. a different supplier, same layout family).
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
