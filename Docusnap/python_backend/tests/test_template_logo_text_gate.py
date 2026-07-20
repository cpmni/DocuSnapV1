"""
tests/test_template_logo_text_gate.py — Slice 1d: a LOGO-ONLY template accept needs the text not to
contradict it (identity text-first, 2026-07-20).

Live case that forced this (owner, 2026-07-20): a NORTHGATE invoice matched a COPPERFIELD invoice
template and filed as Copperfield at 69% — while its 7 siblings resolved correctly via
hint_text_match. Northgate has no invoice template of its own, so the Copperfield one won on a
64-bit logo distance that is MEASURED to carry no supplier information on scans (cross-supplier MIN
hamming 2 vs same-supplier min 6). This path sets the supplier BEFORE the engine's logo gate can
see it (template_fixed), so it needed its own gate.

THE SHAPE (mirrors the engine's three-way): mere ABSENCE of the winner's branding is NOT evidence —
a bad scan looks identical — so a legitimate logo-only match still works (pinned in
test_template_matcher as "matches Acme by logo alone"). We abstain only on POSITIVE DISAGREEMENT:
the winner's branding absent AND another supplier's branding decisively present.

    py -3.12 tests/test_template_logo_text_gate.py     (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.template_matcher import _rival_branding_present, _keyword_hit_ratio  # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


COPPER = {'name': 'Copperfield Electrical', 'dominant_supplier': 'Copperfield Electrical',
          'keyword_fingerprint': ['copperfield', 'electrical', 'switchgear', 'contractors']}
NORTH = {'name': 'Northgate Textiles', 'dominant_supplier': 'Northgate Textiles',
         'keyword_fingerprint': ['northgate', 'textiles', 'weavers', 'preston']}
TEMPLATES = [COPPER, NORTH]

NORTHGATE_INVOICE = ('northgate textiles northgate mill 14 weavers way preston pr1 3qx invoice '
                     'inv-17226 bill to fernbank veterinary clinic 44 woodland rise guildford '
                     'monthly retainer installation site survey parts materials net total vat')
COPPERFIELD_PAGE = 'copperfield electrical switchgear contractors invoice inv-1 bill to someone ltd'
NO_BRANDING_PAGE = 'a page whose fingerprint words did not survive OCR at all just 123 456 789'

# The gate fires when BOTH hold (as wired in identify_template).
gate = lambda t, page: (_keyword_hit_ratio(t, page) <= 0.0            # noqa: E731
                        and _rival_branding_present(t, TEMPLATES, page))

print("§1 the incident")
check('a Copperfield template on a NORTHGATE page has zero own-branding',
      _keyword_hit_ratio(COPPER, NORTHGATE_INVOICE) == 0.0)
check('...and the rival (Northgate) branding IS decisively present',
      _rival_branding_present(COPPER, TEMPLATES, NORTHGATE_INVOICE) is True)
check('=> the logo-only accept ABSTAINS (the wrong supplier/type/layout is never imposed)',
      gate(COPPER, NORTHGATE_INVOICE) is True)

print("\n§2 controls — the gate must not fire")
check('a genuine Copperfield page: own branding present => accept',
      gate(COPPER, COPPERFIELD_PAGE) is False)
check('PIN: logo-only match with NO rival branding on the page => ACCEPT (the "matches Acme by '
      'logo alone" behaviour stays; absence is not evidence)',
      gate(COPPER, NO_BRANDING_PAGE) is False)
check('a template with NO fingerprint is unjudgeable => never a rival',
      _rival_branding_present({'name': 'X'}, [{'name': 'Y', 'keyword_fingerprint': []}],
                              NORTHGATE_INVOICE) is False)
check('a template of the SAME supplier identity is never its own rival',
      _rival_branding_present(COPPER, [COPPER, dict(COPPER)], COPPERFIELD_PAGE) is False)
check('empty page text => no rival (fail-safe)', _rival_branding_present(COPPER, TEMPLATES, '') is False)
check('no templates => no rival (fail-safe)', _rival_branding_present(COPPER, [], NORTHGATE_INVOICE) is False)

print("\n§3 the rival bar is DECISIVE presence, not a trace")
weak = {'name': 'Weak Co', 'dominant_supplier': 'Weak Co',
        'keyword_fingerprint': ['northgate', 'zzz1', 'zzz2', 'zzz3']}   # 1 of 4 words on the page
check('a template sharing ONE incidental word is not a rival (ratio 0.25 < 0.75 bar)',
      _rival_branding_present(COPPER, [COPPER, weak], NORTHGATE_INVOICE) is False)

print(f"\n{'FAIL' if fails else 'PASS'} — {fails} failed check(s)")
sys.exit(1 if fails else 0)
