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
This module's own matching code was NOT changed by that fix - these checks
exist to prove Stage 0 still behaves exactly as the fix assumes:

  - a close logo-phash match (Hamming distance <= 5, confidence >= 65)
    wins immediately and short-circuits the keyword fallback - the same
    gate _upsertTemplate now mirrors via findByLogoHash + confidence >= 65
  - a logo distance just outside that gate (6 -> confidence 64) correctly
    falls through to keyword matching rather than forcing a weak match
  - keyword fingerprint matching requires >= 75% verbatim recall
  - nothing clearing its gate -> None (caller may legitimately start a new
    template - this is the "materially different layout" branch)

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
monkeypatched here to read a deterministic `.phash` off a tiny page stub -
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
    """Stands in for a PIL page image - only ever handed to compute_logo_hash,
    which `with_stub_hash` replaces for the duration of each call below."""
    def __init__(self, phash):
        self.phash = phash


def with_stub_hash(fn):
    """Run `fn` with compute_logo_hash reading FakePage.phash directly,
    instead of shelling out to PIL/imagehash - deterministic and dependency-free."""
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
    'logo_phash': '5e6f7a8b9c0d1e2f',   # unrelated hash - large distance from Acme's
    'keyword_fingerprint': ['CONTOSO', 'RECEIPT', 'THANKYOU', 'STORE', 'VISIT'],
}
TEMPLATES = [ACME_TEMPLATE, CONTOSO_TEMPLATE]


def main():
    failures = 0

    # ── Logo match wins outright and short-circuits keyword fallback ─────────
    section('identify_template: exact logo phash match short-circuits keyword fallback')
    page = FakePage(phash='a1b2c3d4e5f60718')   # distance 0 from Acme's stored hash
    # Deliberately shares NO fingerprint words with either template - if logo
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
    # (see review/handler.js) - proving it here pins down what "close enough
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
    # logos in that region would need to be accidentally 91% identical - a
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

    # ── FINGERPRINT_HYGIENE (slice 3, 2026-07-20): ref-prefix fragments are not branding ──
    # The token regex splits "INV-76642" at '-', so 'INV' reached the digit filter digit-free and
    # entered ~every invoice template's permanent identity (the live tpl-2 pollution that faked
    # cross-supplier corroboration). The skip tests the RAW-TEXT context, not the token stream.
    section('extract_keyword_fingerprint: a token glued to -/digit in the raw text is a ref prefix, not branding')
    fp_ref = template_matcher.extract_keyword_fingerprint(
        "NORTHGATE TEXTILES\nINV-76642\nREF/2024-1\nJOB#4417\nWeavers Way Preston")
    fp_ref_lower = [w.lower() for w in fp_ref]
    if not check("'INV' / 'REF' / 'JOB' (digit-glued) are dropped at harvest",
                 not any(w in fp_ref_lower for w in ('inv', 'ref', 'job'))):
        failures += 1
    if not check('real branding words around them still harvest',
                 'northgate' in fp_ref_lower and 'weavers' in fp_ref_lower):
        failures += 1
    import os as _os
    _old_hyg = _os.environ.get('FINGERPRINT_HYGIENE')
    _os.environ['FINGERPRINT_HYGIENE'] = '0'
    try:
        fp_ref_v0 = [w.lower() for w in template_matcher.extract_keyword_fingerprint(
            "NORTHGATE TEXTILES\nINV-76642\nWeavers Way Preston")]
    finally:
        if _old_hyg is None:
            _os.environ.pop('FINGERPRINT_HYGIENE', None)
        else:
            _os.environ['FINGERPRINT_HYGIENE'] = _old_hyg
    if not check("kill switch =0 restores the legacy harvest ('inv' captured — the red proof/revert pin)",
                 'inv' in fp_ref_v0):
        failures += 1

    # ── extract_keyword_fingerprint: per-document variable tokens must not pollute it ──
    # Two near-duplicate invoices from the SAME supplier - everything that
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
    # recipient block AFTER "Bill To:" - harvesting now stops at that marker, so
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
    # the document has nothing to do with that supplier - exactly the kind of
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
    # (logo/keyword) - see processing/handler.js reprocess-document. Stage 0
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

    # ── Fix (2026-07-12): keyword fallback prefers the DETECTED-TYPE sibling on a tie ──────────
    # A supplier issuing several doc types on ONE letterhead has same-logo siblings with IDENTICAL
    # keyword fingerprints; when the logo drifts and this fallback runs, the wrong-type sibling used
    # to win by template ORDER (Cascade delivery-docket typed 'invoice' -> delivery_number null).
    # detected_slug now breaks the tie toward the sibling matching the doc's OWN detected title.
    section('_match_by_keywords: detected_slug breaks a same-fingerprint sibling tie (type-aware)')
    DN_TPL  = {'id': 30, 'name': 'Cascade Delivery', 'logo_phash': None,
               'document_type_slug': 'delivery_note', 'confirmed_count': 0,
               'keyword_fingerprint': ['CASCADE', 'WATER', 'SYSTEMS']}
    INV_TPL = {'id': 31, 'name': 'Cascade Invoice', 'logo_phash': None,
               'document_type_slug': 'invoice', 'confirmed_count': 0,
               'keyword_fingerprint': ['CASCADE', 'WATER', 'SYSTEMS']}
    cascade_text = "CASCADE WATER SYSTEMS\nDELIVERY DOCKET\nDN-62705"
    m_inv_first = template_matcher._match_by_keywords(cascade_text, [INV_TPL, DN_TPL], detected_slug='delivery_note')
    if not check('invoice-FIRST order: detected delivery_note sibling still wins (the live-bug order)',
                 m_inv_first and m_inv_first['template']['id'] == 30):
        failures += 1
    m_dn_first = template_matcher._match_by_keywords(cascade_text, [DN_TPL, INV_TPL], detected_slug='delivery_note')
    if not check('delivery-FIRST order: same winner -> deterministic, order-independent',
                 m_dn_first and m_dn_first['template']['id'] == 30):
        failures += 1
    if not check("winner method is 'keywords'", m_inv_first and m_inv_first['method'] == 'keywords'):
        failures += 1
    m_blind = template_matcher._match_by_keywords(cascade_text, [INV_TPL, DN_TPL])
    if not check('no detected_slug -> first-seen wins the tie (byte-identical old behaviour)',
                 m_blind and m_blind['template']['id'] == 31):
        failures += 1

    # PIN THE TRADE-OFF (load-bearing): the slug preference is TIE-ONLY, NEVER a boost. A strictly
    # higher-scoring DIFFERENT-type template MUST still win — else a weak same-type sibling could beat
    # a strong (cross-supplier) match, the misfile class the word-boundary guard exists to prevent.
    # Do NOT "fix" this by boosting the slug match above score.
    WEAK_DN    = {'id': 32, 'name': 'Weak DN', 'logo_phash': None, 'document_type_slug': 'delivery_note',
                  'confirmed_count': 0, 'keyword_fingerprint': ['CASCADE', 'WATER', 'ZZZ']}   # 2/3
    STRONG_INV = {'id': 33, 'name': 'Strong INV', 'logo_phash': None, 'document_type_slug': 'invoice',
                  'confirmed_count': 0, 'keyword_fingerprint': ['CASCADE', 'WATER']}           # 2/2
    m_score = template_matcher._match_by_keywords(cascade_text, [WEAK_DN, STRONG_INV], detected_slug='delivery_note')
    if not check('PIN: a strictly higher-scoring different-type template still wins (tie-only, never a boost)',
                 m_score and m_score['template']['id'] == 33):
        failures += 1

    m_single = template_matcher._match_by_keywords(cascade_text, [INV_TPL], detected_slug='delivery_note')
    if not check('single candidate returns regardless of a non-matching detected_slug',
                 m_single and m_single['template']['id'] == 31):
        failures += 1

    # F1-C1 (Oracle): the "no keyword hit -> None" contract is INDEPENDENT of the tie-break key — a
    # ZERO-hit template must never become a result, even when it slug-matches (else it would return a
    # confidence-0 dict where today it returns None).
    NOHIT_DN = {'id': 34, 'name': 'Nohit DN', 'logo_phash': None, 'document_type_slug': 'delivery_note',
                'confirmed_count': 3, 'keyword_fingerprint': ['ZZZ', 'QQQ']}   # neither word on cascade_text
    m_nohit = template_matcher._match_by_keywords(cascade_text, [NOHIT_DN], detected_slug='delivery_note')
    if not check('F1-C1: a zero-hit slug-matching template is NOT returned (stays None)', m_nohit is None):
        failures += 1

    # F1-C5 (Oracle): the ENGINE co-run — identify_template (Stage 0, logo cluster empty via page_image=None)
    # routes to the keyword path and prefers the detected_slug sibling. This is the seam gary's
    # "mutually-exclusive branches" model missed: Fix 1 ALSO runs inside engine.extract on a forced reprocess,
    # cooperatively recovering the correct-type template.
    id_corun = template_matcher.identify_template(None, cascade_text, [INV_TPL, DN_TPL], detected_slug='delivery_note')
    if not check('F1-C5: identify_template (no logo) + detected_slug picks the delivery_note sibling (engine co-run)',
                 id_corun and id_corun['template']['id'] == 30):
        failures += 1

    # The fix: same-logo SIBLINGS (one supplier, several layouts under one
    # letterhead) are disambiguated by KEYWORD FINGERPRINT, and the winner carries
    # its OWN document_type_slug - so a worksheet isn't matched to the PO template
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

    # ── THE LIVE BUG: same-logo siblings with IDENTICAL keyword fingerprints ──
    # A supplier issuing several layouts under ONE letterhead -> the fingerprint is JUST
    # the letterhead words, IDENTICAL between siblings, so the fingerprint tie-break above
    # can't tell them apart and the established sibling wins -> wrong type. Only the detected
    # TITLE distinguishes them. (The section above uses DIFFERING fingerprints and does not
    # reproduce this.) Pins the detected_slug sibling pick + the title_trusted refuse.
    section('identify_template: identical-fingerprint siblings disambiguated by detected_slug')
    LH = ['ASHFORD', 'WHOLESALE', 'CHURCH', 'ROAD']   # shared letterhead fingerprint
    SO_TPL  = {'id': 9,  'name': 'Ashford SO', 'logo_phash': SAME_HASH, 'confirmed_count': 2,
               'document_type_slug': 'sales_order', 'keyword_fingerprint': LH}
    WS2_TPL = {'id': 10, 'name': 'Ashford WS', 'logo_phash': SAME_HASH, 'confirmed_count': 0,
               'document_type_slug': 'worksheet',   'keyword_fingerprint': LH}
    SIBS = [SO_TPL, WS2_TPL]                          # SO first (established) = today's list-order winner
    ocr  = "ASHFORD WHOLESALE\nWORKSHEET 38\nCHURCH ROAD"

    m_none = with_stub_hash(lambda: template_matcher.identify_template(FakePage(SAME_HASH), ocr, SIBS))
    if not check('detected_slug=None -> identical-fingerprint tie unbroken -> established sales_order wins (the bug)',
                 m_none and m_none['template']['id'] == 9):
        failures += 1
    m_ws = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(SAME_HASH), ocr, SIBS, detected_slug='worksheet', title_trusted=True))
    if not check('detected_slug=worksheet -> picks the WORKSHEET sibling #10 (THE FIX)',
                 m_ws and m_ws['template']['id'] == 10 and m_ws['template']['document_type_slug'] == 'worksheet'):
        failures += 1
    if not check("  -> method reflects slug disambiguation ('logo+slug')",
                 m_ws and m_ws.get('method') == 'logo+slug'):
        failures += 1
    m_refuse = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(SAME_HASH), ocr, SIBS, detected_slug='purchase_order', title_trusted=True))
    # C1 (TYPE-heading authority): the trusted-title refuse now returns a HOLD sentinel (template
    # None + type_refused) so the engine HOLDS the doc for review instead of silently typing it via
    # detection at overall==100; it is still "no usable template" for every (m or {}).get('template')
    # reader (byte-identical downstream). See engine._flag_type_ambiguity refuse branch.
    if not check('trusted title of a type NO sibling has -> REFUSE (hold sentinel: template None + type_refused)',
                 (m_refuse or {}).get('template') is None and (m_refuse or {}).get('type_refused') is True):
        failures += 1
    # C5(a) byte-identical pin: TYPE_REFUSE_HOLD=0 -> the pre-C1 None refuse exactly.
    import os as _os
    _os.environ['TYPE_REFUSE_HOLD'] = '0'
    m_refuse_off = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(SAME_HASH), ocr, SIBS, detected_slug='purchase_order', title_trusted=True))
    _os.environ.pop('TYPE_REFUSE_HOLD', None)
    if not check('TYPE_REFUSE_HOLD=0 -> refuse returns None (byte-identical to pre-C1)',
                 m_refuse_off is None):
        failures += 1
    m_fb = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(SAME_HASH), ocr, SIBS, detected_slug='purchase_order', title_trusted=False))
    if not check('UNtrusted mention + no matching sibling -> does NOT refuse (falls back - refuse can\'t eat good matches)',
                 m_fb is not None):
        failures += 1
    m_single = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(SAME_HASH), ocr, [SO_TPL], detected_slug='worksheet', title_trusted=True))
    if not check('single sales_order template + trusted worksheet title -> REFUSE (hold sentinel, no wrong-type force)',
                 (m_single or {}).get('template') is None and (m_single or {}).get('type_refused') is True):
        failures += 1
    m_ok = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(SAME_HASH), "ASHFORD WHOLESALE\nSALES ORDER\nSO-12345", [SO_TPL],
        detected_slug='sales_order', title_trusted=True))
    if not check('single sales_order template + trusted sales_order title -> keeps #9 (no regression)',
                 m_ok and m_ok['template']['id'] == 9):
        failures += 1

    # ── LOGO_REFUSE_FALLTHROUGH (2026-07-25): the logo arm locks a WRONG-TYPE same-letterhead sibling
    #    (the 64-bit phash can't tell a supplier's layouts apart), so the trusted-title refuse used to
    #    return before the same-type rescue/keyword arm could resolve the RIGHT-type sibling. Doc 555
    #    (SaltmarshSeafoods_worksheet): logo dist 4 to the sales_order template, 18 to its own worksheet
    #    template. Fall through, with Oracle C1's supplier-scoping guard. ──────────────────────────────
    section('LOGO_REFUSE_FALLTHROUGH: wrong-type logo lock falls through to the right-type keyword match')
    import os as _os2
    NEAR = '0000000000000000'            # doc logo + the wrong-type sibling (dist 0, conf 100)
    FAR  = '000000000003ffff'            # the right-type sibling (dist 18 > LOGO_THRESHOLD 13 -> excluded from the logo cluster)
    LH   = ['saltmarsh', 'seafoods']
    WRONG = {'id': 21, 'name': 'Saltmarsh SO', 'logo_phash': NEAR, 'confirmed_count': 3,
             'document_type_slug': 'sales_order', 'keyword_fingerprint': LH, 'dominant_supplier': 'Saltmarsh Seafoods'}
    RIGHT = {'id': 23, 'name': 'Saltmarsh WS', 'logo_phash': FAR,  'confirmed_count': 3,
             'document_type_slug': 'service_worksheet', 'keyword_fingerprint': LH, 'dominant_supplier': 'Saltmarsh Seafoods'}
    ws_ocr = "SALTMARSH SEAFOODS\nWORKSHEET 38\nREFERENCE NO WS-26836"

    # (a) THE FIX — a future dev restoring `return _type_refuse` at :271 makes this RED (refuse instead of RIGHT).
    m_ft = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(NEAR), ws_ocr, [WRONG, RIGHT], detected_slug='service_worksheet', title_trusted=True))
    if not check('logo locks wrong-TYPE sibling but right-type sibling matches by keyword -> resolves RIGHT (id23), no refuse',
                 m_ft and m_ft['template']['id'] == 23 and not m_ft.get('type_refused')):
        failures += 1

    # (c) C1 SUPPLIER GUARD (load-bearing) — only a DIFFERENT-supplier right-type template matches -> re-emit refuse, never file the wrong company.
    OTHER = {'id': 30, 'name': 'Bexley WS', 'logo_phash': 'ffffffffffffffff', 'confirmed_count': 3,
             'document_type_slug': 'service_worksheet', 'keyword_fingerprint': ['bexley', 'traders'],
             'dominant_supplier': 'Bexley Traders'}
    other_ocr = "SALTMARSH SEAFOODS\nWORKSHEET 38\nBEXLEY TRADERS LTD"   # both brandings present on the page
    m_c1 = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(NEAR), other_ocr, [WRONG, OTHER], detected_slug='service_worksheet', title_trusted=True))
    if not check('C1: logo locked Saltmarsh, only a DIFFERENT-supplier (Bexley) right-type template matches -> re-emit refuse, NOT Bexley',
                 (m_c1 or {}).get('template') is None and (m_c1 or {}).get('type_refused') is True):
        failures += 1

    # (b) PURE RE-EMIT — no right-type template for anyone + no keyword hit -> the end re-emit fires (deleting it makes this RED).
    m_re = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(NEAR), "WORKSHEET 38\nUNRELATED BODY TEXT", [WRONG],
        detected_slug='service_worksheet', title_trusted=True))
    if not check('pure re-emit: logo refuses, no rescue + no keyword hit -> refuse held via the end re-emit',
                 (m_re or {}).get('template') is None and (m_re or {}).get('type_refused') is True):
        failures += 1

    # (e) OFF byte-identical — LOGO_REFUSE_FALLTHROUGH=0 restores the immediate refuse at :271 (does NOT reach the rescue).
    _os2.environ['LOGO_REFUSE_FALLTHROUGH'] = '0'
    m_off2 = with_stub_hash(lambda: template_matcher.identify_template(
        FakePage(NEAR), ws_ocr, [WRONG, RIGHT], detected_slug='service_worksheet', title_trusted=True))
    _os2.environ.pop('LOGO_REFUSE_FALLTHROUGH', None)
    if not check('OFF (=0): logo-arm refuse returns immediately (byte-identical) -> hold sentinel, NOT the rescued RIGHT',
                 (m_off2 or {}).get('template') is None and (m_off2 or {}).get('type_refused') is True):
        failures += 1
    # (d, no-right-type still refuses) is covered above by m_refuse (:447) + m_single (:470): both now flow through
    # the fall-through and end in a refuse via the keyword arm's own trusted-title guard — the preserved fail-safe.

    print()
    if failures:
        print(f"{failures} check(s) failed - template_matcher Stage 0 identification regressed.")
        sys.exit(1)
    print('All checks passed - template_matcher Stage 0 identification behaves as expected.')


if __name__ == '__main__':
    main()
