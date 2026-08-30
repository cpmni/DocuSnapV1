"""Pins for ocr.deskew_reread (S0 of DESKEW_SLICE_REREAD_2026-08-30).

Guards the load-bearing Oracle conditions on the PURE parts of the slice re-read:
  C4 — the inverse-map is an exact inverse (1e-6) AND matches the REAL PIL rotate sign;
       the returned raw box keeps the STORED raw w/h (NO-BLOAT).
  C3 — the NAME class locates the value BESIDE the label, never the caption itself;
       ref/date locates by similarity-to-garble.
Run: cd python_backend && py -3.12 -m pytest tests/test_deskew_reread.py -q
"""
import math

from ocr import deskew_reread as dr


def _i2d(words):
    """Build a minimal image_to_data DICT on one line. words = [(text,left,top,w,h), ...]."""
    d = {k: [] for k in ('text', 'conf', 'left', 'top', 'width', 'height',
                          'block_num', 'par_num', 'line_num', 'word_num')}
    for i, (t, l, tp, w, h) in enumerate(words):
        d['text'].append(t); d['conf'].append('90')
        d['left'].append(l); d['top'].append(tp); d['width'].append(w); d['height'].append(h)
        d['block_num'].append(1); d['par_num'].append(1); d['line_num'].append(1); d['word_num'].append(i + 1)
    return d


# ── C4: expand + inverse-map ────────────────────────────────────────────────────
def test_expand_box_pads_and_clamps():
    # a wide value at 5 degrees pads vertically by ~ (w/2)*sin(theta) + q, x by q; clamps to page.
    box = dr.expand_box((100, 200, 300, 24), 5.0, cap_h=20, page_w=1000, page_h=1000)
    l, t, w, h = box
    assert l < 100 and t < 200 and (l + w) > 400 and (t + h) > 224
    dy = (300 / 2.0) * math.sin(math.radians(5.0))
    assert (200 - t) >= dy            # vertical pad covers the far-end swing
    # clamp: a box at the page edge never goes negative or past the page
    e = dr.expand_box((0, 0, 50, 20), 6.0, cap_h=18, page_w=200, page_h=200)
    assert e[0] == 0 and e[1] == 0 and e[0] + e[2] <= 200 and e[1] + e[3] <= 200


def test_inverse_map_is_exact_inverse():
    # pure round-trip: raw -> rotated frame -> raw, at 1e-6, for several angles/scales/points.
    crop_origin, scale = (120, 340), 2.5
    for angle in (-6.0, -3.1, 3.0, 4.7, 8.0):
        for (cx, cy) in ((200.0, 380.0), (405.5, 351.25), (123.0, 999.0)):
            fw = dr.rot_frame_size(300, 40, scale)
            px, py = dr.raw_center_to_rot(cx, cy, crop_origin, scale, angle, fw)
            bx, by = dr.rot_center_to_raw(px, py, crop_origin, scale, angle, fw)
            assert abs(bx - cx) < 1e-6 and abs(by - cy) < 1e-6


def test_forward_map_matches_real_pil_rotate_sign():
    # The sign of the rotation MUST match ocr.tesseract._apply_skew_rotation (== img.rotate(angle)).
    # Put a dark square in a white crop, upscale+rotate the SAME way slice_reread will, find the
    # square's centroid in the rotated frame, and assert raw_center_to_rot predicts it (<= 2 px).
    from PIL import Image
    import numpy as np
    from ocr.tesseract import _apply_skew_rotation

    W, H, s, angle = 160, 90, 2.0, 6.0
    crop = Image.new('L', (W, H), 255)
    x0, y0 = 40, 30           # square top-left in the crop frame
    for yy in range(y0, y0 + 6):
        for xx in range(x0, x0 + 6):
            crop.putpixel((xx, yy), 0)
    cxr, cyr = x0 + 3, y0 + 3   # its centre in the crop frame

    up = crop.resize((int(W * s), int(H * s)), Image.LANCZOS)
    rot = _apply_skew_rotation(up, angle)          # the SAME rotate the engine uses
    arr = np.asarray(rot).astype(np.float64)
    dark = 255.0 - arr
    ys, xs = np.nonzero(dark > 60)
    wsum = dark[ys, xs]
    got = (float((xs * wsum).sum() / wsum.sum()), float((ys * wsum).sum() / wsum.sum()))

    fw = dr.rot_frame_size(W, H, s)
    pred = dr.raw_center_to_rot(cxr, cyr, (0, 0), s, angle, fw)
    assert abs(pred[0] - got[0]) <= 2.0 and abs(pred[1] - got[1]) <= 2.0, (pred, got)


# ── C3: class-aware locate ──────────────────────────────────────────────────────
def test_name_class_locates_value_not_caption():
    # caption-bleed: garble "Customereu" is most similar to the CAPTION "Customer"; the name class
    # must return the VALUE run beside the label, never the caption box.
    data = _i2d([('Customer', 10, 20, 80, 22),
                 ('Kingfisher', 110, 20, 100, 22), ('Print', 216, 20, 54, 22), ('Studio', 276, 20, 66, 22)])
    box = dr._locate_on_crop(data, garble='Customereu', label='Customer', field_class='name')
    assert box is not None and box[0] >= 110, box   # a value box (left >= 110), not the caption at 10


def test_refdate_class_locates_by_similarity():
    data = _i2d([('Invoice', 10, 20, 70, 22), ('No', 84, 20, 24, 22), ('1NV-2O273', 120, 20, 120, 22)])
    box = dr._locate_on_crop(data, garble='INV-29273', label='Invoice No', field_class='invoice_number')
    assert box is not None and box[0] >= 120, box   # the code run, located by similarity-to-garble


# ── orchestration + NO-BLOAT ────────────────────────────────────────────────────
def test_slice_reread_adopts_kin_clean_and_keeps_raw_wh(monkeypatch):
    # stub the injected callables: rotate returns (img, scale); i2d returns a doc where the code
    # reads CLEAN + KIN to the garble. Format check is stubbed to accept.
    monkeypatch.setattr('extraction.format_anomaly_checker.check_value', lambda v, e: None)

    raw_box = (120, 200, 120, 24)
    data = _i2d([('Invoice', 4, 8, 70, 20), ('No', 78, 8, 24, 20), ('INV-29273', 116, 8, 120, 20)])

    class _Img:
        def crop(self, *_a): return self
    out = dr.slice_reread(
        _Img(), raw_box, angle_deg=5.0, field_class='invoice_number',
        garble='1NV-2O273', label='Invoice No', fmt_entry={}, page_wh=(1000, 1000), cap_h=20,
        rotate_crop_fn=lambda crop, ang: (object(), 2.0), i2d_fn=lambda img: data,
    )
    assert out is not None and out['value'] == 'INV-29273'
    assert out['read_geometry'] == 'deskewed'
    assert out['box_raw'][2] == raw_box[2] and out['box_raw'][3] == raw_box[3]   # NO-BLOAT: raw w/h kept


def test_slice_reread_abstains_when_not_kin():
    # a format-clean but WRONG-INSTANCE value (a different real ref) is not kin -> abstain.
    import extraction.format_anomaly_checker as fac
    orig = fac.check_value
    fac.check_value = lambda v, e: None
    try:
        data = _i2d([('PO', 4, 8, 30, 20), ('9988776', 40, 8, 90, 20)])

        class _Img:
            def crop(self, *_a): return self
        out = dr.slice_reread(
            _Img(), (100, 100, 90, 22), angle_deg=5.0, field_class='po_number',
            garble='INV-29273', label='PO', fmt_entry={}, page_wh=(500, 500), cap_h=18,
            rotate_crop_fn=lambda crop, ang: (object(), 2.0), i2d_fn=lambda img: data,
        )
        assert out is None
    finally:
        fac.check_value = orig


def test_slice_reread_no_angle_is_noop():
    out = dr.slice_reread(object(), (1, 1, 10, 10), 0.0, 'invoice_number', 'x', None, {}, (100, 100), 10,
                          rotate_crop_fn=lambda *a: (object(), 2.0), i2d_fn=lambda *a: {})
    assert out is None
