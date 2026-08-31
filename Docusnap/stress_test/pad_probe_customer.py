"""pad_probe_customer.py — READ-ONLY probe of the owner's 2026-08-11 hypothesis: the taught
customer_name box on Castellan tpl 7 clips the 'd' of 'Ltd' (a 'd' with its stem clipped reads
as 'c'/'o'), and a slightly bigger pad would heal it.

For each Castellan doc it renders page 1 at the APP's 200 DPI, crops the taught target box at a
ladder of pads, and OCRs each crop through the SAME `_ocr_crop_laddered` recipe Stage 0.5 uses —
so a pad-0 read that reproduces the live garble proves fidelity, and the pad at which the read
becomes 'Ltd' is the measurement.

Usage:  py -3.12 stress_test/pad_probe_customer.py <castellan.json>
        (json = {mapping, docs[]} dumped read-only from the live DB)
Writes nothing. Never touches the DB.
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'python_backend'))
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

from extraction import template_mapper as tm

DPI = 200   # the app's render DPI (handler.js _ocrDpiEnv) — NOT 300 (the 08-09 harness trap)

# Each variant: (label, dx_left, dy_top, dx_right, dy_bottom) in NORM page units added outward.
PADS = [
    ("pad-0 (as taught)", 0, 0, 0, 0),
    ("top +0.004",        0, 0.004, 0, 0),
    ("right +0.008",      0, 0, 0.008, 0),
    ("top+bot +0.004",    0, 0.004, 0, 0.004),
    ("all +0.004",        0.004, 0.004, 0.004, 0.004),
    ("all +0.008",        0.008, 0.008, 0.008, 0.008),
]


def render_page1(pdf_path):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(pdf_path)
    try:
        page = pdf[0]
        img = page.render(scale=DPI / 72.0).to_pil()
        return img.convert('RGB')
    finally:
        pdf.close()


def live_model_arms(page, box0):
    """007's demanded arms (2026-08-11): model the REAL current reader, not the worst case.
    (B) compose-scan placement only; (C) compose + the preview fast path (page/box threaded —
    the full live model); (D) preview path on the raw box (isolates the two contributions).
    Compose recipe mirrors engine.py:5421 exactly: net = θ_teach(0.0 for tpl 7) − θ_scan,
    applied only in the [0.2, 5.0] band."""
    from ocr.tesseract import detect_skew_angle
    from extraction import engine as eng
    W, H = page.size
    ts = float(detect_skew_angle(page, 0.2) or 0.0)
    net = 0.0 - ts
    if 0.2 <= abs(net) <= 5.0:
        nx, ny, nw, nh = eng._compose_box_to_level(
            box0['x_norm'], box0['y_norm'], box0['w_norm'], box0['h_norm'], net, W, H)
        cbox = {"x_norm": nx, "y_norm": ny, "w_norm": nw, "h_norm": nh}
    else:
        cbox = dict(box0)
    out = {"theta_scan": ts, "net": net}
    for lbl, box, thread in (("B compose only", cbox, False),
                             ("C compose+preview", cbox, True),
                             ("D preview only", box0, True)):
        cb = tm._clamp_box(box)
        crop = tm._crop(page, cb)
        meta = {}
        try:
            if thread:
                read = tm._ocr_crop_laddered(crop, 'text', verify_fn=None, meta=meta,
                                             page=page, box=cb) or ''
            else:
                read = tm._ocr_crop_laddered(crop, 'text', verify_fn=None, meta=meta) or ''
        except Exception as e:
            read = f'<err {e}>'
        out[lbl] = (read, meta.get('conf'))
    return out


def main():
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    m = data['mapping']
    box0 = {"x_norm": m['target_x_norm'], "y_norm": m['target_y_norm'],
            "w_norm": m['target_w_norm'], "h_norm": m['target_h_norm']}
    print(f"taught box: x={box0['x_norm']:.4f} y={box0['y_norm']:.4f} "
          f"w={box0['w_norm']:.4f} h={box0['h_norm']:.4f}\n")

    ARMS = ["B compose only", "C compose+preview", "D preview only"]
    arm_contains = {a: 0 for a in ARMS}
    arm_exact = {a: 0 for a in ARMS}
    heals = {lbl: 0 for lbl, *_ in PADS}
    n = 0
    for d in data['docs']:
        path = d.get('working_path') or d.get('stored_path')
        if not path or not os.path.exists(path):
            print(f"doc {d['id']}: file missing — skipped ({path})")
            continue
        try:
            page = render_page1(path)
        except Exception as e:
            print(f"doc {d['id']}: render failed — {e}")
            continue
        n += 1
        live = d.get('display_value') or d.get('raw_value') or ''
        print(f"doc {d['id']}  {d['original_filename']}  live='{live}'")
        for lbl, dl, dt, dr, db_ in PADS:
            box = {"x_norm": box0['x_norm'] - dl, "y_norm": box0['y_norm'] - dt,
                   "w_norm": box0['w_norm'] + dl + dr, "h_norm": box0['h_norm'] + dt + db_}
            crop = tm._crop(page, tm._clamp_box(box))
            meta = {}
            try:
                read = tm._ocr_crop_laddered(crop, 'text', verify_fn=None, meta=meta) or ''
            except Exception as e:
                read = f'<err {e}>'
            ok = 'Ltd' in read
            if ok:
                heals[lbl] += 1
            print(f"   {lbl:<18} -> {read!r}  conf={meta.get('conf')}  {'OK' if ok else ''}")
        lm = live_model_arms(page, box0)
        print(f"   scan tilt {lm['theta_scan']:+.2f}° net {lm['net']:+.2f}°")
        for a in ARMS:
            read, conf = lm[a]
            exact = read.strip() == 'Bramblewood Joinery Ltd'
            if 'Ltd' in read:
                arm_contains[a] += 1
            if exact:
                arm_exact[a] += 1
            print(f"   {a:<18} -> {read!r}  conf={conf}  {'EXACT' if exact else ('OK' if 'Ltd' in read else '')}")
        print()

    print(f"=== summary over {n} docs: reads containing 'Ltd' per pad ===")
    for lbl, *_ in PADS:
        print(f"   {lbl:<18} {heals[lbl]}/{n}")
    print(f"=== live-model arms (exact 'Bramblewood Joinery Ltd' / contains 'Ltd') ===")
    for a in ARMS:
        print(f"   {a:<18} exact {arm_exact[a]}/{n} · contains {arm_contains[a]}/{n}")


if __name__ == '__main__':
    main()
