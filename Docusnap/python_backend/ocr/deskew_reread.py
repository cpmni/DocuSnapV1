"""Slice-level deskew re-read of ONE flagged field — S0 of DESKEW_SLICE_REREAD_2026-08-30.

Straighten only an EXPANDED SLICE around a flagged value and re-OCR that field, instead of
deskewing the whole page and re-extracting (owner's cost refinement). This module is the
re-read CAPABILITY only: PURE / INJECTABLE by construction — the geometry (expand + inverse-map)
and the orchestration are unit-testable with NO images; the heavy deps (upscale+rotate a crop,
image_to_data) are passed in as callables. The engine wires it behind the DARK switch in S1/S2,
so with the arm off this file is never called and the pipeline is byte-identical.

Oracle conditions honoured here (design section 11):
  * C3 (class-aware locate) — the NAME class re-locates by LABEL-ADJACENCY (read the run beside
    the located caption), NOT similarity-to-garble (which returns the caption for a caption-bleed
    name). The REF/DATE class locates by similarity-to-garble. targeted_reread supplies both.
  * C4 (inverse-map) — the forward chain is raw -> crop(-origin) -> upscale (xs) -> rotate(theta,
    expand=False, about the upscaled-crop centre). The inverse undoes rotate(-theta) AND the
    upscale (/s), translates by the crop origin, and KEEPS the stored RAW box w/h (NO-BLOAT).
  * Adoption stays with is_adoptable (format-clean + kinship); the corroboration gate + the
    crop-bucket rule (C1) live in S1 where this returns a candidate into the record.

Rotation convention: matches ocr.tesseract._apply_skew_rotation == img.rotate(angle) — PIL
CCW-positive, expand=False, about the image centre. The forward/inverse point maps below are exact
mutual inverses; the SIGN vs PIL is pinned against a real rotate in test_deskew_reread.py.

No new dependencies (math + targeted_reread; PIL/pytesseract live behind the injected callables).
"""
from __future__ import annotations

import math

from ocr import targeted_reread as tr


# ── geometry (pure) ────────────────────────────────────────────────────────────
def _rot_point(x, y, cx, cy, deg):
    """Rotate a point about (cx, cy) by `deg` in PIL's CCW-positive convention, image (y-down)
    coords. Used with +angle for the forward map and -angle for the inverse (exact inverses)."""
    th = math.radians(deg)
    dx, dy = x - cx, y - cy
    c, s = math.cos(th), math.sin(th)
    return (cx + dx * c + dy * s, cy - dx * s + dy * c)


def expand_box(raw_box, angle_deg, cap_h, page_w, page_h, quiet=None):
    """Pad the raw value box so the value can't rotate out of the crop at `angle_deg`, then clamp
    to the page. raw_box = (l, t, w, h) px. Returns (l, t, w, h) px. Design section 3 / C4 math:
      Dy ~= (Wv/2)*|sin th| + q   (a wide value's far end swings vertically)
      Dx ~= q                     (single-line values are short in y)
    q = the pad-window quiet zone (~0.4x cap height, min 8 px) — even a 0-degree tight box clips
    the leading glyph, so bake q in regardless of angle."""
    l, t, w, h = raw_box
    th = math.radians(abs(angle_deg))
    q = quiet if quiet is not None else max(8.0, 0.4 * (cap_h or h))
    dy = (w / 2.0) * math.sin(th) + q
    dx = q
    nl = max(0, int(math.floor(l - dx)))
    nt = max(0, int(math.floor(t - dy)))
    nr = min(int(page_w), int(math.ceil(l + w + dx)))
    nb = min(int(page_h), int(math.ceil(t + h + dy)))
    return (nl, nt, max(1, nr - nl), max(1, nb - nt))


def rot_frame_size(crop_w, crop_h, scale):
    """The rotated+upscaled frame size — expand=False keeps the UPSCALED crop's size, so the frame
    is (s*crop_w, s*crop_h) and rotation is about its centre."""
    return (int(round(crop_w * scale)), int(round(crop_h * scale)))


def raw_center_to_rot(cx_raw, cy_raw, crop_origin, scale, angle_deg, frame_wh):
    """FORWARD: a raw-page point -> its location in the rotated+upscaled crop frame. (Pin + predict.)"""
    ox, oy = crop_origin
    fx, fy = (cx_raw - ox) * scale, (cy_raw - oy) * scale       # into the upscaled-crop frame
    fcx, fcy = frame_wh[0] / 2.0, frame_wh[1] / 2.0
    return _rot_point(fx, fy, fcx, fcy, angle_deg)              # rotate CCW by +angle about centre


def rot_center_to_raw(px_rot, py_rot, crop_origin, scale, angle_deg, frame_wh):
    """INVERSE (C4): a point in the rotated+upscaled frame -> the raw-page point. Undo rotate(-angle)
    about the frame centre, then /scale, then + crop origin."""
    fcx, fcy = frame_wh[0] / 2.0, frame_wh[1] / 2.0
    ux, uy = _rot_point(px_rot, py_rot, fcx, fcy, -angle_deg)   # un-rotate
    ox, oy = crop_origin
    return (ox + ux / scale, oy + uy / scale)                  # /upscale + origin


# ── class-aware locate on the rotated crop (C3) ─────────────────────────────────
def _locate_on_crop(crop_data, garble, label, field_class):
    """Return the value's box (l, t, w, h) IN THE ROTATED-CROP FRAME, or None (abstain).
      * name class  -> label-adjacency: find the caption, read the run beside it (the garble of a
                       caption-bleed name is most similar to the CAPTION, so similarity-to-garble
                       would return the caption — C3). Requires a label.
      * ref/date/other -> similarity-to-garble (targeted_reread.locate_value_region)."""
    if field_class == 'name':
        if not label:
            return None
        # Find the label run on a line, then take the words to its RIGHT on that SAME line — the
        # value beside the caption (anchor-relocate geometry). Never a run that INCLUDES the caption
        # (the caption-bleed garble is most similar to the caption, so a nearest-run pick would grab
        # "Customer Kingfisher" whole; excluding words left of the label's right edge prevents it).
        lines = tr._group_lines(crop_data)
        for words in lines.values():
            nW = len(words)
            for i in range(nW):
                for j in range(i, nW):
                    if tr._similarity(''.join(w['text'] for w in words[i:j + 1]), label) >= 0.75:
                        lab_right = max(w['left'] + w['width'] for w in words[i:j + 1])
                        val = [w for w in words if w['left'] >= lab_right - 2]
                        return tr._union_box(val) if val else None
        return None
    return tr.locate_value_region(crop_data, garble, label=label)


# ── orchestration (injectable) ──────────────────────────────────────────────────
def slice_reread(page_image, raw_box, angle_deg, field_class, garble, label,
                 fmt_entry, page_wh, cap_h, *, rotate_crop_fn, i2d_fn,
                 config_pattern=None, max_edits=2, upscale=None):
    """Re-read one flagged field on a straightened slice. Returns a dict on a KIN, format-CLEAN
    read, else None (abstain — the caller keeps its byte-identical flagged dict; adoption + the
    corroboration/crop-bucket gate are S1's job):
        {'value': str, 'box_raw': (l, t, w, h), 'angle': angle_deg, 'read_geometry': 'deskewed'}

    Injected (engine supplies real ones; tests supply stubs):
      rotate_crop_fn(crop_img, angle_deg) -> (rotated_img, scale)
          crop -> greyscale -> upscale to ~300-DPI-equiv (scale returned) -> rotate(angle,
          expand=False) via _apply_skew_rotation. Must NOT change frame size after rotate.
      i2d_fn(rotated_img) -> image_to_data DICT (in the rotated-crop pixel frame)."""
    if not garble or not angle_deg or rotate_crop_fn is None or i2d_fn is None:
        return None
    page_w, page_h = page_wh
    ebox = expand_box(raw_box, angle_deg, cap_h, page_w, page_h)
    l, t, w, h = ebox
    try:
        crop = page_image.crop((l, t, l + w, t + h))
    except Exception:
        return None
    rotated, scale = rotate_crop_fn(crop, angle_deg)
    if rotated is None or not scale:
        return None
    frame_wh = rot_frame_size(w, h, scale)
    data = i2d_fn(rotated)
    if not data:
        return None
    vbox = _locate_on_crop(data, garble, label, field_class)
    if vbox is None:
        return None
    # read the value text from the located run in this SAME rotated crop (frame invariant #2).
    value = _read_located_text(data, vbox)
    if not tr.is_adoptable(value, fmt_entry, garble, config_pattern=config_pattern, max_edits=max_edits):
        return None
    # C4 inverse-map: the located box CENTRE -> raw frame; keep the STORED RAW w/h (NO-BLOAT).
    vcx, vcy = vbox[0] + vbox[2] / 2.0, vbox[1] + vbox[3] / 2.0
    rcx, rcy = rot_center_to_raw(vcx, vcy, (l, t), scale, angle_deg, frame_wh)
    rw, rh = raw_box[2], raw_box[3]
    box_raw = (int(round(rcx - rw / 2.0)), int(round(rcy - rh / 2.0)), int(rw), int(rh))
    return {'value': str(value).strip(), 'box_raw': box_raw, 'angle': float(angle_deg),
            'read_geometry': 'deskewed'}


def _read_located_text(crop_data, vbox):
    """Join the word tokens whose boxes fall inside the located value box (the run the locate
    matched), left-to-right — the value as read on the straightened crop."""
    lines = tr._group_lines(crop_data)
    vl, vt, vw, vh = vbox
    vr, vb = vl + vw, vt + vh
    inside = []
    for words in lines.values():
        for wd in words:
            cx, cy = wd['left'] + wd['width'] / 2.0, wd['top'] + wd['height'] / 2.0
            if vl - 2 <= cx <= vr + 2 and vt - 2 <= cy <= vb + 2:
                inside.append(wd)
    inside.sort(key=lambda wd: (wd['top'] // max(1, vh), wd['left']))
    return ''.join(wd['text'] for wd in inside)
