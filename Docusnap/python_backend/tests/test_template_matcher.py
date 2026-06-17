#!/usr/bin/env python3
"""
tests/test_template_matcher.py
------------------------------
Targeted regression coverage for Stage 0 template identification
(extraction.template_matcher.identify_template / _match_by_logo /
_match_by_keywords / extract_keyword_fingerprint).

Written alongside the review/handler.js _upsertTemplate convergence fix
(same-supplier/same-layout documents now reuse one template via
templates.findByLogoHash instead of spawning a duplicate per confirm).
This module's own matching code was NOT changed by that fix — these checks
exist to prove Stage 0 still behaves exactly as the fix assumes:

  - a close logo-phash match (Hamming distance <= 5, confidence >= 65)
    wins immediately and short-circuits the keyword fallback — the same
    gate _upsertTemplate now mirrors via findByLogoHash + confidence >= 65
  - a logo distance just outside that gate (6 -> confidence 64) correctly
    falls through to keyword matching rather than forcing a weak match
  - keyword fingerprint matching requires >= 75% verbatim recall
  - nothing clearing its gate -> None (caller may legitimately start a new
    template — this is the "materially different layout" branch)

Also covers the keyword-fingerprint hardening for suppliers with weak/missing
logos (extract_keyword_fingerprint / _match_by_keywords):
  - per-document variable tokens (invoice numbers, dates, calendar words,
    amounts, customer names) do not survive into the persisted fingerprint,
    so two near-duplicate invoices from the same supplier converge on the
    same stable signal instead of drifting apart
  - stable supplier-branding words still survive the filtering
  - keyword matching is word-boundary aware, so a short fingerprint entry
    cannot score a false hit by appearing as a substring of an unrelated word

Mirrors test_template_mapper.py's "bypass the external dependency entirely"
convention: compute_logo_hash normally shells out to PIL/imagehash, so it is
monkeypatched here to read a deterministic `.phash` off a tiny page stub —
no image library or real rendering required.

Usage:
    py -3.12 python_backend/tests/test_template_matcher.py

Exit code 0 = behaves as expected. Exit code 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_matcher  # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def section(title):
    print(f"\n{title}")


class FakePage:
    """Stands in for a PIL page image — only ever handed to compute_logo_hash,
    which `with_stub_hash` replaces for the duration of each call below."""
    def __init__(self, phash):
        self.phash = phash


def with_stub_hash(fn):
    """Run `fn` with compute_logo_hash reading FakePage.phash directly,
    instead of shelling out to PIL/imagehash — deterministic and dependency-free."""
    original = template_matcher.compute_logo_hash
    template_matcher.compute_logo_hash = lambda page: page.phash
    try:
        return fn()
    finally:
        template_matcher.compute_logo_hash = original


# ── Fixtures: two unrelated supplier templates, as learned from confirmed docs ──

ACME_TEMPLATE = {
    'id': 1, 'name': 'Acme Corp Invoice',
    'logo_phash': 'a1b2c3d4e5f60718',
    'keyword_fingerprint': ['ACME', 'CORP', 'REMIT', 'ACCOUNT', 'WAREHOUSE'],
}
CONTOSO_TEMPLATE = {
    'id': 2, 'name': 'Contoso Receipt',
    'logo_phash': '5e6f7a8b9c0d1e2f',   # unrelated hash — large distance from Acme's
    'keyword_fingerprint': ['CONTOSO', 'RECEIPT', 'THANKYOU', 'STORE', 'VISIT'],
}
TEMPLATES = [ACME_TEMPLATE, CONTOSO_TEMPLATE]


def main():
    failures = 0

    # ── Logo match wins outright and short-circuits keyword fallback ─────────
    section('identify_template: exact logo phash match short-circuits keyword fallback')
    page = FakePage(phash='a1b2c3d4e5f60718')   # distance 0 from Acme's stored hash
    # Deliberately shares NO fingerprint words with either template — if logo
    # matching didn't win outright, this would fall through to a failing
    # keyword match and incorrectly return None.
    ocr_text = "Bill To: Someone Else\nInvoice 99999\nTotal Due: 1,234.56"
    match = with_stub_hash(lambda: template_matcher.identify_template(page, ocr_text, TEMPLATES))
    if not check('matches Acme by logo alone (no shared keywords needed)',
                 match and match['template']['id'] == 1):
        failures += 1
    if not check("method recorded as 'logo'", match and match['method'] == 'logo'):
        failures += 1
    if not check('confidence is 100 at distance 0', match and match['confidence'] == 100):
        failures += 1

    # ── Logo gate boundary: confidence >= 60 <=> Hamming distance <= 6 ───────
    # _upsertTemplate's findByLogoHash reuse path mirrors this exact gate
    # (see review/handler.js) — proving it here pins down what "close enough
    # to reuse" means on the Stage 0 side too, so the two stay consistent.
    #
    # Threshold was lowered from >= 65 (distance <= 5) to >= 60 (distance <= 6)
    # after two invoices from the same supplier ("SuperStore") were found to
    # produce logo hashes with Hamming distance 6 (last-byte render variance:
    # 5b vs b5, 6-bit XOR), which fell one confidence point below the old gate
    # and caused them to be treated as two separate templates. Distance 6 is
    # still very close (6/64 bits differ = 91% similar) and the risk of
    # cross-supplier false matches at this distance is low: the logo crop is
    # the top-left 50% × 20% of the page, and two genuinely different suppliers'
    # logos in that region would need to be accidentally 91% identical — a
    # realistic collision boundary sits around distance 10–12.
    section('identify_template: logo accept-gate boundary (distance 6 matches, 7 does not)')
    near   = FakePage(phash='a1b2c3d4e5f60797')   # differs from ...0718 by exactly 5 bits
    medium = FakePage(phash='a1b2c3d4e5f61797')   # differs from ...0718 by exactly 6 bits
    far    = FakePage(phash='b1b2c3d4e5f61797')   # differs from ...0718 by exactly 7 bits
    near_dist   = template_matcher._hamming(near.phash,   ACME_TEMPLATE['logo_phash'])
    medium_dist = template_matcher._hamming(medium.phash, ACME_TEMPLATE['logo_phash'])
    far_dist    = template_matcher._hamming(far.phash,    ACME_TEMPLATE['logo_phash'])
    if not check('fixtures sit at distances 5, 6, and 7 from the stored hash',
                 near_dist == 5 and medium_dist == 6 and far_dist == 7):
        failures += 1

    no_keywords = "completely unrelated text sharing no fingerprint words"
    near_match   = with_stub_hash(lambda: template_matcher.identify_template(near,   no_keywords, TEMPLATES))
    medium_match = with_stub_hash(lambda: template_matcher.identify_template(medium, no_keywords, TEMPLATES))
    far_match    = with_stub_hash(lambda: template_matcher.identify_template(far,    no_keywords, TEMPLATES))
    if not check('distance 5 -> confidence 70 clears the >= 60 gate -> logo match',
                 near_match and near_match['method'] == 'logo' and near_match['confidence'] == 70):
        failures += 1
    if not check('distance 6 -> confidence 64 clears the >= 60 gate -> logo match '
                 '(render variance of up to 6 bits no longer creates duplicate templates)',
                 medium_match and medium_match['method'] == 'logo' and medium_match['confidence'] == 64):
        failures += 1
    if not check('distance 7 -> confidence 58 misses the gate -> falls through to keywords, '
                 'which also miss -> None (a materially different/unrecognised layout)',
                 far_match is None):
        failures += 1

    # ── Keyword fingerprint fallback (used when no usable logo match exists) ──
    section('identify_template: keyword fingerprint fallback')
    kw_hit = "CONTOSO RECEIPT\nThank you for shopping at our STORE\nPlease VISIT again soon"
    kw_match = template_matcher.identify_template(None, kw_hit, TEMPLATES)
    if not check('matches Contoso via keywords when no page image is available',
                 kw_match and kw_match['template']['id'] == 2 and kw_match['method'] == 'keywords'):
        failures += 1

    kw_miss = "A completely unrelated document sharing no fingerprint vocabulary whatsoever"
    miss_match = template_matcher.identify_template(None, kw_miss, TEMPLATES)
    if not check('below the 75% keyword-recall gate -> None', miss_match is None):
        failures += 1

    # ── extract_keyword_fingerprint: the signal _upsertTemplate persists ─────
    section('extract_keyword_fingerprint: keeps distinctive header words, drops generic stop words')
    fp = template_matcher.extract_keyword_fingerprint(
        "ACME CORP\nTax Invoice\nThe total amount due for this invoice is shown on the order page below"
    )
    fp_lower = [w.lower() for w in fp]
    if not check('keeps distinctive supplier-branding words', 'acme' in fp_lower and 'corp' in fp_lower):
        failures += 1
    if not check('drops generic stop words (the/total/amount/invoice/order/page/this/for)',
                 not any(w in fp_lower for w in
                         ('the', 'total', 'amount', 'invoice', 'order', 'page', 'this', 'for'))):
        failures += 1

    # ── extract_keyword_fingerprint: per-document variable tokens must not pollute it ──
    # Two near-duplicate invoices from the SAME supplier — everything that
    # differs between them (ref, date, customer, totals) is exactly what must
    # NOT survive into the fingerprint, or the "fingerprint" stops being a
    # stable per-supplier signal and starts being a per-document one.
    section('extract_keyword_fingerprint: variable per-invoice tokens do not dominate the fingerprint')
    invoice_one = template_matcher.extract_keyword_fingerprint(
        "GLOBEX TRADING LIMITED\nInvoice INV2024-0193\n"
        "Date: 14 March 2025\nBill To: Northwind Traders\nAmount Due GBP 4521.90"
    )
    invoice_two = template_matcher.extract_keyword_fingerprint(
        "GLOBEX TRADING LIMITED\nInvoice INV2024-0871\n"
        "Date: 02 September 2025\nBill To: Fabrikam Retail\nAmount Due GBP 118.40"
    )
    one_lower = [w.lower() for w in invoice_one]
    two_lower = [w.lower() for w in invoice_two]
    if not check('digit-bearing tokens (invoice numbers, mixed alphanumeric refs) are dropped',
                 not any(any(ch.isdigit() for ch in w) for w in invoice_one + invoice_two)):
        failures += 1
    if not check('calendar words (rotating month names) are dropped',
                 'march' not in one_lower and 'september' not in two_lower):
        failures += 1
    # Customer name ("Northwind Traders" vs "Fabrikam Retail") sits in the
    # recipient block AFTER "Bill To:" — harvesting now stops at that marker, so
    # the per-document customer words are excluded entirely (the bug that made a
    # template match only its one sample customer). The stable supplier core
    # above the marker is kept.
    if not check('recipient-block customer names are excluded from the fingerprint',
                 not ({'northwind', 'traders', 'fabrikam', 'retail'} & (set(one_lower) | set(two_lower)))):
        failures += 1
    shared = set(one_lower) & set(two_lower)
    if not check('the two same-supplier fingerprints still share a stable supplier-identity core',
                 {'globex', 'trading', 'limited'} <= shared):
        failures += 1

    # ── _match_by_keywords: substring collisions must not inflate scores ─────
    # "LTD" is a short, distinctive single-word fingerprint entry. Plain
    # substring containment would score a hit against "ALTDORF" even though
    # the document has nothing to do with that supplier — exactly the kind of
    # accidental cross-supplier collision that makes keyword fallback brittle
    # for suppliers without a usable logo.
    section('_match_by_keywords: word-boundary matching avoids accidental substring collisions')
    LTD_TEMPLATE = {
        'id': 3, 'name': 'Bartholomew Ltd Invoice',
        'logo_phash': None,
        'keyword_fingerprint': ['BARTHOLOMEW', 'LTD', 'WORKSHOP'],
    }
    collision_text = "ALTDORF GMBH\nLieferschein\nKundenservice und Logistik Zentrum"
    collision_match = template_matcher._match_by_keywords(collision_text, [LTD_TEMPLATE])
    if not check("'LTD' inside 'ALTDORF' does not count as a hit (no false match)",
                 collision_match is None):
        failures += 1

    genuine_text = "BARTHOLOMEW LTD\nInvoice from our WORKSHOP team\nThank you for your custom"
    genuine_match = template_matcher._match_by_keywords(genuine_text, [LTD_TEMPLATE])
    if not check('a genuine, boundary-respecting match still scores all three hits',
                 genuine_match and genuine_match['confidence'] == 100):
        failures += 1

    # ── ocr_auto_enabled / ocr_auto_params must not influence matching ──────
    # Per-template OCR auto-processing rules (templates.ocr_auto_enabled /
    # ocr_auto_params, see database/modules/templates.js setOcrAutoParams) are
    # applied AFTER a template has already been selected on identity grounds
    # (logo/keyword) — see processing/handler.js reprocess-document. Stage 0
    # itself never reads these fields. These checks pin that down: two
    # candidates that are otherwise identical (same logo distance / same
    # keyword score -> a tie) must resolve to the same winner regardless of
    # which one (if either) has OCR auto-processing enabled.
    section('identify_template: ocr_auto_enabled/ocr_auto_params do not affect tie-break or ordering')
    SAME_HASH = 'c0ffee00c0ffee00'
    TPL_A = {'id': 20, 'name': 'Sibling A', 'logo_phash': SAME_HASH, 'keyword_fingerprint': []}
    TPL_B = {'id': 21, 'name': 'Sibling B', 'logo_phash': SAME_HASH, 'keyword_fingerprint': []}
    tie_page = FakePage(phash=SAME_HASH)
    AUTO_PARAMS = {'grayscale': True, 'threshold': True, 'threshold_level': 140, 'noise_level': 2}

    neither_auto = with_stub_hash(
        lambda: template_matcher.identify_template(tie_page, "irrelevant text", [TPL_A, TPL_B]))
    if not check('baseline tie (identical logo hash, neither has OCR auto) -> first candidate (A) wins',
                 neither_auto and neither_auto['template']['id'] == 20):
        failures += 1

    loser_has_auto = with_stub_hash(lambda: template_matcher.identify_template(
        tie_page, "irrelevant text",
        [TPL_A, {**TPL_B, 'ocr_auto_enabled': 1, 'ocr_auto_params': AUTO_PARAMS}]))
    if not check('giving the tie-loser (B) OCR auto-processing does not flip the winner to B',
                 loser_has_auto and loser_has_auto['template']['id'] == 20):
        failures += 1

    winner_has_auto = with_stub_hash(lambda: template_matcher.identify_template(
        tie_page, "irrelevant text",
        [{**TPL_A, 'ocr_auto_enabled': 1, 'ocr_auto_params': AUTO_PARAMS}, TPL_B]))
    if not check('giving the tie-winner (A) OCR auto-processing does not demote it either',
                 winner_has_auto and winner_has_auto['template']['id'] == 20):
        failures += 1

    both_auto = with_stub_hash(lambda: template_matcher.identify_template(
        tie_page, "irrelevant text",
        [{**TPL_A, 'ocr_auto_enabled': 1, 'ocr_auto_params': AUTO_PARAMS},
         {**TPL_B, 'ocr_auto_enabled': 1, 'ocr_auto_params': AUTO_PARAMS}]))
    if not check('both candidates having OCR auto-processing still resolves the same tie the same way',
                 both_auto and both_auto['template']['id'] == 20):
        failures += 1

    # Same check via the keyword-fallback path (separate tie-break: score > best_score)
    KW_A = {'id': 22, 'name': 'KW Sibling A', 'logo_phash': None, 'keyword_fingerprint': ['ZAPHOD', 'BEEBLEBROX']}
    KW_B = {'id': 23, 'name': 'KW Sibling B', 'logo_phash': None, 'keyword_fingerprint': ['ZAPHOD', 'BEEBLEBROX']}
    kw_text = "ZAPHOD BEEBLEBROX\nInvoice\nTotal Due 1.00"

    kw_neither = template_matcher.identify_template(None, kw_text, [KW_A, KW_B])
    if not check('keyword tie (identical fingerprints, neither has OCR auto) -> first candidate wins',
                 kw_neither and kw_neither['template']['id'] == 22):
        failures += 1

    kw_loser_auto = template_matcher.identify_template(
        None, kw_text, [KW_A, {**KW_B, 'ocr_auto_enabled': 1, 'ocr_auto_params': AUTO_PARAMS}])
    if not check('keyword tie: OCR auto-processing on the loser does not flip the winner',
                 kw_loser_auto and kw_loser_auto['template']['id'] == 22):
        failures += 1

    # The fix: same-logo SIBLINGS (one supplier, several layouts under one
    # letterhead) are disambiguated by KEYWORD FINGERPRINT, and the winner carries
    # its OWN document_type_slug — so a worksheet isn't matched to the PO template
    # (and then mis-typed). The logo alone can't tell them apart.
    section('identify_template: same-logo siblings disambiguated by keyword fingerprint + slug')
    PO_TPL = {'id': 30, 'name': 'Acme PO', 'logo_phash': SAME_HASH,
              'document_type_slug': 'purchase_order', 'keyword_fingerprint': ['PURCHASE', 'ORDER']}
    WS_TPL = {'id': 31, 'name': 'Acme Worksheet', 'logo_phash': SAME_HASH,
              'document_type_slug': 'wsheet', 'keyword_fingerprint': ['SERVICE', 'WORKSHEET']}
    ws_hit = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(phash=SAME_HASH), "ACME LTD\nSERVICE WORKSHEET\nTicket No 2605-0769-1",
        [PO_TPL, WS_TPL]))
    if not check('worksheet page picks the WORKSHEET sibling, not the PO sibling (same logo)',
                 ws_hit and ws_hit['template']['id'] == 31):
        failures += 1
    if not check('matched sibling carries its own doc-type slug (wsheet)',
                 ws_hit and ws_hit['template'].get('document_type_slug') == 'wsheet'):
        failures += 1
    if not check('method reflects the keyword disambiguation (logo+keywords)',
                 ws_hit and ws_hit.get('method') == 'logo+keywords'):
        failures += 1
    po_hit = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(phash=SAME_HASH), "ACME LTD\nPURCHASE ORDER\nPO No 12345", [PO_TPL, WS_TPL]))
    if not check('PO page picks the PO sibling from the same-logo cluster',
                 po_hit and po_hit['template']['id'] == 30):
        failures += 1

    print()
    if failures:
        print(f"{failures} check(s) failed — template_matcher Stage 0 identification regressed.")
        sys.exit(1)
    print('All checks passed — template_matcher Stage 0 identification behaves as expected.')


if __name__ == '__main__':
    main()
