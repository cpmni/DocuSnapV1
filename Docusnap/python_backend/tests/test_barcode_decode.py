"""test_barcode_decode.py — PINs for ocr/barcodes.decode_pages (the barcode inventory, slice A).

Synthetic fixtures are written by zxingcpp's own encoder (no new dependency) and pasted onto a
white 200-DPI A4 page, so the round-trip is decoder-honest: a Code128 at ~2-3 px/module, a URL QR,
and an SFSEP separator-sheet QR that MUST be excluded.

Run:  py -3.12 python_backend/tests/test_barcode_decode.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from ocr import barcodes  # noqa: E402

passed = failed = 0


def check(name, ok):
    global passed, failed
    if ok:
        passed += 1
        print(f'  ok  {name}')
    else:
        failed += 1
        print(f'  FAIL {name}')


try:
    import zxingcpp
    import numpy as np
    from PIL import Image
except Exception as e:   # pragma: no cover
    print(f'SKIP: fixture deps unavailable ({e})')
    sys.exit(0)


def bitmap_to_pil(bm, scale=1):
    arr = np.asarray(bm)
    im = Image.fromarray(arr).convert('L')
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    return im


# 200-DPI A4 page (1654 x 2339), white
PAGE_W, PAGE_H = 1654, 2339


def blank_page():
    return Image.new('L', (PAGE_W, PAGE_H), 255)


def paste(page, bm, x, y, scale=1):
    im = bitmap_to_pil(bm, scale)
    page.paste(im, (x, y))
    return (x, y, im.width, im.height)


print('A. round trip: Code128 + URL QR + SFSEP QR on one page')
page = blank_page()
code = zxingcpp.write_barcode(zxingcpp.BarcodeFormat.Code128, 'INV-20260826', width=0, height=60)
box_code = paste(page, code, 200, 300, scale=3)          # ~3 px/module — a normal 0.33 mm X-dim @200 DPI
qr_url = zxingcpp.write_barcode(zxingcpp.BarcodeFormat.QRCode, 'https://example.com/pay/123', width=0, height=0)
box_url = paste(page, qr_url, 1100, 300, scale=6)
qr_slip = zxingcpp.write_barcode(zxingcpp.BarcodeFormat.QRCode, 'SFSEP-0007', width=0, height=0)
box_slip = paste(page, qr_slip, 600, 1500, scale=6)

res = barcodes.decode_pages([blank_page(), page])
vals = {(r['symbology'], r['value']) for r in res}
check('Code128 decoded with its text', ('Code128', 'INV-20260826') in vals)
check('URL QR decoded (inventory keeps it; the FIELD lane filters it later)', ('QRCode', 'https://example.com/pay/123') in vals)
check('SFSEP separator QR EXCLUDED', not any(r['value'].startswith('SFSEP') for r in res))
check('page index is the list index (page 1, not 0)', all(r['page'] == 1 for r in res))
c = next((r for r in res if r['value'] == 'INV-20260826'), None)
x, y, w, h = box_code
check('Code128 box lands inside its paste rect (±2% of page)',
      c is not None and abs(c['x_norm'] - x / PAGE_W) < 0.02 and abs(c['y_norm'] - y / PAGE_H) < 0.02
      and c['w_norm'] <= (w / PAGE_W) + 0.02 and c['h_norm'] <= (h / PAGE_H) + 0.02)
check('content_type carried (Text) and orientation is an int',
      c is not None and isinstance(c['orientation'], int) and c['content_type'])

print('B. module floor: the same Code128 at 1 px/module (a 66-DPI-equivalent) — recorded, not asserted')
p2 = blank_page()
paste(p2, code, 200, 300, scale=1)
r2 = barcodes.decode_pages([p2])
print(f'      1 px/module decode: {"YES" if any(r["value"] == "INV-20260826" for r in r2) else "no"} (informational)')
p3 = blank_page()
paste(p3, code, 200, 300, scale=2)
r3 = barcodes.decode_pages([p3])
check('2 px/module (a 0.25 mm X-dim @200 DPI) still decodes', any(r['value'] == 'INV-20260826' for r in r3))

print('C. dedupe + cap')
p4 = blank_page()
for i in range(6):
    paste(p4, code, 200, 200 + i * 250, scale=3)
r4 = barcodes.decode_pages([p4])
check('six identical codes dedupe to ONE row (page, symbology, value)', sum(1 for r in r4 if r['value'] == 'INV-20260826') == 1)
check('MAX_PER_PAGE is a sane cap', 10 <= barcodes.MAX_PER_PAGE <= 200)

print('D. never raises')
check('empty list → []', barcodes.decode_pages([]) == [])
check('None → []', barcodes.decode_pages(None) == [])
check('garbage page entries → [] (skipped, no exception)', barcodes.decode_pages([object(), 'x', None]) == [])
_saved = sys.modules.get('zxingcpp')
sys.modules['zxingcpp'] = None   # simulate a missing decoder wheel
try:
    check('missing decoder → [] (fail-open, never raises)', barcodes.decode_pages([page]) == [])
finally:
    if _saved is not None:
        sys.modules['zxingcpp'] = _saved
    else:
        sys.modules.pop('zxingcpp', None)

print('E. field-candidate filter (slice B) + the SFSEP mirror')
check('code-like: refs pass, URLs/vCards do not',
      barcodes.is_code_like('INV-20260826') and barcodes.is_code_like('00340434160000000001')
      and barcodes.is_code_like('ABC 123/45-6') and not barcodes.is_code_like('https://example.com/x')
      and not barcodes.is_code_like('BEGIN:VCARD\nN:Doe') and not barcodes.is_code_like('ab') and not barcodes.is_code_like(''))
check('candidates_for_field: distinct, code-like only, order kept',
      barcodes.candidates_for_field([{'value': 'A-1'}, {'value': 'https://x'}, {'value': 'A-1'}, {'value': 'B-2'}]) == ['A-1', 'B-2'])
try:
    from ocr import slip_detect
    check('SLIP_PAYLOAD_RE mirrors slip_detect (same pattern)', barcodes.SLIP_PAYLOAD_RE.pattern == slip_detect.SLIP_PAYLOAD_RE.pattern)
except Exception:
    check('slip_detect importable for the mirror pin', False)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
