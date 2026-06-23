"""
extraction/anchor.py
--------------------
Stage 2 extraction — spatial anchor matching.
Uses learned label positions to find field values directly in OCR text.
Faster and more accurate than LLM for known document layouts.
"""

import math
import re

from PIL import Image

from extraction import registration   # pure NumPy; no cycle (registration imports nothing here)


def _qualify_against_format(value, field_key, format_lookup, text_field_keys=None):
    """Qualify a learned-anchor value against the field's LEARNED format (the same
    doc-type-scoped shape model Stage 4.5 uses). Returns the value to commit —
    possibly TRIMMED to the learned shape (e.g. a column-bleed read reduced to the
    reference) — or None when it's inconsistent with the learned format and no
    accepted-shape substring can be recovered (so a confidently-wrong crop like
    "Bookinc" is rejected instead of committed). No lookup / no learned format /
    already-consistent value → returned unchanged. Only ever TIGHTENS for fields
    that have actually learned a format; never loosens. Lazy import avoids any
    module-load cycle.

    FREE-TEXT EXEMPTION: a free-text, non-ref field (name/company/address — the
    `text_field_keys` set, the SAME set the Stage 4.5 free-text guard uses) has a
    legitimately variable shape, so the learned-SHAPE veto must NOT withhold it HERE — it
    exists to trim column-bleed off STRUCTURED refs. Without this a clean "Beaumont Care
    Homes Ltd - <new site>" was dropped on "format" at Stage 2 before Stage 4.5's softer
    flag-not-withhold could ever run. Structured refs (NOT in text_field_keys) keep the veto."""
    if not value or format_lookup is None:
        return value
    if text_field_keys and field_key in text_field_keys:
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
                         on_reject = None,
                         page_text_lines = None,
                         text_field_keys = None) -> dict:
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
    # Per-page OCR cache (Stage 1 / #4): every field whose rigid crop fails does a
    # page-wide label locate; without sharing, each re-ran a full-page image_to_data
    # (~2s). One cache for this page collapses them to a single pass (see
    # template_mapper._locate_anchor). Especially hot when NO template matched and
    # all fields fall here.
    line_cache = {}

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
        # OCR quality of the crop that produced the WINNING value (None for the
        # text-fallback / inline paths, which don't crop+re-OCR). Threaded into the
        # confidence so a garbled read scores low instead of riding usage_count.
        ocr_conf = None
        ocr_min  = None

        # "Did this crop read a value we'd actually commit?" — the same
        # credibility + learned-format gate the merge below applies. Passed into
        # the crop reader so a degraded TEXT line that fails it triggers the
        # heavier denoise/adaptive re-read (text fields only); a passing read
        # short-circuits with zero extra work.
        def _verify(t, _vt=val_type, _fk=field_key, _lbl=label):
            return (bool(t)
                    and _crop_is_credible(t, _vt, validation_patterns, _lbl)
                    and bool(_qualify_against_format(t, _fk, format_lookup, text_field_keys)))

        # ── Primary: image crop + re-OCR (accurate, avoids column bleed) ──────
        if x_norm > 0 and y_norm > 0 and page0 is not None:
            w_norm   = anchor.get("w_norm") or 0.0
            h_norm   = anchor.get("h_norm") or 0.0
            _cap = ((lambda c: slice_capture(field_key, "anchor_crop", 0,
                       (x_norm, y_norm, w_norm, h_norm), c, "target")) if slice_capture else None)
            _m = {}
            crop_value = _crop_and_ocr(page0, x_norm, y_norm, w_norm, h_norm, val_type, capture=_cap, verify_fn=_verify, meta=_m)
            # A fixed crop is positionally rigid: when an upstream line wraps or
            # the block shifts on a sibling layout, the box can land off-target
            # and return a NON-EMPTY but wrong value (e.g. ">alifornia" from the
            # line below the name). Keep the crop only when it is credible for
            # this field; otherwise leave value=None so the anchor_label +
            # direction search below runs and gets a chance to relocate it.
            if crop_value and not _crop_is_credible(crop_value, val_type, validation_patterns, label):
                if on_reject: on_reject(field_key, "anchor_crop", crop_value, "not_credible")
            elif crop_value:
                # Also qualify against the learned format: a fixed crop that drifted
                # onto the wrong row reads a NON-EMPTY, credible-looking but wrong
                # value ("Bookinc" where the reference is shaped "####-####-#").
                # Reject/trim it so value stays None and the label search below gets
                # a chance to relocate the right value, instead of committing the
                # garbage at high confidence.
                qualified = _qualify_against_format(crop_value, field_key, format_lookup, text_field_keys)
                if qualified:
                    value  = qualified
                    method = "anchor_crop"
                    ocr_conf, ocr_min = _m.get('conf'), _m.get('min_conf')
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
        if (not value or _is_weak_read(value, val_type)) and page_transform is not None \
                and x_norm > 0 and y_norm > 0 and page0 is not None:
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
            _mg = {}
            gval = _crop_and_ocr(page0, rcx, rcy, w_norm, h_norm, val_type, capture=_gcap, verify_fn=_verify, meta=_mg)
            if gval and not _crop_is_credible(gval, val_type, validation_patterns, label):
                if on_reject: on_reject(field_key, "anchor_registration", gval, "not_credible")
            elif gval:
                q = _qualify_against_format(gval, field_key, format_lookup, text_field_keys)
                if q:
                    if _should_replace(value, q, val_type, validation_patterns):
                        value  = q
                        method = "anchor_registration"
                        ocr_conf, ocr_min = _mg.get('conf'), _mg.get('min_conf')
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
        # Fires when the rigid read is empty, a weak free-text fragment, not
        # STRICTLY credible (high-DPI crop garbage like "cield wu" that slips
        # through the loose gate), OR — for free-text — a LOW-confidence crop read
        # (a clipped/drifted name like "Danirmant fara WMamac" @ conf 34 that the
        # loose floor accepts but OCR confidence flags): _strict_credible now folds
        # the rigid read's ocr_conf in. A cleanly-read rigid value (conf >= 60,
        # strictly credible) skips the rung, so the fast happy path stays
        # byte-identical (no extra OCR on good reads).
        if (not value or _is_weak_read(value, val_type)
                or not _strict_credible(value, val_type, validation_patterns, ocr_conf=ocr_conf)) \
                and page0 is not None and (anchor.get("anchor_label") or "").strip():
            w_norm = anchor.get("w_norm") or 0.0
            h_norm = anchor.get("h_norm") or 0.0
            vbox    = (x_norm, y_norm, w_norm, h_norm)
            located = _locate_for_relocation(page0, anchor["anchor_label"], direction, vbox, page_text_lines,
                                             line_cache=line_cache)
            if located:
                # 1. INLINE HARVEST: in a key/value row the value shares the located
                # label's OCR line ("label …gap… value") and sits in a far column the
                # adjacency guess can't reach — so read it STRAIGHT off the located
                # line. Cleaned/narrowed (date pattern, column-gap split) and held to
                # the SAME credibility + learned-format gates as a crop read, so it
                # can never commit something a crop read would have rejected.
                iv = located.get("inline_value")
                if iv:
                    hv = _clean_text_fallback(iv, val_type, validation_patterns) or clean_crop_segment(iv, val_type)
                    # A code-like value column ("2602-0768-1 Work Address …") is a
                    # single token; keep the first (the harvest already excludes the
                    # label, so the first token is the value, not a caption).
                    if hv and val_type == "alphanumeric" and " " in hv:
                        hv = hv.split()[0]
                    # Strip leading OCR edge-junk ("--«", ">>") that scan noise / handwriting
                    # bleeds onto the harvested line — otherwise a CORRECT value
                    # ("--« Beaumont Care Homes Ltd -") is rejected by the credibility gate
                    # (which requires an alphanumeric first char) and the field falls through to
                    # a wrong-column read. Same strip_name_edges already applied at the Stage 1
                    # keyword capture + Stage 4.5 catch-all; bring it to the inline harvest too.
                    # Free-text only; over-strip-guarded inside strip_name_edges.
                    if hv and val_type in (None, "text", "multiline_text"):
                        from extraction.value_quality import strip_name_edges
                        hv = strip_name_edges(hv)
                    # Cross-field guard: never inline-harvest a code/reference-shaped value
                    # into a NAME field (the merged-row "Work Address" line also carries the
                    # ticket reference). See _name_field_code_reject.
                    if hv and _name_field_code_reject(hv, field_key):
                        if on_reject: on_reject(field_key, "anchor_inline", hv, "cross_field_code")
                        hv = None
                    if hv and _crop_is_credible(hv, val_type, validation_patterns, label):
                        q = _qualify_against_format(hv, field_key, format_lookup, text_field_keys)
                        if q and _should_replace(value, q, val_type, validation_patterns, inc_ocr_conf=ocr_conf):
                            value  = q
                            method = "anchor_inline"
                            # The value now comes off the located LINE, not a crop —
                            # restore the documented "None for inline reads" invariant
                            # so the confidence cap and the placement rung below treat
                            # it as a clean located read, not the (possibly low) rigid
                            # crop conf it's replacing.
                            ocr_conf, ocr_min = None, None
                            # Dev trace: emit a slice for the harvested value's region
                            # so the inspector can highlight where an inline read came
                            # from (these reads don't crop+re-OCR, so without this the
                            # winning value has no box). Only fires under --trace.
                            _ib = located.get("inline_box")
                            if slice_capture and _ib:
                                try:
                                    _ibox = (_ib["x_norm"], _ib["y_norm"], _ib["w_norm"], _ib["h_norm"])
                                    _icrop = page0.crop((int(_ib["x_norm"] * page0.size[0]),
                                                         int(_ib["y_norm"] * page0.size[1]),
                                                         int((_ib["x_norm"] + _ib["w_norm"]) * page0.size[0]),
                                                         int((_ib["y_norm"] + _ib["h_norm"]) * page0.size[1])))
                                    slice_capture(field_key, "anchor_inline", 0, _ibox, _icrop, "target")
                                except Exception:
                                    pass   # dev-only; never disrupt extraction
                    elif hv and on_reject:
                        on_reject(field_key, "anchor_inline", hv, "not_credible")
                # 2. PLACEMENT + CROP: value not on the label's line (label-above
                # layouts) or harvest failed — seat a crop relative to the LABEL box
                # (not the whole line) and re-OCR it.
                if not value or _is_weak_read(value, val_type) \
                        or not _strict_credible(value, val_type, validation_patterns, ocr_conf=ocr_conf):
                    relo = _place_from_located(located, direction, vbox,
                        offset=(anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")))
                    if relo:
                        # Widen a touch (centre-preserved) so a value marginally
                        # wider than the tight taught box isn't sheared.
                        relo = _widen_relocated_crop(relo, val_type)
                        _rcap = ((lambda c: slice_capture(field_key, "anchor_relocate", 0,
                                    relo, c, "target")) if slice_capture else None)
                        _mr = {}
                        rval = _crop_and_ocr(page0, relo[0], relo[1], relo[2], relo[3],
                                             val_type, capture=_rcap, verify_fn=_verify, meta=_mr)
                        _xfield = bool(rval) and _name_field_code_reject(rval, field_key)
                        if rval and (_xfield or not _crop_is_credible(rval, val_type, validation_patterns, label)):
                            if on_reject:
                                on_reject(field_key, "anchor_crop_relocated", rval,
                                          "cross_field_code" if _xfield else "not_credible")
                        elif rval:
                            q = _qualify_against_format(rval, field_key, format_lookup, text_field_keys)
                            if q:
                                if _should_replace(value, q, val_type, validation_patterns, inc_ocr_conf=ocr_conf):
                                    value  = q
                                    method = "anchor_crop_relocated"
                                    ocr_conf, ocr_min = _mr.get('conf'), _mr.get('min_conf')
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

        # Text-fallback values (method 'anchor') are raw line slices that never
        # went through the crop paths' shared cleaning, so a label-band
        # over-capture ("2605-0769-1 Work Address Beaumont…") would commit whole.
        # Narrow a structured field to its pattern match and clean a free-text
        # field with the shared segment cleaner. Crop/relocate/registration values
        # are already cleaned, so only the text path is touched. Reusable.
        if value and method == "anchor":
            value = _clean_text_fallback(value, val_type, validation_patterns) or value

        # Never commit an implausible value — whether from a drifted crop or a
        # fallback line that landed on an adjacent label (e.g. ". Ship Mode:").
        # Leaving the field empty routes it to review/manual entry instead of a
        # confidently-wrong read; a credible value (the normal case) is kept.
        if value and not _crop_is_credible(value, val_type, validation_patterns, label):
            value = None

        # Final learned-format gate — also covers the text-fallback value, so a
        # label-search read that grabbed the wrong token is rejected/trimmed too.
        if value:
            value = _qualify_against_format(value, field_key, format_lookup, text_field_keys)

        # Name-quality gate (Part 3): a NAME/company/address field whose read is a
        # garbled MULTI-WORD string ("Fr eanehae Crane", "67 Boucher Cre") is OCR
        # junk, not a real name — DROP it so it can't win (Tier-A / confidence)
        # over a credible mapping / keyword / learned hint, and so the empty field
        # falls to hint-recovery. Single-token brands ("3M", "IBM") aren't judged.
        # Reusable for every name-like field. See extraction/value_quality.py.
        if value and len(str(value).split()) >= 2:
            from extraction.value_quality import is_name_like_field, name_quality
            if is_name_like_field(field_key) and name_quality(value) < 0.5:
                value = None

        if value:
            conf = min(95, 55 + (usage_count * 5) + int(conf_factor * 20))
            if method == "anchor_crop":
                conf = min(97, conf + 5)  # image crop is more reliable
            elif method == "anchor_inline":
                # Value read directly off the located label's OCR line — a clean
                # text read, no crop drift; reliable, ranks with a good rigid crop.
                conf = min(93, conf + 5)
            elif method == "anchor_crop_relocated":
                # Drift-relocated crop: more reliable than a blind text-line grab,
                # but a touch below a clean rigid crop since the page had shifted.
                conf = min(92, conf + 2)
            elif method == "anchor_registration":
                # Multi-landmark page transform — score by the FIT quality (inliers
                # + residual), not usage_count. Ranks above single-label relocate
                # (stronger geometry) and below a clean rigid crop.
                conf = min(93, registration.registration_confidence(page_transform))
            # ── OCR-QUALITY CAP (FREE-TEXT ONLY): for a name/address field there is
            # no regex to validate the read, so the crop's mean OCR confidence is the
            # only quality signal — without this a garbled crop ("Aaiumant Care Homes
            # Ltd - Galaorm") scored in the 90s on usage_count alone. Cap the field
            # confidence at the crop's mean word confidence + a small margin: a clean
            # crop (mean ~90) is unaffected (cap ≥ 95), a poor read (mean ~65) drops
            # to ~70 and is routed to review.
            # SCOPED TO FREE-TEXT: a STRUCTURED value (date/currency/alphanumeric
            # reference) that already passed its regex/type gate is validated by the
            # PATTERN, not by Tesseract's per-glyph confidence — which is routinely
            # low on isolated digit groups and dashes. Applying the cap there sank a
            # correct reference "2602-0768-1" to 18% (mean conf ~13). For those fields
            # the regex IS the trust signal, so the cap (and the Tier-A min-conf
            # signal below) is skipped.
            _is_free_text = val_type in (None, "text", "multiline_text")
            if ocr_conf is not None and _is_free_text:
                conf = min(conf, int(ocr_conf) + 5)
            # ── LOCATED gate: Tier-A trust requires the anchor to be on THIS page ──
            # A label/landmark-confirmed read (text-fallback / inline / relocated /
            # registration) is located by construction. A RIGID anchor_crop is
            # located only if it has NO label (a pure-coordinate anchor, trusted by
            # design) OR its label is actually present here. An AUTHORITATIVE anchor
            # that resolved rigidly with a label gets that label CONFIRMED — a label
            # that can't be found (e.g. the field's own name "Supplier Name", never
            # printed on the page) means the box is a BLIND read of stale coordinates
            # reading the wrong row ("a? Boucher Gres" off the address line). Such a
            # read must NOT win Tier-A over a located mapping, and can't carry a high
            # confidence. Cost (one locate) is paid ONLY for authoritative rigid
            # anchors — the Tier-A claimants; passive/label-less anchors are unchanged.
            located_ok = method in ("anchor", "anchor_inline",
                                    "anchor_crop_relocated", "anchor_registration")
            if not located_ok:                            # a RIGID anchor_crop read
                if not anchor.get("last_authoritative_at"):
                    located_ok = True                     # passive: 'located' never consulted (Tier-A needs authoritative)
                else:
                    # An AUTHORITATIVE rigid read is trustworthy ONLY if its label is
                    # CONFIRMED on this page. A LABEL-LESS anchor (nothing to verify —
                    # e.g. a field-name caption sanitised to empty) is a BLIND
                    # coordinate read that can't self-verify or drift-correct and
                    # silently reads the wrong row ("57 Boucher Crescent" off the
                    # address), so it must NOT be treated as located. A labelled
                    # anchor must have its label actually found here.
                    _lbl = (anchor.get("anchor_label") or "").strip()
                    located_ok = bool(_lbl) and bool(_locate_for_relocation(
                        page0, _lbl, direction,
                        (x_norm, y_norm, anchor.get("w_norm") or 0.0, anchor.get("h_norm") or 0.0),
                        page_text_lines, line_cache=line_cache))
            if not located_ok:
                conf = min(conf, 50)   # blind rigid read (label absent/unfound) — untrustworthy
            results[field_key] = {
                "value":      value.strip(),
                "confidence": conf,
                "method":     method,
                "anchor":     anchor["anchor_label"],
                # True only for an EXPLICIT operator ⊕ re-teach (last_authoritative_at
                # set) — "manually drawn", precedence tier 1. A passively auto-learned
                # anchor is an automatic guess (tier 3); the engine lets an admin label
                # override (tier 2) outrank it but never an authoritative anchor.
                "authoritative": bool(anchor.get("last_authoritative_at")),
                # Whether the anchor was CONFIRMED on this page (see LOCATED gate
                # above). engine Tier-A requires this so a blind authoritative read
                # can't dominate a located mapping. Defaults True for callers/tests
                # that build results directly.
                "located": located_ok,
                # Minimum SUBSTANTIAL-word OCR confidence of the crop that produced
                # this value (None for inline/text reads). The engine's Tier-A gate
                # uses it so an authoritative ⊕ anchor whose crop read a garbled word
                # ("Aaiumant"/"Galaorm" min ~55) does NOT win OUTRIGHT over a clean
                # keyword value — it falls through to the confidence contest, where
                # its OCR-capped confidence loses to the clean read. SCOPED TO
                # FREE-TEXT (same reason as the cap above): a regex-valid structured
                # value isn't judged by Tesseract's digit confidence, so it carries
                # no min-conf signal (None → Tier-A unaffected).
                "ocr_min_conf": ocr_min if _is_free_text else None,
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


def _widen_relocated_crop(box, val_type):
    """Add a modest, CENTRE-PRESERVING margin to a RELOCATED crop so a value
    marginally wider than the tight taught box (a longer name on this page,
    sub-pixel offset rounding) is not sheared at its edges — the "Beaumont"→"mont"
    class of clip. Symmetric, so it never moves the drift-invariant value centre
    that _relocate_value_by_label computed (that position is a tested contract);
    pads are NORMALISED (page-dim fractions), so DPI-invariant. Kept small to stay
    clear of an adjacent label, with extra vertical headroom for text lines
    (ascenders/descenders). Applied ONLY on the relocate fallback crop, so the
    rigid happy path is byte-identical. Reusable across every supplier/field."""
    cx, cy, w, h = box
    pad_w = 0.010
    pad_h = 0.006 if val_type in ("text", "multiline_text") else 0.0
    return (cx, cy, w + 2 * pad_w, h + 2 * pad_h)


def _locate_in_text_lines(text_lines, lbox, anchor_label):
    """BORN-DIGITAL path: locate the label among PRECOMPUTED text-layer lines
    (exact vector text, already page-normalised) within the lbox row band, with NO
    crop and NO OCR. Returns the SAME result shape as template_mapper._locate_anchor
    (label-word box + harvested inline value), reusing the shared label-match
    helpers so behaviour matches the OCR path exactly — just exact and faster."""
    from extraction import template_mapper as tm
    needle = tm._normalise(anchor_label) if anchor_label else None
    if not needle or not text_lines:
        return None
    acx = lbox["x_norm"] + lbox["w_norm"] / 2.0
    acy = lbox["y_norm"] + lbox["h_norm"] / 2.0
    band = max(lbox["h_norm"], 0.0)
    cands = []
    for ln in text_lines:
        cy = ln["y_norm"] + ln["h_norm"] / 2.0
        if cy < lbox["y_norm"] - band or cy > lbox["y_norm"] + lbox["h_norm"] + band:
            continue
        s = tm._label_score(needle, tm._normalise(ln.get("text", "")))
        if s >= tm._FUZZY_MATCH_THRESHOLD:
            cands.append((s, ln))
    if not cands:
        return None
    best_score = max(s for s, _ in cands)
    floor = max(best_score - tm._SCORE_TIE_EPSILON, tm._FUZZY_MATCH_THRESHOLD)

    def _dist(ln):
        cx = ln["x_norm"] + ln["w_norm"] / 2.0
        cy = ln["y_norm"] + ln["h_norm"] / 2.0
        return math.hypot(cx - acx, cy - acy)

    chosen_score, best = min(((s, ln) for s, ln in cands if s >= floor),
                             key=lambda sl: (_dist(sl[1]), -sl[0]))

    label_box = None
    inline_value = None
    inline_box = None
    words = best.get("words") or []
    run = tm._match_label_run(words, needle)
    if run:
        rx1 = min(w["x_norm"] for w in run)
        rx2 = max(w["x_norm"] + w["w_norm"] for w in run)
        ry1 = min(w["y_norm"] for w in run)
        ry2 = max(w["y_norm"] + w["h_norm"] for w in run)
        label_box = {"x_norm": rx1, "y_norm": ry1, "w_norm": rx2 - rx1, "h_norm": ry2 - ry1}
        rest = words[len(run):]
        if rest:
            inline_value = " ".join(w["text"] for w in rest).strip() or None
            # Tight bbox of the VALUE words (top-left convention) so the dev trace
            # can highlight exactly where an inline-harvested value was read.
            vx1 = min(w["x_norm"] for w in rest)
            vx2 = max(w["x_norm"] + w["w_norm"] for w in rest)
            vy1 = min(w["y_norm"] for w in rest)
            vy2 = max(w["y_norm"] + w["h_norm"] for w in rest)
            inline_box = {"x_norm": vx1, "y_norm": vy1, "w_norm": vx2 - vx1, "h_norm": vy2 - vy1}
    return {
        "x_norm": best["x_norm"], "y_norm": best["y_norm"],
        "w_norm": best["w_norm"], "h_norm": best["h_norm"],
        "matched_text": best.get("text"), "match_score": chosen_score,
        "label_box": label_box, "inline_value": inline_value, "inline_box": inline_box,
    }


def _locate_for_relocation(page0, anchor_label, direction, vbox, page_text_lines=None,
                           line_cache=None):
    """Find `anchor_label` on THIS page and return template_mapper._locate_anchor's
    result (now carrying the matched LABEL-WORD box and any value harvested off the
    same line), or None. Shared by the relocation crop placement AND the inline
    value harvest so the label is located ONCE. When `page_text_lines` (a born-
    digital text layer) is supplied, the label is found EXACTLY in that layer with
    no OCR. `line_cache` (one per page, from extract_with_anchors) shares the
    full-page OCR across every field's page-wide fallback (Stage 1 / #4). Lazy
    import avoids the anchor<->template_mapper module-load cycle."""
    label = (anchor_label or "").strip()
    if not label or page0 is None:
        return None
    cx, cy, vw, vh = (vbox[0] or 0.0), (vbox[1] or 0.0), (vbox[2] or 0.0), (vbox[3] or 0.0)
    if vw <= 0 or vh <= 0:
        return None
    # Search a FULL-PAGE-WIDTH strip at the label's row (not a narrow box beside
    # the value). A key/value value can sit in a FAR column ("label …big gap…
    # value"); a narrow locate box would crop the value out, so it could never be
    # harvested off the located line. Full width keeps the whole row in one OCR
    # line; the located POSITION is still taken from the matched LABEL words, so a
    # wrong nearby label is still rejected by the fuzzy threshold.
    band = max(vh * 2.5, 0.03)
    if direction == "right":      # label on the SAME row as the value
        ly = cy
    elif direction == "below":    # label one line ABOVE the value
        ly = cy - vh
    elif direction == "above":    # label one line BELOW the value
        ly = cy + vh
    else:
        return None
    lbox = {"x_norm": 0.0, "y_norm": _clamp01(ly - band / 2.0), "w_norm": 1.0, "h_norm": band}

    # Born-digital: locate EXACTLY in the embedded text layer (no crop, no OCR).
    if page_text_lines:
        return _locate_in_text_lines(page_text_lines, lbox, label)

    from extraction import template_mapper as tm
    # Local search first (covers normal drift), then page-wide (clipped/heavily
    # shifted scans move the label out of the local window).
    located = tm._locate_anchor(page0, lbox, label, 0.0, tm._ocr_lines,
                                min_search=0.10, line_cache=line_cache)
    if not located:
        located = tm._locate_anchor(page0, lbox, label, 1.0, tm._ocr_lines,
                                    min_search=0.10, line_cache=line_cache)
    return located


def _place_from_located(located, direction, vbox, offset=None):
    """Derive the value-crop box (cx, cy, w, h — _crop_and_ocr convention) from a
    located label. Prefers the tight LABEL-WORD box (`label_box`) over the whole
    OCR-line box, so the value is seated relative to the LABEL not "label …gap…
    value" (the line box overshoots the value). With a stored drift-invariant
    `offset` we replay label-top-left + offset exactly; otherwise we use the coarse
    adjacency guess. (Same return contract as before; the line box is still used
    when no label_box is present, e.g. stubbed tests.)"""
    cx, cy, vw, vh = (vbox[0] or 0.0), (vbox[1] or 0.0), (vbox[2] or 0.0), (vbox[3] or 0.0)
    hw, hh = vw / 2.0, vh / 2.0
    lb = located.get("label_box") or located
    Lx, Ly, Lw, Lh = lb["x_norm"], lb["y_norm"], lb["w_norm"], lb["h_norm"]

    if offset is not None and offset[0] is not None and offset[1] is not None \
       and (offset[0] != 0.0 or offset[1] != 0.0):
        nx = Lx + float(offset[0])
        ny = Ly + float(offset[1])
        return (_clamp01(nx), _clamp01(ny), vw, vh)

    Lcy = Ly + Lh / 2.0
    Lcx = Lx + Lw / 2.0
    gap = 0.004
    if direction == "right":
        nx = Lx + Lw + gap + hw      # value starts just right of the label
        ny = Lcy
    elif direction == "below":
        nx = Lcx
        ny = Ly + Lh + gap + hh
    else:  # above
        nx = Lcx
        ny = Ly - gap - hh
    return (_clamp01(nx), _clamp01(ny), vw, vh)


def _relocate_value_by_label(page0, anchor_label, direction, vbox, offset=None, line_cache=None):
    """Drift recovery for a ⊕-taught anchor: locate `anchor_label` on THIS page and
    return a value-crop box positioned relative to it, or None if it can't be
    found. Thin composition of _locate_for_relocation + _place_from_located (the
    extraction rung uses those two directly so it can ALSO harvest a same-line
    value before falling back to a crop)."""
    vw = vbox[2] or 0.0
    vh = vbox[3] or 0.0
    if vw <= 0 or vh <= 0:
        return None
    located = _locate_for_relocation(page0, anchor_label, direction, vbox, line_cache=line_cache)
    if not located:
        return None
    return _place_from_located(located, direction, vbox, offset)


def _is_low_entropy(v: str) -> bool:
    """Reject obvious OCR debris from a crop that landed on a ruled line or blank
    band: a value with almost no distinct characters ("ee ee ee ee") or one made
    mostly of tiny fragments ("5 de oe et Ee ee ee ee ..."). Shape-based and
    reusable — a real name/address/reference has many distinct characters and
    full-length words, so it is never flagged."""
    nonspace = v.replace(" ", "")
    if len(nonspace) >= 6 and len(set(nonspace.lower())) < 4:
        return True
    tokens = v.split()
    if len(tokens) >= 4:
        short = sum(1 for t in tokens if len(t) <= 2)
        if short >= len(tokens) * 0.6:
            return True
    return False


def _is_bare_label(v: str, label: str | None) -> bool:
    """Reject a read whose EVERY token belongs to the anchor's OWN label — i.e.
    the crop drifted onto the label itself ("Field" where the field caption is
    "...Field", "Work Address" reading the caption). Defined relative to THIS
    anchor's label, so it needs no hardcoded word list; a genuine value that
    merely shares one word with the label is kept (must be a FULL subset)."""
    if not label:
        return False
    label_tokens = set(re.findall(r"[a-z0-9]+", label.lower()))
    val_tokens = re.findall(r"[a-z0-9]+", v.lower())
    if not label_tokens or not val_tokens:
        return False
    return all(t in label_tokens for t in val_tokens)


# Mean OCR word-confidence floor below which a FREE-TEXT rigid crop read is treated
# as suspect (clipped/drifted) and routed to the label-located harvest. Validated
# empirically: garbled cust reads land at 17-34, clean reads at 87-95, so 60 sits in
# a wide empty gap. Free-text only (structured fields trust their regex, not conf).
_FREE_TEXT_RESCUE_CONF = 60


def _name_field_code_reject(value, field_key):
    """CROSS-FIELD guard: a NAME-LIKE field must hold a NAME, never a reference/code.
    On a MERGED OCR row a harvest/relocation can grab the wrong column — e.g. the ticket
    reference "2602-0926-1" sitting on the same OCR line as "Work Address" gets read into
    cust. A code-shaped value has NO run of >= 3 letters; reject it so the field falls
    through (or stays empty for review) instead of committing a cross-field value.
    Reusable: any name-like field, any supplier/layout. Imports value_quality lazily to
    avoid a load cycle."""
    from extraction.value_quality import is_name_like_field
    v = (value or "").strip()
    return bool(v) and is_name_like_field(field_key) and re.search(r"[A-Za-z]{3,}", v) is None


def _is_weak_read(value, val_type):
    """A committable-but-SUSPECT rigid read for a FREE-TEXT field: a single short
    token where a name/address is expected (the "nara"/"Field" fragment class).
    Lets drift recovery run as a CANDIDATE even though the read passed the
    credibility gate. Conservative — only text/multiline fields and only a short
    single token; numbers/dates/refs and multi-word names are never weak, so the
    clean happy path is unaffected."""
    if val_type not in ("text", "multiline_text"):
        return False
    v = (value or "").strip()
    return bool(v) and (" " not in v) and len(v) <= 5


def _should_replace_weak(incumbent, candidate, val_type):
    """Whether a relocation/registration CANDIDATE should replace the current
    value. An empty slot always takes the candidate. A STRONG incumbent is never
    displaced (so a clean rigid read is untouched). A WEAK incumbent is replaced
    only by a clearly stronger candidate (not itself weak, and meaningfully
    longer) — on a clean page the relocated crop reads the SAME value, so it stays
    weak and is NOT preferred, which prevents regressions; only a genuinely better
    read on a drifted page wins."""
    inc = (incumbent or "").strip()
    if not inc:
        return True
    if not _is_weak_read(inc, val_type):
        return False
    cand = (candidate or "").strip()
    return (not _is_weak_read(cand, val_type)) and len(cand) >= len(inc) + 3


def _strict_credible(value, val_type, validation_patterns, ocr_conf=None):
    """Stricter trust test used to decide whether a committed RIGID value should
    yield to a label-anchored harvest. Basic credibility PLUS a single-token rule
    for code-like fields (alphanumeric/job_reference/currency_code) — a reference
    or serial has no internal space, so high-DPI crop GARBAGE that slips through
    the loose pattern ("cield wu", "Ba he WE CUE") is rejected here, while a clean
    single-token read ("2602-0768-1", "INV-001") passes and is never displaced.

    `ocr_conf` (the rigid read's MEAN word confidence, when known): a FREE-TEXT
    rigid read whose mean confidence is below _FREE_TEXT_RESCUE_CONF is a clipped/
    drifted crop whose garbage still clears the loose free-text floor ("Danirmant
    fara WMamac" @ 34) — there is no regex to catch it, so OCR confidence is the
    only quality signal. Treat such a read as NOT strictly credible so the
    label-located harvest rescues it. SCOPED to free-text: a structured value is
    validated by its regex (Tesseract under-reports digit-group confidence, so a
    floor there would sink a valid reference). ocr_conf is None for inline/text
    reads (no crop) and for callers that don't thread it -> fully trusted, so the
    clean happy path and every other caller stay byte-identical."""
    v = (value or "").strip()
    if not v or not _crop_is_credible(v, val_type, validation_patterns):
        return False
    if val_type in ("alphanumeric", "job_reference", "currency_code") and " " in v:
        return False
    if (val_type in (None, "text", "multiline_text")
            and ocr_conf is not None and ocr_conf < _FREE_TEXT_RESCUE_CONF):
        return False
    return True


def _should_replace(incumbent, candidate, val_type, validation_patterns, inc_ocr_conf=None):
    """Whether a label-anchored harvest/relocation CANDIDATE should replace the
    current (rigid) value. GATED RESCUE (Bob): a STRICTLY-credible incumbent is
    never displaced — a clean rigid read is protected, no unconditional override.
    Only when the incumbent FAILS the strict gate AND the candidate PASSES it does
    the candidate win (the high-DPI rigid-garbage case the harvest fixes).
    Otherwise fall back to the conservative weak-free-text rule.

    `inc_ocr_conf` (the incumbent rigid read's mean confidence) lets a LOW-confidence
    free-text incumbent count as not-strictly-credible (see _strict_credible), so a
    clean label-located candidate (no crop conf -> trusted) can displace it. The
    candidate is judged WITHOUT a conf (it came off the located line, not a crop)."""
    inc = (incumbent or "").strip()
    if not inc:
        return True
    if _strict_credible(inc, val_type, validation_patterns, ocr_conf=inc_ocr_conf):
        return False
    if _strict_credible(candidate, val_type, validation_patterns):
        return True
    return _should_replace_weak(inc, candidate, val_type)


def _crop_is_credible(value: str, val_type: str | None,
                      validation_patterns: dict | None,
                      label: str | None = None) -> bool:
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

    # Shape/relationship rejects applied to EVERY field class — a loose typed
    # pattern such as 'alphanumeric' otherwise accepts a bare label word or a
    # repeated-glyph band. Reusable; no supplier/filename/coordinate.
    if _is_low_entropy(v):
        return False
    if _is_bare_label(v, label):
        return False

    pats = (validation_patterns or {}).get(val_type) if val_type else None
    if pats:
        return any(re.search(p, v, re.IGNORECASE) for p in pats)

    # Free-text: must start with an alphanumeric char and be mostly alphanumeric.
    # Also require a minimum of 3 non-space characters — a single letter or two-char
    # fragment ("a", "be") is always an OCR artefact, never a real name/address/value.
    # Typed fields (alphanumeric, currency, etc.) are already gated by their pattern
    # which enforces its own minimum length; this floor only applies to the free-text
    # path so it cannot accidentally tighten structured-field reads.
    if not v[0].isalnum():
        return False
    nonspace = [c for c in v if not c.isspace()]
    if len(nonspace) < 3:
        return False
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


def _clean_text_fallback(value: str | None, val_type: str | None,
                         validation_patterns: dict | None) -> str | None:
    """Trim a TEXT-FALLBACK value (a raw line remainder taken after a located
    label). For a STRUCTURED type (date / currency / currency_code /
    job_reference) whose pattern is specific, return the FIRST match so a value
    followed by bled label/address text ("2605-0769-1 Work Address …") narrows to
    "2605-0769-1". 'alphanumeric'/'text' are intentionally loose (they match any
    word), so they are NOT pattern-extracted — that could grab a leading label
    word; the shared clean_crop_segment handles them instead. Reusable across
    every supplier/field — no per-document logic."""
    if not value:
        return None
    STRUCTURED = {"date", "currency", "currency_code", "job_reference"}
    if val_type in STRUCTURED:
        for p in (validation_patterns or {}).get(val_type) or []:
            m = re.search(p, value, re.IGNORECASE)
            if m:
                return m.group(0).strip(" -:;,")
    return clean_crop_segment(value, val_type)


def _light_prep(image):
    """LIGHT crop prep for the first OCR rung: greyscale, plus an upscale ONLY for
    a small crop (tiny numeric tokens need ~300px to read). No autocontrast and no
    sharpen — both AMPLIFY a clean crop's decorative border/rule into a garbage
    "line" that PSM 7 locks onto ("Beaumont Care Homes Ltd" → a row of junk), the
    bench-proven failure. An already-legible crop is read essentially as-is (the
    winning raw read); the heavy upscale+autocontrast+SHARPEN recipe stays as a
    LATER rung for tight degraded serials. (Oscar: preprocess only when needed.)"""
    img = image.convert("L")
    w, h = img.size
    if w < 300:
        scale = max(2, 300 // max(1, w))
        img = img.resize((w * scale, h * scale), Image.LANCZOS)
    return img


def _read(img, psm):
    """One image_to_data pass → (text, mean_word_conf, min_word_conf).
    Reconstructs lines from word boxes (block/par/line) so clean_crop_segment
    still sees real line breaks, and averages positive word confidences as a
    deterministic rung tie-breaker. Also returns the MINIMUM confidence over the
    SUBSTANTIAL words (alphabetic, length ≥ 3) — a discriminator the mean dilutes:
    a name like "Aaiumant Care Homes Ltd Galaorm" has three clean words masking
    two garbled ones, so its mean stays moderate while its min (the garbled word)
    drops. Used to gate the authoritative-anchor outright win. min == mean when no
    substantial word is present. Same OCR cost as image_to_string on the same image."""
    import pytesseract
    from pytesseract import Output
    try:
        d = pytesseract.image_to_data(img, config=f"--oem 3 --psm {psm}", output_type=Output.DICT)
    except Exception:
        return "", 0.0, 0.0
    lines, confs, word_confs = {}, [], []
    for i in range(len(d.get("text", []))):
        t = (d["text"][i] or "").strip()
        try:
            c = float(d["conf"][i])
        except Exception:
            c = -1.0
        if not t or c < 0:
            continue
        lines.setdefault((d["block_num"][i], d["par_num"][i], d["line_num"][i]), []).append(t)
        confs.append(c)
        # A "substantial" word for the min — skip 1-2 char tokens and punctuation
        # ("-", ":", "Co") whose OCR confidence is noisy and not name-bearing.
        if len(t) >= 3 and sum(ch.isalpha() for ch in t) >= 3:
            word_confs.append(c)
    text = "\n".join(" ".join(lines[k]) for k in sorted(lines.keys())).strip()
    mean = (sum(confs) / len(confs)) if confs else 0.0
    min_conf = min(word_confs) if word_confs else mean
    return text, mean, min_conf


def _ocr_crop_laddered(crop, val_type=None, verify_fn=None, meta=None):
    """Light-first OCR ladder on an ALREADY-CROPPED image -> cleaned best-rung text
    (or None). SHARED by anchor._crop_and_ocr (centre+dims crop) and
    template_mapper._crop_and_ocr (drawn-box crop) so every value-crop path reads with the
    SAME recipe and writes the SAME confidence into 'meta' (meta['conf'] = mean word conf,
    meta['min_conf'] = min substantial-word conf). The heavy autocontrast+SHARPEN recipe
    (which mangles a clean printed line into junk) is now only a LATER rung, not the
    unconditional one. A gateless caller (verify_fn None -- the Stage 0.5 path, which gates
    separately) accepts the first rung over a conf floor and otherwise returns the best
    read, so its return shape is unchanged."""
    def _set_meta(c, mn):
        if meta is not None:
            meta['conf'] = c
            meta['min_conf'] = mn
    # Light-first OCR ladder (Oscar): preprocess only when needed. A clean,
    # high-res crop reads correctly with minimal processing — the heavy prep
    # (upscale + SHARPEN) over-processes it and PSM 7 then returns garbage or
    # empty ("Beaumont Care Homes Ltd" → "nara"/""). So try LIGHT (greyscale +
    # upscale + autocontrast, NO sharpen) first, and escalate to the heavy prep
    # (which crispens tight degraded serials so _repair_single_token can strip a
    # hallucinated "/" — the reason prep exists) and then the denoise enhance
    # ONLY when the lighter read fails the gate. Each rung is scored by a single
    # image_to_data pass (mean word confidence) so the winner is deterministic.
    # _repair_single_token runs on every rung so even a light-rung serial gets
    # its separator scrubbed. One ladder, reusable for every supplier/field.
    # Lazy import avoids the anchor<->template_mapper module-load cycle.
    from extraction import template_mapper as _tm

    def _gate(seg, conf):
        # verify_fn (the anchor path) is authoritative; a gateless caller
        # (defensive — anchor calls always pass verify_fn) uses a conf floor.
        if verify_fn is not None:
            return bool(seg) and bool(verify_fn(seg))
        return bool(seg) and conf >= 60.0

    light = _light_prep(crop)
    heavy = None
    best_seg, best_conf, best_min = None, -1.0, 0.0
    for _src, _psm in (("light", 7), ("light", 6), ("heavy", 7), ("heavy", 6)):
        if _src == "heavy" and heavy is None:
            heavy = _tm._prep(crop)            # Rung 3 = today's recipe verbatim
        rimg = light if _src == "light" else heavy
        rtext, rconf, rmin = _read(rimg, _psm)
        rseg = clean_crop_segment(rtext, val_type)
        if rseg:
            rseg = _repair_single_token(rimg, rseg, val_type)
        if rseg and rconf > best_conf:
            best_seg, best_conf, best_min = rseg, rconf, rmin
        if _gate(rseg, rconf):
            _set_meta(rconf, rmin)
            return rseg

    # No rung satisfied the gate. Degraded TEXT-LINE escalation (free-text
    # fields, verify_fn only) — denoise + adaptive threshold, accepted only if
    # it now PASSES the gate (a recovered-but-wrong name still can't commit).
    # See ocr/text_enhance.enhance_text_crop.
    if (verify_fn is not None and val_type in ("text", "multiline_text")
            and not (best_seg and verify_fn(best_seg))):
        try:
            from ocr import text_enhance
            eimg = text_enhance.enhance_text_crop(crop)
            etext, _ec, _emin = _read(eimg, 7)
            eseg = clean_crop_segment(etext, val_type)
            if not eseg:
                etext, _ec, _emin = _read(eimg, 6)
                eseg = clean_crop_segment(etext, val_type)
            if eseg and verify_fn(eseg):
                _set_meta(_ec, _emin)
                return eseg
        except Exception:
            pass
    _set_meta(best_conf if best_conf >= 0 else 0.0, best_min)
    return best_seg or None


def _crop_and_ocr(page_image: "Image.Image", x_norm: float, y_norm: float,
                  w_norm: float = 0.0, h_norm: float = 0.0,
                  val_type: str | None = None, capture = None,
                  verify_fn = None, meta = None) -> str | None:
    """
    Crop a tight region centred on the stored value coordinates and re-OCR it.
    Uses the exact selection dimensions saved by the ⊕ tool (w_norm/h_norm) so
    the crop never bleeds into adjacent columns or fields. Falls back to a
    conservative 200×60px half-size when no dimensions are stored.

    val_type (the field's configured `validation` type, e.g. "alphanumeric",
    "currency", "text") gates the digit-run truncation below — see the comment
    at the split-pattern selection for why this matters.

    `meta` (optional out-dict): when provided, the winning rung's OCR confidence
    is written as meta['conf'] (mean word confidence) and meta['min_conf'] (the
    minimum SUBSTANTIAL-word confidence). Callers use these to make the field
    confidence reflect READ QUALITY rather than only the anchor's usage_count — a
    garbled crop ("Aaiumant … Galaorm") no longer scores in the 90s.
    """
    try:
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
        return _ocr_crop_laddered(crop, val_type, verify_fn=verify_fn, meta=meta)
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
