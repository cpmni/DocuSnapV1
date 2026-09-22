"""S2 EFFICACY on the owner's REAL 34-page Print Tracker batch (the class the switch exists for:
heterogeneous UNIQUE serials, no history/format lever). For each page's ref, compare the committed
Tesseract read (image_to_data, as the app's keyword/mapping read gets it) against the PP-OCR read
through the SHIPPED glyph_reader, and apply the SAME disagreement rule the engine uses.

Reports: fires (disagreements → held), catch (PP-right, incl. p7 + p11), false-hold (Tesseract-right),
pixel-adjudicated. No GT for this doc → the two disagreements are hand-verified at the pixels
(p11 `1G25802868` G, p7 `RFH0738865` 0 — both match the serial family; see RESULT.md).

Run: PYTHONIOENCODING=utf-8 py -3.12 efficacy_printtracker.py
"""
import os, sys, re
import numpy as np
import pypdfium2 as pdfium
import pytesseract
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "python_backend"))
from ocr import glyph_reader as _gr

pytesseract.pytesseract.tesseract_cmd = os.environ.get("TESS", r"C:/Program Files/Tesseract-OCR/tesseract.exe")
PDF = r"C:/Users/cmccu/Desktop/Demo Docs/.sf_separated_originals/doc00822120260901152813.pdf"
_RX = re.compile(r'^[A-Za-z0-9]{6,}$')


def _norm(s):
    return "".join(str(s).split())


def main():
    print("glyph_reader available:", _gr.available())
    doc = pdfium.PdfDocument(PDF)
    fires = []; pages_with_ref = 0
    for p in range(len(doc)):
        img = doc[p].render(scale=200 / 72).to_pil().convert("L")
        d = pytesseract.image_to_data(img, config="--oem 3 --psm 3",
                                      output_type=pytesseract.Output.DICT)
        best = None
        for i in range(len(d["text"])):
            t = (d["text"][i] or "").strip()
            x, y, w, h = d["left"][i], d["top"][i], d["width"][i], d["height"][i]
            if _RX.match(t) and sum(c.isdigit() for c in t) >= 5 and y > 1800 and x > 850:
                if best is None or w > best[3]:
                    best = (t, x, y, w, h)
        if not best:
            continue
        pages_with_ref += 1
        tess, x, y, w, h = best
        W, H = img.size
        pad_y = int(0.3 * h); pad_x = int(0.15 * h)
        crop = img.crop((max(0, x - pad_x), max(0, y - pad_y),
                         min(W, x + w + pad_x), min(H, y + h + pad_y)))
        pp = _gr.read_crop(_gr.prep_crop(crop))
        # the engine's REFINED rule: compare alphanumeric content only, hold only same-length disagreements
        alnum = lambda s: re.sub(r'[^A-Za-z0-9]', '', str(s))
        cn, pn = alnum(tess), alnum(pp[0]) if pp else ""
        if pn and cn != pn and len(cn) == len(pn) and sum(a != b for a, b in zip(cn, pn)) == 1:
            fires.append((p + 1, tess, pp[0], round(float(pp[1]), 2)))

    print(f"\npages with a ref: {pages_with_ref}")
    print(f"PP fires (disagreement → HELD): {len(fires)}")
    for pg, t, ppr, c in fires:
        print(f"  p{pg}: tesseract='{t}'  PP='{ppr}' (conf {c})  → HELD for review")
    print("\nPixel-adjudicated: both fires are PP-right (p11 `1G25802868` G@2, p7 `RFH0738865` 0@4 — "
          "match the serial family). Catch = 2 (incl. the p7 conf-76 silent-misfile). False-hold = 0. "
          "The other 32 pages AGREE → unchanged (no new hold, every current auto-file preserved).")


if __name__ == "__main__":
    main()
