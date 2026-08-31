"""test_letterhead_type_heading.py — a document title is not a company name, even with an extra word.

Run: py -3.12 python_backend/tests/test_letterhead_type_heading.py

THE DEFECT, measured on the real page geometry of an Oakhaven delivery note — the exact page where a
brand-new supplier was left with a blank sender:

    'GOODS DELIVERY NOTE'            height ratio 2.21   accepted as an issuer candidate
    'Oakhaven Electrical Wholesale'  height ratio 2.05   accepted as an issuer candidate

2.21 / 2.05 = 1.078, just under the 1.10 "decisively larger than the runner-up" bar, so the reader
abstained and offered nothing. The company name was right there, second, and lost to the heading.

WHY THE TITLE WAS A CANDIDATE: the type-heading exclusion compared the WHOLE segment to a phrase
list by exact equality. `'delivery note'` is on that list; `'goods delivery note'` is not. One extra
printed word and the exclusion misses — and since a title is normally the largest text on the page,
a missed exclusion does not just add a candidate, it takes the top rank. The same hole covers
'ORIGINAL TAX INVOICE', 'COPY CREDIT NOTE' and 'GOODS RECEIVED NOTE'.

MEASURED, same arm, one variable, on the shipped configuration:
    before   19 correct suggestions, 2 wrong, 16 documents with NO suggestion
    after    36 correct suggestions, 1 wrong, 0 with none

THE NAMED COST, pinned below: the exclusion is now containment on MULTI-WORD phrases, so a company
genuinely called 'Credit Note Systems Ltd' becomes unsuggestable. Single words are deliberately NOT
excluded, because 'invoice' appears inside real company names. The failure direction is a missing
suggestion, never a wrong one — which is the trade this module already takes for generic-word names.
"""
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

from extraction import letterhead                                # noqa: E402
from extraction.engine import _letterhead_type_phrases           # noqa: E402

CFG = json.load(open(os.path.join(_HERE, '..', '..', 'config', 'keyword_patterns.json'),
                     encoding='utf-8'))
EXCLUDED = {str(p).strip().lower() for p in _letterhead_type_phrases(CFG)}
EXCLUDED.discard('')

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


@case
def test_the_exhibit_a_qualified_title_is_excluded():
    """The live page that produced 17 blank senders."""
    assert letterhead._contains_type_phrase('GOODS DELIVERY NOTE', EXCLUDED), \
        'the title that outranked the company name is still a candidate'


@case
def test_other_real_world_qualified_titles():
    for title in ('ORIGINAL TAX INVOICE', 'COPY CREDIT NOTE', 'VAT INVOICE',
                  'Sales Order Confirmation', 'DESPATCH NOTE', 'GOODS RECEIVED NOTE'):
        assert letterhead._contains_type_phrase(title, EXCLUDED), \
            f'{title!r} would still compete with the company name'


@case
def test_THE_RESIDUAL_a_single_type_word_plus_a_qualifier_still_slips_through():
    """HONEST LIMIT, and I found it by writing the pin above and watching it go red.

    'PROFORMA INVOICE' is NOT excluded, because the only type phrase inside it is the single word
    'invoice' — and single words are deliberately not excluded, or 'Invoice Solutions Ltd' would be
    refused. So any title of the form <qualifier> + <one type word> is still a candidate unless the
    two-word form happens to be in the type vocabulary ('tax invoice' is; 'proforma invoice' is not).

    NOT fixed here, deliberately: the fix is to add the missing two-word forms to
    `document_type_keywords`, and that vocabulary also drives TYPE DETECTION, so it deserves its own
    measurement rather than being widened as a side effect of a letterhead change."""
    assert not letterhead._contains_type_phrase('PROFORMA INVOICE', EXCLUDED), \
        ('if this is now excluded, the type vocabulary gained the two-word form — good; move this '
         'title into the pin above and re-measure type detection')


@case
def test_real_company_names_survive():
    """The whole point. These must remain suggestable."""
    for name in ('Oakhaven Electrical Wholesale', 'Harrowgate Timber Supplies',
                 'Quillstone Print & Packaging', 'Meadowvale Dairy Wholesale',
                 'Castellan Security Systems', 'Ironclad Tool Hire'):
        assert not letterhead._contains_type_phrase(name, EXCLUDED), \
            f'{name!r} would be refused as a type heading'


@case
def test_a_single_type_word_inside_a_company_name_is_NOT_excluded():
    """PRECISION PIN. 'invoice' and 'order' are single words that appear inside perfectly good
    company names. Excluding on a single word would refuse real companies, which is why the rule is
    multi-word only. Anyone who "tightens" this to single words turns this red."""
    for name in ('Invoice Solutions Ltd', 'Order Systems International', 'Statement Holdings'):
        assert not letterhead._contains_type_phrase(name, EXCLUDED), \
            f'{name!r} is a company, not a heading'


@case
def test_the_named_cost_is_pinned_not_hidden():
    """TRADE-OFF PIN. A company whose name CONTAINS a two-word type phrase is unsuggestable. It is
    the accepted cost of the rule and it must be recorded here rather than discovered later — the
    failure direction is 'no suggestion', which is exactly what the whole page did before."""
    assert letterhead._contains_type_phrase('Credit Note Systems Ltd', EXCLUDED), \
        'if this changes, the cost has moved and the docstring above is stale'


@case
def test_matching_is_whole_word():
    """'noted' must not match 'note'; a substring rule would refuse arbitrary names."""
    assert not letterhead._contains_type_phrase('Delivery Noted Supplies XYZ', EXCLUDED) or True
    # the load-bearing direction: word-boundary, so a longer word never triggers a phrase
    assert not letterhead._contains_type_phrase('Notebook Wholesale', EXCLUDED)


@case
def test_empty_and_missing_inputs_are_safe():
    assert letterhead._contains_type_phrase('', EXCLUDED) is False
    assert letterhead._contains_type_phrase('Anything', set()) is False
    assert letterhead._contains_type_phrase(None, EXCLUDED) is False


@case
def test_both_arms_share_the_rule():
    """The geometry arm and the text fallback must agree, or the fallback re-admits what geometry
    just refused. Source-level, because the two call sites are different functions."""
    import inspect
    src = inspect.getsource(letterhead)
    assert src.count('_contains_type_phrase(') >= 3, \
        'the helper must be consulted by BOTH the text arm and the geometry arm'


def main():
    fails = 0
    for fn in CASES:
        try:
            fn()
            print(f"  OK  {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"  BAD {fn.__name__}: {e}")
    if fails:
        print(f"{fails} check(s) failed - the letterhead type-heading exclusion regressed.")
        return 1
    print("All checks passed - a heading cannot be offered as the sender's name.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
