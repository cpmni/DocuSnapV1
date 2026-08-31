"""drift_forced_probe.py — Oracle C4a: force the Stage-0.5 DRIFT path on REAL pixels and prove the
inline-code reconcile (Slice 2) reads the full DN-##### and does NOT degrade.

Each Ridgeway delivery docket is rendered and its content shifted DOWN > the drift tolerance, so the
taught "Delivery Note No." label is found DISPLACED -> the fast-path absolute box misses -> the drift
branch (_relocate_and_read/_geometric + Slice 2) engages. Runs extract_with_mappings with the real
Tesseract OCR, DRIFT off vs on, and asserts delivery_number stays /^DN-\\d{5}$/ (no clip, no degrade).

Run: py -3.12 stress_test/drift_forced_probe.py
"""
import os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python_backend'))
import pypdfium2 as pdfium
from PIL import Image
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
from extraction import template_mapper as tm

INBOX = os.path.join(os.environ['APPDATA'], 'ScanFinder', 'inbox')
IDS = [142, 143, 144, 145, 146, 147, 148, 149, 150, 151]
FMT = re.compile(r'^DN-\d{5}$')
SHIFT = 0.06   # move content down 6% of page height (> the ~0.02 drift tolerance)

MAPPING = {
    "field_key": "delivery_number", "page_number": 0, "enabled": 1, "anchor_text": "Delivery Note No.",
    "anchor_x_norm": 0.6663876098786103, "anchor_y_norm": 0.1383346277780467,
    "anchor_w_norm": 0.12766848053578903, "anchor_h_norm": 0.011255924170616114,
    "target_x_norm": 0.8029039877726831, "target_y_norm": 0.13200103241030936,
    "target_w_norm": 0.09114908989856885, "target_h_norm": 0.020451556604353327,
    "offset_dx_norm": 0.13651637789407278, "offset_dy_norm": -0.006333595367737338,
    "ocr_type": "text", "search_expansion": 0.04,
}
FPS = {"delivery_number": {"validation": "alphanumeric"}}
VPS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}


def shifted_page(docid):
    pdf = pdfium.PdfDocument(os.path.join(INBOX, f"{docid}.pdf"))
    img = pdf[0].render(scale=3.0).to_pil().convert("RGB")
    w, h = img.size
    canvas = Image.new("RGB", (w, h), (255, 255, 255))
    canvas.paste(img, (0, int(SHIFT * h)))     # content down 6% (bottom clipped — footer only)
    pdf.close()
    return canvas


def read(page, drift_on):
    tm._INLINE_CODE_RECONCILE_DRIFT_ON = drift_on
    res = tm.extract_with_mappings([page], [MAPPING], FPS, validation_patterns=VPS)
    e = res.get("delivery_number") or {}
    return e.get("value") or "", e.get("method") or ""


print(f"forced drift (content shifted +{SHIFT:.0%}) — delivery_number via the DRIFT path\n")
print("id      DRIFT off              DRIFT on               on OK?")
pass_on = fail_on = degraded = 0
for docid in IDS:
    page = shifted_page(docid)
    v_off, m_off = read(page, False)
    v_on, m_on = read(page, True)
    ok_on = bool(FMT.match(v_on))
    ok_off = bool(FMT.match(v_off))
    if ok_on:
        pass_on += 1
    else:
        fail_on += 1
    if ok_off and not ok_on:
        degraded += 1     # DRIFT ON degraded a read that was fine OFF
    print(f"#{docid:<6} {v_off:<10}({m_off:<11}) {v_on:<10}({m_on:<11}) {'OK ' if ok_on else 'BAD'}")

print(f"\nDRIFT ON: {pass_on}/{len(IDS)} full DN-#####  | degraded vs OFF: {degraded} (must be 0)")
