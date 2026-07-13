"""Deskew-on-reprocess ("Straighten + Reprocess").

tesseract.extract_text_and_images(deskew_pages=True) transiently straightens each SCANNED page for
OCR + as the returned anchor-crop source, while raw_pages_out keeps the PRE-deskew frame. engine.extract
takes that raw frame as raw_page0 and uses it for the persisted logo phash + all logo/template MATCHING —
a deskewed logo phash would drift out of match range AND, once persisted to template_logo_hashes on
confirm, poison the supplier's logo identity for every future RAW import. The filed file is never touched;
reprocess is review-bound (can't auto-file).

The load-bearing test is LOGO-PHASH INVARIANCE: with the read page straightened, results['_logo_phash']
must equal the RAW page-0 phash, never the deskewed one. gary + Oracle design, 2026-07-12.

Run:  py -3.12 tests/test_deskew_pages.py   (from python_backend/)
"""
import os, sys, tempfile
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image, ImageDraw
from ocr.tesseract import extract_text_and_images, detect_skew_angle
from extraction.engine import ExtractionEngine
from extraction import template_matcher

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond: fails += 1


class _StubEngine:
    """No real Tesseract: the deskew geometry + raw-frame capture run BEFORE read_page, so a stub
    lets the test exercise the wiring without depending on a Tesseract install."""
    def read_page(self, img, params, dpi=None): return 'stub-text'


def _barred(w=600, h=800):
    """A page of horizontal 'text' bars + an asymmetric top-left mark (a stand-in logo) — gives
    detect_skew_angle real projection structure and a phash that shifts under rotation."""
    im = Image.new('L', (w, h), 255)
    d = ImageDraw.Draw(im)
    d.polygon([(60, 40), (200, 60), (90, 150)], fill=0)     # asymmetric logo mark, top-left
    for y in range(200, h - 80, 48):
        d.rectangle([80, y, w - 120, y + 14], fill=0)       # left-weighted text rows
    return im


TMP = tempfile.mkdtemp(prefix='deskew_test_')

# ── extract_text_and_images: deskew straightens the read page; raw_pages_out keeps the raw frame ──
straight = _barred()
skewed   = straight.rotate(-3.0, expand=False, fillcolor=255)          # a 3° tilted "scan"
sk_path  = os.path.join(TMP, 'skewed.png'); skewed.save(sk_path)

raw_out = []
_txt, pages = extract_text_and_images(Path(sk_path), engine=_StubEngine(),
                                      deskew_pages=True, raw_pages_out=raw_out)
a_raw  = abs(detect_skew_angle(raw_out[0])) if raw_out else 99.0
a_desk = abs(detect_skew_angle(pages[0]))
check("raw_pages_out is parallel to pages (1 page)", len(raw_out) == len(pages) == 1)
check(f"returned page is straightened ({a_desk:.2f}° < 1.0°)", a_desk < 1.0)
check(f"raw_pages_out[0] is the PRE-deskew (still ~3° skewed) frame ({a_raw:.2f}°)", a_raw >= 1.0)

# deskew OFF -> byte-identical: the returned page is the raw skewed render, raw_pages_out untouched
raw_off = []
_t2, pages_off = extract_text_and_images(Path(sk_path), engine=_StubEngine(),
                                         deskew_pages=False, raw_pages_out=raw_off)
check("deskew OFF leaves raw_pages_out empty", raw_off == [])
check("deskew OFF returns the skewed page unchanged", abs(detect_skew_angle(pages_off[0])) >= 1.0)

# a page that is ALREADY straight is a no-op even with deskew on (detect returns 0.0 < 0.2)
st_path = os.path.join(TMP, 'straight.png'); straight.save(st_path)
raw_st = []
_t3, pages_st = extract_text_and_images(Path(st_path), engine=_StubEngine(),
                                        deskew_pages=True, raw_pages_out=raw_st)
check("straight page under deskew: read page stays straight (no spurious rotation)",
      abs(detect_skew_angle(pages_st[0])) < 1.0)

# ── engine.extract: the PERSISTED logo phash uses raw_page0, NOT the straightened read page ──
logo_raw  = _barred()
logo_desk = logo_raw.rotate(6.0, expand=False, fillcolor=255)         # the straightened read frame
ph_raw    = template_matcher.compute_logo_hash(logo_raw)
ph_desk   = template_matcher.compute_logo_hash(logo_desk)
check("rotation SHIFTS the logo phash (so the raw-frame guard is load-bearing)", ph_raw != ph_desk)

FD = [{'key': 'supplier_name', 'label': 'Supplier', 'type': 'text'},
      {'key': 'reference_number', 'label': 'Ref', 'type': 'text'}]

def _extract(raw_page0):
    eng = ExtractionEngine(mode='smart', emit_fn=lambda *_a: None)
    return eng.extract(ocr_text='Ref: DN-1\n', page_images=[logo_desk], filename='x.png',
                       field_defs=FD, hints=[], anchors=[], logos=[], templates=[],
                       document_type='Delivery', document_slug='delivery',
                       supplier_name=None, raw_page0=raw_page0)

r_guard = _extract(logo_raw)
check("persisted _logo_phash == RAW page-0 phash (poisoning guard holds)",
      r_guard.get('_logo_phash') == ph_raw)
check("persisted _logo_phash != straightened-page phash (never used the read frame)",
      r_guard.get('_logo_phash') != ph_desk)

# raw_page0=None (every EXISTING caller) -> uses page_images[0] -> byte-identical to before
r_default = _extract(None)
check("raw_page0=None -> _logo_phash == page_images[0] phash (byte-identical default)",
      r_default.get('_logo_phash') == ph_desk)

print()
print(f"{fails} FAILED" if fails else "All deskew-pages checks passed")
sys.exit(1 if fails else 0)
