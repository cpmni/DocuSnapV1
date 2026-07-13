#!/usr/bin/env python3
"""Text-corroborated same-type template RESCUE (Phillip, 2026-07-10). When a supplier's logo has
drifted OUT of the strict accept band (and past LOGO_THRESHOLD), a template of the DETECTED type with
strong keyword-branding overlap should still be used — so a drifted Meridian PO matches its OWN PO
template instead of getting NO template (no field-fills). Precision-gated: can only turn "wrongly no
template" into the CORRECT template, never a wrong one.
    py -3.12 tests/test_template_rescue.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_matcher

f = 0
def check(n, c):
    print(("OK  " if c else "BAD ") + n)
    if not c:
        globals().__setitem__('f', globals()['f'] + 1)

class FakePage:
    def __init__(self, phash): self.phash = phash

def with_stub_hash(fn):
    orig = template_matcher.compute_logo_hash
    template_matcher.compute_logo_hash = lambda page: page.phash
    try: return fn()
    finally: template_matcher.compute_logo_hash = orig

MERIDIAN = ['MERIDIAN', 'PRINT', 'COPY', 'ORMEAU', 'BELFAST']
# Meridian cluster: established INVOICE template + a PO template, IDENTICAL branding fingerprint,
# logo hashes ~14 bits apart (the measured drift). A new PO's logo drifts to all-zero.
INV = {'id': 23, 'name': 'Meridian Invoice', 'document_type_slug': 'invoice',
       'logo_phash': 'ffffffffffffffff', 'confirmed_count': 2, 'keyword_fingerprint': MERIDIAN}
PO  = {'id': 25, 'name': 'Meridian PO', 'document_type_slug': 'purchase_order',
       'logo_phash': '0000000000003fff', 'confirmed_count': 0, 'keyword_fingerprint': MERIDIAN}  # 14 bits set
CONTOSO_PO = {'id': 30, 'name': 'Contoso PO', 'document_type_slug': 'purchase_order',
              'logo_phash': '0000000000003fff', 'confirmed_count': 0,
              'keyword_fingerprint': ['CONTOSO', 'RECEIPT', 'STORE', 'VISIT', 'THANKYOU']}
PO_OCR = "MERIDIAN PRINT & COPY\nOrmeau Avenue Belfast\nPURCHASE ORDER\nP/O Number PO5252"
DRIFTED = FakePage(phash='0000000000000000')   # dist 14 from PO, 64 from INV -> NO logo candidate (>13)

# 1 — rescue fires and picks the RIGHT supplier's PO template (not the invoice, not Contoso)
m = with_stub_hash(lambda: template_matcher.identify_template(
        DRIFTED, PO_OCR, [INV, PO, CONTOSO_PO], detected_slug='purchase_order', title_trusted=True))
check('drifted-logo PO RESCUED to the Meridian PO template (id 25)', bool(m) and m['template']['id'] == 25)
check("  -> method 'keywords+slug_rescue'", bool(m) and m['method'] == 'keywords+slug_rescue')
check('  -> confidence 60 (layout signal, not a full logo identity)', bool(m) and m['confidence'] == 60)

# 2 — wrong-supplier look-alike only, low overlap -> NOT rescued (and keyword fallback also rejects) -> None
m2 = with_stub_hash(lambda: template_matcher.identify_template(
        DRIFTED, PO_OCR, [CONTOSO_PO], detected_slug='purchase_order', title_trusted=True))
check('wrong-supplier PO (branding overlap < 0.80) NOT rescued -> None', m2 is None)

# 3 — type guard unchanged: only an invoice sibling + a TRUSTED PO title -> REFUSE (no wrong-type force)
m3 = with_stub_hash(lambda: template_matcher.identify_template(
        DRIFTED, PO_OCR, [INV], detected_slug='purchase_order', title_trusted=True))
check('only invoice sibling + trusted PO title -> None (no wrong-type rescue)', m3 is None)

# 4 — rescue is GATED on a trusted title: an untrusted title must not fire it (falls through as before)
m4 = with_stub_hash(lambda: template_matcher.identify_template(
        DRIFTED, PO_OCR, [INV, PO], detected_slug='purchase_order', title_trusted=False))
check('untrusted title -> rescue does NOT fire (id 25 not force-picked)', not (m4 and m4.get('method') == 'keywords+slug_rescue'))

# 5 — a CLOSE logo still wins the normal path (rescue never shadows a real logo match)
CLOSE = FakePage(phash='0000000000003fff')   # dist 0 from PO
m5 = with_stub_hash(lambda: template_matcher.identify_template(
        CLOSE, PO_OCR, [PO], detected_slug='purchase_order', title_trusted=True))
check('close logo still matched via the logo path (method logo*, not rescue)',
      bool(m5) and m5['template']['id'] == 25 and 'rescue' not in m5['method'])

print('\n' + (f'{f} FAILED' if f else 'All template-rescue checks passed'))
sys.exit(1 if f else 0)
