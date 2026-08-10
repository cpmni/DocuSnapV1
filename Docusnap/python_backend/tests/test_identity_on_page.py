"""test_identity_on_page.py — a template may not claim a document that never mentions its company.

Run: py -3.12 python_backend/tests/test_identity_on_page.py

THE DEFECT (measured end to end, 2026-08-10). Confirming ONE purchase order created a template for
'Quillstone Print & Packaging'. On a document a business ISSUES ITSELF the letterhead is its OWN, so
the fingerprint harvester — doing exactly what it was designed to do, take the header and stop at the
recipient marker — captured the OWNER's own address block:

    ["Bramblewood","Joinery","Ltd","PURCHASE","Unit","Sawpit","Lane","Draymarket","Tel","VAT"]

That block is printed on EVERY document the business RECEIVES, as the Bill To / Deliver To block.
Scored against one document from each of ten suppliers it hits **0.80 on every single one**. And
`_match_by_keywords` has no minimum score and no margin — a template need only BEAT the others, never
be good. So 18 Oakhaven Electrical delivery notes were claimed by the Quillstone template and stamped
`supplier_name = 'Quillstone Print & Packaging'` at 95, and one was confirmed by a real user and
FILED INTO THE WRONG COMPANY'S FOLDER with the true supplier's VAT number in the XML beside it.

**This generalises to every customer who files their own purchase orders.**

THE MEASUREMENT THAT CHOSE THIS FIX (200 documents, keyword path, the failing `detected_slug=None`):

    RIGHT match, template name on page   160  -> kept
    WRONG match, name absent              40  -> refused
    RIGHT match, name absent               0  <- the cost, zero on this corpus

Perfect separation. That is why the guard is a presence test and not a threshold: it keys on the
actual error — this template's company is not mentioned anywhere on this document — rather than on a
number somebody would have to tune.

WHAT THESE PINS DEFEND
  * OFF is byte-identical, and the OFF twin proves the defect still reproduces — a green ARMED test
    means nothing unless the unarmed one is red by construction.
  * The guard is scoped to the TEXT arms. The logo arm keeps `decide_logo_text_gate`, which
    distinguishes "branding absent" (abstain) from "unjudgeable" (suggest, review-bound). A
    logo-only letterhead is a real thing and must keep that nuance; the keyword arm had no gate at all.
  * ONE predicate, shared with `engine._template_identity_corroborated`. Two spellings of one
    question is how this codebase has been bitten before.
  * THE NAMED TRADE-OFF: a supplier whose name is genuinely absent from the page now falls through to
    review rather than matching. That is the safe direction — a document that needs a human, not a
    document filed under the wrong company — and it is pinned so nobody "fixes" it by loosening.
"""
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

import importlib                                          # noqa: E402
from extraction import template_matcher as tm             # noqa: E402

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


def _arm(on):
    """Re-import with the switch set, and ASSERT the arm took effect.

    Without that assertion this file lies to you. Writing it, I hit a red on the pin below and
    started documenting a "finding" about the type signal being unreliable — when in fact the module
    had not re-armed the way I assumed and the product was fine all along. A test whose setup can
    silently half-apply is worse than no test: it manufactures findings."""
    if on:
        os.environ['TEMPLATE_IDENTITY_ON_PAGE'] = '1'
    else:
        os.environ.pop('TEMPLATE_IDENTITY_ON_PAGE', None)
    mod = importlib.reload(tm)
    assert mod._IDENTITY_ON_PAGE_ON is bool(on),         f'the arm did not take effect: asked for {on}, module says {mod._IDENTITY_ON_PAGE_ON}'
    return mod


# The real fingerprint from the live database, and real page text from the corpus.
POISONED_FP = ["Bramblewood", "Joinery", "Ltd", "PURCHASE", "Unit", "Sawpit", "Lane",
               "Draymarket", "Tel", "VAT"]
QUILLSTONE = {'id': 12, 'name': 'Quillstone Print & Packaging', 'document_type_slug': 'purchase_order',
              'keyword_fingerprint': POISONED_FP, 'dominant_supplier': 'Quillstone Print & Packaging'}

OAKHAVEN_PAGE = """OE
Oakhaven Electrical Wholesale
19 Conduit Row - Ampfield, AM4 7GB - VAT Reg GB 660 1173 45
GOODS DELIVERY NOTE
Delivery Note No OED/26662
DELIVER TO
Bramblewood Joinery Ltd
Unit 4, Sawpit Lane
Draymarket, DM2 6QF
"""

QUILLSTONE_PAGE = """Bramblewood Joinery Ltd    PURCHASE ORDER
Unit 4, Sawpit Lane - Draymarket, DM2 6QF
Tel 01632 962130 VAT Reg No GB 512 8846 27
Purchase Order No    PO-91994
SUPPLIER    DELIVER TO
Quillstone Print & Packaging    Bramblewood Joinery Ltd
Pressworks, 51 Galley Street    Unit 4, Sawpit Lane
"""


@case
def test_the_defect_reproduces_when_off():
    """CONTROL. Without the guard, the Quillstone template claims an Oakhaven delivery note — a
    different company AND a different document type — on the strength of a fingerprint made of the
    recipient's address."""
    mod = _arm(False)
    m = mod.identify_template(None, OAKHAVEN_PAGE, [QUILLSTONE],
                              detected_slug=None, title_trusted=False)
    assert m and m['template']['id'] == 12, 'the defect must still reproduce with the guard off'
    assert m['method'] == 'keywords', m
    assert m['confidence'] >= 70, f"and it must be CONFIDENT about it: {m['confidence']}"


@case
def test_armed_refuses_a_document_that_never_names_the_company():
    mod = _arm(True)
    m = mod.identify_template(None, OAKHAVEN_PAGE, [QUILLSTONE],
                              detected_slug=None, title_trusted=False)
    assert m is None, f'Quillstone is nowhere on an Oakhaven page; expected no match, got {m}'


@case
def test_armed_keeps_the_template_on_its_own_document():
    """The whole point. The same template, the same fingerprint, on the document it belongs to —
    where 'Quillstone Print & Packaging' IS printed, under SUPPLIER."""
    mod = _arm(True)
    m = mod.identify_template(None, QUILLSTONE_PAGE, [QUILLSTONE],
                              detected_slug=None, title_trusted=False)
    assert m and m['template']['id'] == 12, f'the correct match must survive, got {m}'


# NOT PINNED, DELIBERATELY: whether the document's own DETECTED TYPE refuses this match on its own.
# I tried to pin it both ways and got both answers, because the type door's behaviour turns on
# details of the page text — with one line removed from the Oakhaven page it refuses, with the line
# present it does not. That is worth knowing and not worth asserting: a pin whose truth flips on a
# line of OCR text teaches a future reader something false. What matters for THIS guard is already
# pinned above — in the field these documents reached the keyword arm with NO detected type at all
# (`detected_slug=None`), and there the type door is not in the room.
#
# The wider lesson, recorded because it cost me two wrong pins: I twice started writing a "finding"
# about the type signal off the back of a red that was my own test's fault. `_arm` now asserts that
# the switch it just set actually took effect, so a half-applied setup fails loudly instead of
# quietly changing what the test means.

# ── the predicate itself ─────────────────────────────────────────────────────────────────────────
@case
def test_predicate_is_whole_word_not_substring():
    mod = _arm(True)
    assert mod.identity_present_on_page('Quillstone Print & Packaging',
                                        'from Quillstone Print and Packaging Ltd') is True
    assert mod.identity_present_on_page('Ace Ltd', 'Facelift Interiors Limited') is False, \
        'substring containment would match ACE inside FACELIFT'


@case
def test_predicate_ignores_generic_company_words():
    mod = _arm(True)
    assert mod.identity_present_on_page('Ltd', 'anything at all') is False, \
        'a name made only of generic words is unjudgeable, never present'


@case
def test_predicate_tolerates_a_partly_garbled_name():
    """A scan garbles a word; 60% of the distinctive tokens is enough. The alternative — demanding
    every token — would refuse legitimate matches on ordinary OCR noise, which is the failure
    direction this guard must not have."""
    mod = _arm(True)
    assert mod.identity_present_on_page('Meadowvale Dairy Wholesale',
                                        'Meadowvale Dairy Whol3sale, Low Lane') is True


@case
def test_predicate_fails_safe_on_nothing():
    mod = _arm(True)
    assert mod.identity_present_on_page('', 'text') is False
    assert mod.identity_present_on_page('Acme Tools', '') is False, \
        'no text is UNJUDGEABLE, and for a claim of identity that must read as absent'


@case
def test_one_predicate_shared_with_the_fill_path():
    """`engine._template_identity_corroborated` asks the same question of the FILL path. Two
    spellings of one predicate is how this codebase has been bitten before, so the engine delegates
    here rather than keeping its own copy."""
    mod = _arm(True)
    from extraction import engine
    for name, text in (('Quillstone Print & Packaging', QUILLSTONE_PAGE),
                       ('Quillstone Print & Packaging', OAKHAVEN_PAGE),
                       ('Oakhaven Electrical Wholesale', OAKHAVEN_PAGE)):
        assert engine._template_identity_corroborated(name, text) \
               == mod.identity_present_on_page(name, text), (name, text[:30])


def main():
    fails = 0
    for fn in CASES:
        try:
            fn()
            print(f"  OK  {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"  BAD {fn.__name__}: {e}")
    _arm(False)
    if fails:
        print(f"{fails} check(s) failed - TEMPLATE_IDENTITY_ON_PAGE regressed.")
        return 1
    print("All checks passed - a template claims only documents that name its company.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
