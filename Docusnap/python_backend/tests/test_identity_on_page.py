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
# `supplier_prints_name` is threaded onto every template payload by templates.js from that
# supplier's OWN confirmed documents. It is what carves out a wordmark supplier BY MEASUREMENT, and
# without it the guard abstains — so a fixture that omits it silently tests nothing.
QUILLSTONE = {'id': 12, 'name': 'Quillstone Print & Packaging', 'document_type_slug': 'purchase_order',
              'keyword_fingerprint': POISONED_FP, 'dominant_supplier': 'Quillstone Print & Packaging',
              'supplier_prints_name': {'supplier': 'Quillstone Print & Packaging',
                                       'ratio': 1.0, 'count': 1}}

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



# ── Oracle's conditions, each pinned on a case that is RED without the condition ─────────────────
@case
def test_identity_is_the_confirmed_supplier_NOT_the_cosmetic_template_name():
    """C1. My first version read `templates.name`. This codebase has ruled twice that the cosmetic
    name is never an identity — it is first-confirm luck and can be an OCR garble — and an admin
    RENAME would otherwise stop a template matching its own documents for ever, silently, while
    `rename()` documents in-code that it "can never affect extraction, identification"."""
    mod = _arm(True)
    renamed = dict(QUILLSTONE, name='Quillstone PO v2 (old)')
    m = mod.identify_template(None, QUILLSTONE_PAGE, [renamed],
                              detected_slug=None, title_trusted=False)
    assert m and m['template']['id'] == 12,         'a renamed template must still match its own documents; the name is not the identity'
    assert mod._template_identity(renamed) == 'Quillstone Print & Packaging'


@case
def test_an_auto_generated_template_name_cannot_pass_the_guard():
    """C1, the other direction. When no supplier resolves, templates.js names a template
    "<Type> Template". Reading that as an identity, {purchase, order} scores 2/3 on every purchase
    order ever printed — so the guard would have PASSED exactly the unresolved-supplier templates
    most likely to carry a poisoned fingerprint."""
    mod = _arm(True)
    anon = {'id': 99, 'name': 'Purchase Order Template', 'document_type_slug': 'purchase_order',
            'keyword_fingerprint': POISONED_FP}
    assert mod._template_identity(anon) == '', 'an auto-generated name is not an identity'
    m = mod.identify_template(None, OAKHAVEN_PAGE, [anon], detected_slug=None, title_trusted=False)
    assert m is not None, ('with no identity to test, the guard must ABSTAIN rather than guess — '
                           'this template has no frozen supplier to stamp, so the wrong-COMPANY '
                           'misfile cannot occur through it')


@case
def test_the_right_template_is_still_SELECTED_not_merely_the_wrong_one_refused():
    """C2, and this is the condition that mattered most. Two templates built from the buyer's OWN
    purchase orders share the same poisoned fingerprint, so both score 1.00 on every PO the buyer
    issues and the winner is decided by LIST ORDER. Vetoing the WINNER turns "wrong template" into
    "NO template" — the customer's experience is "teaching a second supplier broke the first one".
    Filtering the candidate POOL selects the right one instead."""
    mod = _arm(True)
    other = {'id': 13, 'name': 'Harrowgate Timber Supplies', 'document_type_slug': 'purchase_order',
             'keyword_fingerprint': POISONED_FP, 'dominant_supplier': 'Harrowgate Timber Supplies',
             'supplier_prints_name': {'supplier': 'Harrowgate Timber Supplies',
                                      'ratio': 1.0, 'count': 1}}
    # `other` is FIRST in the list, so on list order alone it wins the tie.
    m = mod.identify_template(None, QUILLSTONE_PAGE, [other, QUILLSTONE],
                              detected_slug=None, title_trusted=False)
    assert m and m['template']['id'] == 12,         f'the template whose company IS on the page must be selected, got {m and m["template"]["id"]}'


@case
def test_a_supplier_that_does_not_print_its_name_is_carved_out_by_MEASUREMENT():
    """C3. A pure-wordmark letterhead — a graphic with no company name in text anywhere — would
    otherwise be refused by every text arm for ever, and the logo arm cannot save it: that arm
    accepts only a clean lock (distance <= 6) while this codebase's own measurement records
    same-supplier phash drift reaching 36 on scans. The ratio answers "does THIS supplier print its
    name?" from that supplier's own confirmed documents."""
    mod = _arm(True)
    wordmark = dict(QUILLSTONE, id=14, name='Wordmark Co', dominant_supplier='Wordmark Co',
                    supplier_prints_name={'supplier': 'Wordmark Co', 'ratio': 0.0, 'count': 4})
    m = mod.identify_template(None, OAKHAVEN_PAGE, [wordmark], detected_slug=None, title_trusted=False)
    assert m is not None, 'a supplier that never prints its name must not be refused for not printing it'
    # ...and the same template with a high print ratio IS refused.
    prints = dict(wordmark, supplier_prints_name={'supplier': 'Wordmark Co', 'ratio': 1.0, 'count': 4})
    assert mod.identify_template(None, OAKHAVEN_PAGE, [prints],
                                 detected_slug=None, title_trusted=False) is None


@case
def test_no_three_confirm_floor_because_that_floor_is_what_slept_through_the_defect():
    """C3's sharp edge, pinned deliberately. The sibling guard `nameBearingButAbsent` requires THREE
    confirmed documents. That is the exact gate that slept through this defect: a template acquires
    full authority at n=1 and stamps its issuer at 95 on document #1. Requiring three here would
    re-open the hole. Anybody "restoring parity" with the JS twin turns this red."""
    mod = _arm(True)
    one_confirm = dict(QUILLSTONE,
                       supplier_prints_name={'supplier': 'Quillstone Print & Packaging',
                                             'ratio': 1.0, 'count': 1})
    assert mod.identify_template(None, OAKHAVEN_PAGE, [one_confirm],
                                 detected_slug=None, title_trusted=False) is None,         'one confirmed document is enough evidence to refuse; a 3-confirm floor re-opens the defect'


# ── YOUNG-IDENTITY CORROBORATION (2026-08-11, Chris r2 finding 1) ───────────────────────────────
# The abstain (count<1 or ratio<floor) used to ADMIT unconditionally. A garbled teach is
# indistinguishable from a wordmark supplier at n<=1 — Chris's '@a eens Ee' template (frozen
# supplier, ZERO corroborating confirms at claim time) rode the abstain onto 20 Oakhaven delivery
# notes at 95 via the KEYWORD arm, and the VAT number crossed over with it. Verified by trace:
# "Template matched: @a eens Ee (80% via keywords)" on the very page where this guard refused the
# two healthy templates. While count < TEMPLATE_IDENTITY_YOUNG_N (default 3) and the template
# carries a frozen supplier to stamp, the abstain now falls back to the presence test.

GARBLE = {'id': 15, 'name': '@a eens Ee', 'document_type_slug': 'purchase_order',
          'keyword_fingerprint': POISONED_FP,
          'fields': [{'field_key': 'supplier_name', 'is_variable': 0, 'fixed_value': '@a eens Ee'}],
          'supplier_prints_name': {'supplier': '@a eens Ee', 'ratio': 0.0, 'count': 0}}


@case
def test_the_leak_pin_a_young_garble_identity_may_not_ride_the_abstain():
    """THE LEAK. Frozen identity '@a eens Ee', zero corroborating confirms, a page that names
    Oakhaven and not the garble -> refused. Before 2026-08-11 this ADMITTED (the abstain), which is
    how one bad teach filed 20 documents into a folder that isn't a company."""
    mod = _arm(True)
    m = mod.identify_template(None, OAKHAVEN_PAGE, [GARBLE], detected_slug=None, title_trusted=False)
    assert m is None, f"'eens' is nowhere on an Oakhaven page; a young identity must corroborate, got {m}"
    # count 1 (the taught doc confirmed) is still young — the leak state after File All Ready.
    one = dict(GARBLE, supplier_prints_name={'supplier': '@a eens Ee', 'ratio': 0.0, 'count': 1})
    assert mod.identify_template(None, OAKHAVEN_PAGE, [one],
                                 detected_slug=None, title_trusted=False) is None


@case
def test_young_n_zero_restores_the_old_abstain():
    """The kill switch, proven live in BOTH directions — TEMPLATE_IDENTITY_YOUNG_N=0 must reproduce
    the old admit-through-abstain exactly (that is what 'kill switch' means here)."""
    os.environ['TEMPLATE_IDENTITY_YOUNG_N'] = '0'
    try:
        mod = _arm(True)
        assert mod._IDENTITY_YOUNG_N == 0
        m = mod.identify_template(None, OAKHAVEN_PAGE, [GARBLE],
                                  detected_slug=None, title_trusted=False)
        assert m is not None, 'YOUNG_N=0 must restore the unconditional abstain (the old behaviour)'
    finally:
        os.environ.pop('TEMPLATE_IDENTITY_YOUNG_N', None)
        _arm(True)


@case
def test_the_named_trade_off_a_YOUNG_genuine_wordmark_routes_to_review():
    """ACCEPTED COST, pinned so nobody 'fixes' it back into the leak: a genuine wordmark supplier
    (name truly absent from its pages) is refused during its first N-1 confirms and its documents
    route to review. Temporary, fail-toward-review. At count >= N the measured carve-out takes over
    (test_a_supplier_that_does_not_print_its_name_is_carved_out_by_MEASUREMENT, count=4)."""
    mod = _arm(True)
    young_wordmark = dict(QUILLSTONE, id=16, name='Wordmark Co', dominant_supplier='Wordmark Co',
                          fields=[{'field_key': 'supplier_name', 'is_variable': 0,
                                   'fixed_value': 'Wordmark Co'}],
                          supplier_prints_name={'supplier': 'Wordmark Co', 'ratio': 0.0, 'count': 1})
    m = mod.identify_template(None, OAKHAVEN_PAGE, [young_wordmark],
                              detected_slug=None, title_trusted=False)
    assert m is None, 'a YOUNG name-less identity may not claim by fingerprint alone — accepted cost'


@case
def test_a_young_supplier_whose_name_IS_printed_still_matches():
    """The Ironclad case — the 19/19 clean teach must survive. Young history (count 1, unjudgeable
    ratio), but the page NAMES the company -> presence corroborates -> admitted."""
    mod = _arm(True)
    young_named = {'id': 17, 'name': 'Oakhaven', 'document_type_slug': 'delivery_note',
                   'keyword_fingerprint': ['Oakhaven', 'Electrical', 'Wholesale', 'Conduit'],
                   'fields': [{'field_key': 'supplier_name', 'is_variable': 0,
                               'fixed_value': 'Oakhaven Electrical Wholesale'}],
                   'supplier_prints_name': {'supplier': 'Oakhaven Electrical Wholesale',
                                            'ratio': 0.0, 'count': 1}}
    m = mod.identify_template(None, OAKHAVEN_PAGE, [young_named],
                              detected_slug=None, title_trusted=False)
    assert m and m['template']['id'] == 17, f'a young template whose company IS on the page must match, got {m}'


@case
def test_oracle_c2_joint_pin_young_garble_refused_AND_correct_sibling_selected():
    """ORACLE C2 (joint, same run): refusing the garble must not merely empty the pool — the
    healthy template whose company IS on the page must still be SELECTED. A refusal-only suite
    could not catch a future dev converting the pool filter back into a winner veto."""
    mod = _arm(True)
    oakhaven = {'id': 17, 'name': 'Oakhaven', 'document_type_slug': 'delivery_note',
                'keyword_fingerprint': ['Oakhaven', 'Electrical', 'Wholesale', 'Conduit'],
                'fields': [{'field_key': 'supplier_name', 'is_variable': 0,
                            'fixed_value': 'Oakhaven Electrical Wholesale'}],
                'supplier_prints_name': {'supplier': 'Oakhaven Electrical Wholesale',
                                         'ratio': 0.0, 'count': 1}}
    # GARBLE first in the list so list order alone would hand it the tie.
    m = mod.identify_template(None, OAKHAVEN_PAGE, [GARBLE, oakhaven],
                              detected_slug=None, title_trusted=False)
    assert m and m['template']['id'] == 17, \
        f'the garble must be filtered from the POOL and the named sibling SELECTED, got {m}'


@case
def test_oracle_c1a_accepted_residual_name_drift_keeps_a_wordmark_young():
    """ORACLE C1(a), ACCEPTED RESIDUAL — do not 'fix' this by re-keying youth on the template's
    bound-document count: in the reproducing sandbox the garble template carries 21 confirmed docs
    (the leak was File-All-Ready'd), so bound-doc youth would read the POISON as mature and re-open
    the hole. Cost pinned here: a genuine wordmark supplier whose confirms are typed differently
    from the frozen string ('Wordmark Co Ltd' vs frozen 'Wordmark Co') keeps count(frozen)=0 and
    stays young — refused, fail-toward-review, until a confirm matches the frozen value."""
    mod = _arm(True)
    drifted = dict(QUILLSTONE, id=19, name='Wordmark Co', dominant_supplier='Wordmark Co Ltd',
                   fields=[{'field_key': 'supplier_name', 'is_variable': 0,
                            'fixed_value': 'Wordmark Co'}],
                   # frozen-string count stays 0 because every confirm says 'Wordmark Co Ltd'
                   supplier_prints_name={'supplier': 'Wordmark Co', 'ratio': 0.0, 'count': 0})
    m = mod.identify_template(None, OAKHAVEN_PAGE, [drifted],
                              detected_slug=None, title_trusted=False)
    assert m is None, 'the drift-kept-young wordmark is refused — the ACCEPTED residual'


@case
def test_oracle_c1b_accepted_residual_split_brain_matches_on_dominant_stamps_frozen():
    """ORACLE C1(b), ACCEPTED RESIDUAL, documented not celebrated: frozen value still a garble,
    dominant corrected to the real name. `_template_identity` returns the DOMINANT first, so the
    presence test passes on pages naming the real supplier and the template MATCHES — while
    template_fixed will stamp the FROZEN garble. The garble class is fully closed only while
    dominant == frozen; the stamped value's own rails (branding guard, name-presence veto) are the
    defence on that side. This pin records the behaviour so the handover cannot overclaim."""
    mod = _arm(True)
    split = {'id': 20, 'name': 'x', 'document_type_slug': 'delivery_note',
             'keyword_fingerprint': ['Oakhaven', 'Electrical', 'Wholesale', 'Conduit'],
             'dominant_supplier': 'Oakhaven Electrical Wholesale',
             'fields': [{'field_key': 'supplier_name', 'is_variable': 0,
                         'fixed_value': '@a eens Ee'}],
             'supplier_prints_name': {'supplier': '@a eens Ee', 'ratio': 0.0, 'count': 0}}
    m = mod.identify_template(None, OAKHAVEN_PAGE, [split],
                              detected_slug=None, title_trusted=False)
    assert m is not None and m['template']['id'] == 20, \
        'split-brain: matches via the corrected dominant name — the residual this pin documents'


@case
def test_scope_a_variable_supplier_template_is_untouched_by_the_young_rule():
    """gary's scope note: a template with NO frozen supplier does not stamp template_fixed identity,
    so the young fallback does not apply to it — its admission behaviour is exactly the old abstain."""
    mod = _arm(True)
    variable = {'id': 18, 'name': 'Var', 'document_type_slug': 'purchase_order',
                'keyword_fingerprint': POISONED_FP, 'dominant_supplier': 'Someone Ltd',
                'supplier_prints_name': {'supplier': 'Someone Ltd', 'ratio': 0.0, 'count': 0}}
    m = mod.identify_template(None, OAKHAVEN_PAGE, [variable],
                              detected_slug=None, title_trusted=False)
    assert m is not None, 'no frozen supplier -> out of the young rule\'s scope -> old behaviour'


@case
def test_the_remembered_binding_is_subject_to_the_same_test():
    """THE STICKY BINDING. Reprocess honours the template a document is already bound to instead of
    re-identifying — deliberately, because that is what makes a teach stick. The cost, found while
    gating this fix: a WRONG binding is equally permanent, and "Reprocess all in queue" — the button
    anyone reaches for when they notice something is wrong — could not heal the 18 misfiled
    documents. The engine's own comment above that fallback already warned it "re-imposes the poison".

    A WIRING pin, and honest about being one: the behavioural proof is the corpus arm (on the
    reprocess path, wrong senders 18 -> 1, every other lane unchanged), which needs a full engine run.
    What this asserts is that the fallback consults the predicate at all — the thing a refactor would
    silently drop."""
    import inspect
    from extraction import engine
    src = inspect.getsource(engine.ExtractionEngine.extract)
    # Bound by the block's own end (`if match:`) rather than a character count — a fixed window
    # silently shrank past the trace call as soon as the explaining comment grew, which is the same
    # class of self-deceiving test as a pin that reads prose instead of code.
    i = src.index('known_template_id is not None or pinned_template_id is not None')
    window = src[i:src.index('if match:', i)]
    assert '_identity_refuses' in window,         'the remembered binding is honoured without testing whether the page names that company'
    assert 'sticky_binding_declined' in window, 'and a declined binding must be traceable'


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
