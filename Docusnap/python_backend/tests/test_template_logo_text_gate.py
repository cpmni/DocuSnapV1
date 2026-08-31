"""
tests/test_template_logo_text_gate.py — the Stage-0 logo-accept text gate.

V1 (Slice 1d, 2026-07-20 morning) abstained a logo-only template accept on positive disagreement —
and was then DEFEATED three independent ways by the live Northgate/Vellum→Copperfield misfiles, the
exact case it was built for (10 wrong-supplier docs in the live DB, all flagged, none blocked at
Stage 0). V2 (TEMPLATE_GATE_DISTINCTIVE, Oracle-signed) closes each defeat. This file carries ONE
FIXTURE PER DEFEAT, shaped like the REAL data (the V1 suite's idealized fixtures — junk-free
fingerprints, type-word-free rivals — are exactly why it stayed green while production failed).
Each defeat is proven RED against V1 by asserting the V1 predicate does NOT fire on it (=0 is the
byte-identical V1 revert, so those assertions ARE the red proof).

    py -3.12 tests/test_template_logo_text_gate.py     (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import template_matcher as tm                                   # noqa: E402
from extraction.template_matcher import (                                       # noqa: E402
    _rival_branding_present, _keyword_hit_ratio, _distinctive_tokens,
    _distinctive_hit_ratio, _name_arm_tokens, identify_template,
)

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def v1(fn, *a, **k):
    """Run fn under the byte-identical V1 revert."""
    os.environ['TEMPLATE_GATE_DISTINCTIVE'] = '0'
    try:
        return fn(*a, **k)
    finally:
        os.environ.pop('TEMPLATE_GATE_DISTINCTIVE', None)


# ── Fixtures shaped like the LIVE data (template 2 / doc 161 / doc 181) ─────────────────────────
COPPER = {'id': 2, 'name': 'Copperfield Electrical', 'dominant_supplier': 'Copperfield Electrical',
          'document_type_slug': 'invoice', 'logo_phash': 'bc4cc3b3c7385c46',
          # the REAL pollution: 'INV' (split off "INV-12345" at harvest) + 'Industrial' (generic
          # address vocab that also sits in a CUSTOMER's address on foreign pages)
          'keyword_fingerprint': ['Copperfield', 'Electrical', 'Faraday', 'Industrial', 'Park',
                                  'Coventry', 'INV'],
          'fields': [{'field_key': 'supplier_name', 'fixed_value': 'Copperfield Electrical',
                      'is_variable': 0}]}
# Northgate's ONLY template is a DELIVERY note — its fingerprint carries type words that cannot
# appear on an invoice (the V1 rival-bar unreachability, measured 0.60 live).
NORTH_DN = {'id': 16, 'name': 'Northgate Textiles', 'dominant_supplier': 'Northgate Textiles',
            'document_type_slug': 'delivery_note', 'logo_phash': 'bfcbc060c23f0f43',
            'keyword_fingerprint': ['Northgate', 'Textiles', 'Mill', 'Weavers', 'Way', 'Preston',
                                    'DELIVERY', 'DOCKET', 'Delivery', 'Note']}
# Vellum's own fingerprint leaked its sample doc's CUSTOMER ("Bill To" OCR'd as "Bi Te", so the
# harvest truncation missed) — the V1 dilution to 0.70.
VELLUM = {'id': 17, 'name': 'Vellum & Crane Stationers', 'dominant_supplier': 'Vellum & Crane Stationers',
          'document_type_slug': 'invoice', 'logo_phash': 'bf46c0f1c03f4e43',
          'keyword_fingerprint': ['Vellum', 'Crane', 'Stationers', 'Paternoster', 'Court', 'York',
                                  'INV', 'Ashcombe', 'Care', 'Homes']}
TEMPLATES = [COPPER, NORTH_DN, VELLUM]

NORTHGATE_INVOICE = ('northgate textiles\nnorthgate mill, 14 weavers way\npreston pr1 3qx\n'
                     't 01772 448120\ninvoic e\ninvoice no. inv-76642\ninvoice date 26/08/2026\n'
                     'bill to\naldermoor engineering\nbay 3, cutler industrial est.\nrotherham')
VELLUM_INVOICE = ('vellum & crane stationers\nvc 8 paternoster court\nyork yo1 7hh\nt 01904 337261\n'
                  'invoice invoice no. inv-57811\ninvoice date 04/05/2026\nbi te\nsandpiper hotels')
COPPERFIELD_PAGE = ('copperfield electrical\nfaraday industrial park\ncoventry cv3 4tl\n'
                    'invoice inv-1\nbill to\nsomeone ltd')
NO_BRANDING_PAGE = 'a page whose fingerprint words did not survive ocr at all just 123 456 789'


class FakePage:  # identify_template only passes page_image through to compute_logo_hash
    pass


def run_identify(page_phash, ocr_text, detected_slug=None, title_trusted=False):
    old = tm.compute_logo_hash
    tm.compute_logo_hash = lambda img: page_phash
    try:
        return identify_template(FakePage(), ocr_text, TEMPLATES,
                                 detected_slug=detected_slug, title_trusted=title_trusted)
    finally:
        tm.compute_logo_hash = old


print("§1 defeat (a) — the logo+slug bypass: TYPE corroboration is not SUPPLIER corroboration")
# Doc 161's shape: phash hamming 6 from COPPER (accept band), doc detected as 'invoice', and the
# wrong template IS invoice-typed — V1 relabels the pick 'logo+slug' and skips the gate entirely.
NEAR_COPPER = 'bc4cc3b3c7385c40'   # hamming 4 from COPPER's stored hash
r_v1 = v1(run_identify, NEAR_COPPER, NORTHGATE_INVOICE, detected_slug='invoice')
check("RED PROOF: V1 accepts the wrong template via method='logo+slug'",
      r_v1 is not None and r_v1['template']['id'] == 2 and r_v1['method'] == 'logo+slug')
r_v2 = run_identify(NEAR_COPPER, NORTHGATE_INVOICE, detected_slug='invoice')
check("V2 ABSTAINS the same pick (returns None — no wrong supplier/type/layout imposed)",
      r_v2 is None)
check("V2 also abstains with no detected slug (method='logo')",
      run_identify(NEAR_COPPER, NORTHGATE_INVOICE) is None)

print("\n§2 defeat (b) — junk stored tokens must not fake the winner's corroboration")
check("RED PROOF: V1's raw own-ratio is defeated ('INV' + 'Industrial' hit => 0.29 > 0.0)",
      _keyword_hit_ratio(COPPER, NORTHGATE_INVOICE) > 0.0)
check("'INV' is not a distinctive token (proper prefix of 'invoice')",
      'inv' not in _distinctive_tokens(COPPER['keyword_fingerprint']))
check("'inverness' IS distinctive (not a prefix of any type word — the direction pin)",
      'inverness' in _distinctive_tokens(['Inverness']))
own, n = _distinctive_hit_ratio(COPPER, NORTHGATE_INVOICE)
check(f"V2 own-distinctive on the foreign page is below the 0.25 present-bar (got {own:.2f}/{n})",
      n > 0 and own < 0.25)
check("an ALL-JUNK fingerprint (['INV']) is own-absent (n==0), not own-present",
      _distinctive_hit_ratio({'keyword_fingerprint': ['INV']}, NORTHGATE_INVOICE) == (0.0, 0))

print("\n§3 defeat (c) — the rival bar must be reachable by a cross-type / leak-diluted rival")
check("RED PROOF: V1 sees NO rival on the Northgate page (type words cap the ratio below 0.75)",
      v1(_rival_branding_present, COPPER, TEMPLATES, NORTHGATE_INVOICE) is False)
check("V2 names Northgate as the rival (distinctive bank, type words stripped, issuer band)",
      _rival_branding_present(COPPER, TEMPLATES, NORTHGATE_INVOICE) is True)
check("RED PROOF (direct): V1 sees NO rival on the Vellum page (customer-leak dilution to 0.70)",
      v1(_rival_branding_present, COPPER, TEMPLATES, VELLUM_INVOICE) is False)
check("V2 names Vellum via the supplier-NAME arm (the bank stays leak-diluted; the name is not)",
      _rival_branding_present(COPPER, TEMPLATES, VELLUM_INVOICE) is True)
check("=> the doc-181 shape abstains end-to-end under V2",
      run_identify('bc4cc3b3c7385c42', VELLUM_INVOICE, detected_slug='invoice') is None)

print("\n§4 pins — what must NOT fire (absence is not evidence; genuine matches keep working)")
check("PIN: genuine Copperfield page => own branding present => ACCEPT",
      run_identify(NEAR_COPPER, COPPERFIELD_PAGE, detected_slug='invoice') is not None)
check("PIN ('matches Acme by logo alone'): no rival branding on the page => ACCEPT "
      "(fingerprint words didn't OCR; absence alone is never evidence)",
      run_identify(NEAR_COPPER, NO_BRANDING_PAGE, detected_slug='invoice') is not None)
check("PIN: own-distinctive >= 0.25 SELF-EXEMPTS even with a rival present "
      "(TYPE alone never re-becomes supplier corroboration, but real text corroboration stands)",
      _distinctive_hit_ratio(COPPER, COPPERFIELD_PAGE)[0] >= 0.25)
check("PIN: a template of the SAME supplier identity is never its own rival",
      _rival_branding_present(COPPER, [COPPER, dict(COPPER)], COPPERFIELD_PAGE) is False)
check("PIN: empty page => no rival (fail-safe)",
      _rival_branding_present(COPPER, TEMPLATES, '') is False)
check("PIN: no templates => no rival (fail-safe)",
      _rival_branding_present(COPPER, [], NORTHGATE_INVOICE) is False)

print("\n§5 the NAME arm's own guards (Oracle condition C)")
check("PIN: 'City Office' name-arm is UNJUDGEABLE ('office' generic => 1 surviving token < 2)",
      len(_name_arm_tokens('City Office')) < 2)
city = {'name': 'City Office NI', 'dominant_supplier': 'City Office NI',
        'keyword_fingerprint': []}
check("PIN: 'City Office NI' never becomes a rival on a page saying 'registered office ... city'",
      _rival_branding_present(COPPER, [COPPER, city],
                              'someco ltd\nregistered office 4 city road\ninvoice inv-9') is False)
check("PIN: a single-token name ('Sterling') is never a rival ('pounds sterling' on any page)",
      len(_name_arm_tokens('Sterling Ltd')) < 2)
check("name arm DOES judge a two-token name ('Northgate Textiles')",
      len(_name_arm_tokens('Northgate Textiles')) == 2)

print("\n§6 kill switch — TEMPLATE_GATE_DISTINCTIVE=0 restores V1 byte-identically")
check("=0: the doc-161 shape matches again (V1 behaviour, the revert pin)",
      v1(run_identify, NEAR_COPPER, NORTHGATE_INVOICE, detected_slug='invoice') is not None)
ideal_north = {'name': 'Northgate Textiles', 'dominant_supplier': 'Northgate Textiles',
               'keyword_fingerprint': ['northgate', 'textiles', 'weavers', 'preston']}
ideal_copper = {'name': 'Copperfield Electrical', 'dominant_supplier': 'Copperfield Electrical',
                'keyword_fingerprint': ['copperfield', 'electrical', 'switchgear', 'contractors']}
check("=0: the ORIGINAL V1 predicate still fires on its own idealized fixture",
      v1(_rival_branding_present, ideal_copper, [ideal_copper, ideal_north],
         'northgate textiles weavers preston bill to fernbank') is True)

print(f"\n{'FAIL' if fails else 'PASS'} — {fails} failed check(s)")
sys.exit(1 if fails else 0)
