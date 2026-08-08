"""test_teach_side_gates.py — pins for the 2026-08-08 teach-side slice.

Run: py -3.12 python_backend/tests/test_teach_side_gates.py

Covers three independently kill-switched fixes, all DEFAULT OFF, found by scoring a 10-issuer x
20-document teach test against corpus ground truth:

  STAGE05_REF_CODE_GATE            a taught box that read its own CAPTION ('Ref') committed it as
                                   the reference. Stage 1 has refused codeless references since
                                   2026-08-07 but that gate lives inside keyword.extract_fields, so
                                   every Stage-0.5 rung was unprotected.
  KEYWORD_GENERIC_CAPTION_EXCLUSIVE  one printed code captured into THREE fields at once, because
                                   every ref-role field is seeded with the same generic caption bank
                                   ('Ref'/'Reference'/...). Measured: 'VXS79871' committed to
                                   sales_order_number (its own label), account_no and vat_no.
  TYPE_TITLE_OWNER_PRECEDENCE      type election is a BUCKET SUM, so an install-created type owning
                                   one phrase loses to a built-in owning a whole caption vocabulary
                                   — even when the page's own title IS the install type's name. A
                                   template taught against such a type binds to a slug its own
                                   siblings can never detect as: measured 20/20 and 15/20 documents
                                   matching NO template, issuer 0%.

THE ANTI-LOOSEN CONTRACT:
  • OFF is byte-identical for all three. Every ON test has an OFF twin asserting today's behaviour,
    so "default OFF is safe" is asserted rather than assumed.
  • The Stage-0.5 ref gate is DELIBERATELY WEAKER than Stage 1's (one digit, not two). Stage 1
    judges a candidate invented from a caption hunt; Stage 0.5 judges a value the operator pointed
    at. Do not "unify" them — the pin below asserts they differ.
  • Type promotion requires a TOP-BAND standalone heading and EXACTLY ONE owner. The top-band
    condition is what keeps the recomputed confidence >= 79, which keeps `title_trusted` True
    downstream; relaxing it silently disarms the whole heading-authority net.
"""
import os, re, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

import json                                                   # noqa: E402
from extraction import keyword as kw                          # noqa: E402
from extraction import template_mapper as tm                  # noqa: E402

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


def _flag(name, on):
    if on:
        os.environ[name] = '1'
    else:
        os.environ.pop(name, None)


def _reload_mapper():
    """template_mapper reads its switch at import time (house style: the flag zone above the first
    def), so an arm must re-import it."""
    import importlib
    return importlib.reload(tm)


PATTERNS = json.load(open(os.path.join(_HERE, '..', '..', 'config', 'keyword_patterns.json'),
                          encoding='utf-8'))
VALIDATION = PATTERNS.get('validation_patterns') or {}


# ── STAGE05_REF_CODE_GATE ────────────────────────────────────────────────────
@case
def test_refgate_off_commits_the_caption():
    """OFF: today's behaviour — the caption 'Ref' passes the Stage-0.5 gate and commits."""
    _flag('STAGE05_REF_CODE_GATE', False)
    m = _reload_mapper()
    val, _, _ = m._gate_value('Ref', 'alphanumeric', 'sales_order_number', VALIDATION, {})
    assert val == 'Ref', f'OFF arm must be unchanged, got {val!r}'


@case
def test_refgate_on_refuses_the_caption():
    """ON: refused, so the rung falls through instead of committing a caption as the reference."""
    _flag('STAGE05_REF_CODE_GATE', True)
    m = _reload_mapper()
    for caption in ('Ref', 'Reference', 'Account', 'Delivery', 'Your PO'):
        val, _, _ = m._gate_value(caption, 'alphanumeric', 'sales_order_number', VALIDATION, {})
        assert val is None, f'{caption!r} should be refused, got {val!r}'


@case
def test_refgate_on_keeps_every_real_code():
    """ON, RECALL: anything bearing a digit is still committed. A one-digit code is deliberately
    enough — the measured recall floor is that ZERO of 713 confirmed ref values on the reference
    install fail even the stricter two-digit form."""
    _flag('STAGE05_REF_CODE_GATE', True)
    m = _reload_mapper()
    for code in ('HTS-SO-12013', 'PO-7', 'INV/2026/001', '123'):
        val, _, _ = m._gate_value(code, 'alphanumeric', 'sales_order_number', VALIDATION, {})
        assert val == code, f'{code!r} must survive, got {val!r}'
    # NOT this gate's doing: a 2-character value fails the PRE-EXISTING alphanumeric credibility
    # pattern ([A-Za-z0-9][A-Za-z0-9\-/.]{2,20}, i.e. 3 chars minimum) with the flag off as well.
    # Asserted in both arms so a future reader cannot mistake it for a codeless-ref refusal.
    _flag('STAGE05_REF_CODE_GATE', False)
    off, _, _ = _reload_mapper()._gate_value('12', 'alphanumeric', 'sales_order_number', VALIDATION, {})
    _flag('STAGE05_REF_CODE_GATE', True)
    on, _, _ = _reload_mapper()._gate_value('12', 'alphanumeric', 'sales_order_number', VALIDATION, {})
    assert off is None and on is None, f'2-char refusal must be flag-independent (off={off!r} on={on!r})'


@case
def test_refgate_on_leaves_non_ref_fields_alone():
    """ON: arming is the INTERSECTION of 'typed as a code' and 'the key is a reference role'. A
    free-text field that happens to hold a digit-free value is untouched."""
    _flag('STAGE05_REF_CODE_GATE', True)
    m = _reload_mapper()
    val, _, _ = m._gate_value('Bramblewood Joinery Ltd', None, 'customer_name', VALIDATION, {})
    assert val == 'Bramblewood Joinery Ltd', f'free-text must be untouched, got {val!r}'


@case
def test_the_two_ref_tiers_are_deliberately_different():
    """PIN: Stage 1 requires TWO digits (\\d\\S*\\d) because it judges a candidate the caption hunt
    invented; Stage 0.5 requires ONE because it judges a value the operator physically pointed at.
    A future dev must not 'unify' them — this asserts the asymmetry on a value that separates them.
    """
    assert kw.ref_value_is_codeless('PO-7') is False, 'Stage 0.5 tier must accept one digit'
    assert re.search(r'\d\S*\d', 'PO-7') is None, 'Stage 1 tier must reject one digit'


# ── KEYWORD_GENERIC_CAPTION_EXCLUSIVE ────────────────────────────────────────
def _steal_fixture():
    """The measured Veltrix shape: one code, three fields, two of them via the generic bank."""
    return {
        'sales_order_number': {'value': 'VXS79871', 'confidence': 88, 'label': 'Order No'},
        'account_no':         {'value': 'VXS79871', 'confidence': 85, 'label': 'Ref'},
        'vat_no':             {'value': 'VXS79871', 'confidence': 85, 'label': 'Reference'},
    }


@case
def test_exclusive_off_keeps_all_three():
    _flag('KEYWORD_GENERIC_CAPTION_EXCLUSIVE', False)
    out = kw._drop_generic_caption_steals(_steal_fixture())
    assert set(out) == {'sales_order_number', 'account_no', 'vat_no'}, 'OFF must be unchanged'


@case
def test_exclusive_on_drops_only_the_generic_captures():
    _flag('KEYWORD_GENERIC_CAPTION_EXCLUSIVE', True)
    out = kw._drop_generic_caption_steals(_steal_fixture())
    assert set(out) == {'sales_order_number'}, f'expected only the own-label owner, got {sorted(out)}'


@case
def test_exclusive_on_is_order_independent():
    """The winner is chosen by WHICH CAPTION MATCHED, never by dict order. Both permutations."""
    _flag('KEYWORD_GENERIC_CAPTION_EXCLUSIVE', True)
    f = _steal_fixture()
    rev = {k: f[k] for k in reversed(list(f))}
    assert set(kw._drop_generic_caption_steals(rev)) == {'sales_order_number'}


@case
def test_exclusive_on_leaves_an_all_generic_tie_alone():
    """PRECISION: with no specific owner there is no evidence to rank on, so nothing is dropped —
    it can only ever remove a duplicate, never re-assign one."""
    _flag('KEYWORD_GENERIC_CAPTION_EXCLUSIVE', True)
    both = {'account_no': {'value': 'X-1', 'label': 'Ref'},
            'vat_no':     {'value': 'X-1', 'label': 'Reference'}}
    assert set(kw._drop_generic_caption_steals(both)) == {'account_no', 'vat_no'}


@case
def test_exclusive_on_does_not_dedupe_legitimately_equal_fields():
    """Two dates that genuinely coincide are NOT ref-role generic captures and must both survive."""
    _flag('KEYWORD_GENERIC_CAPTION_EXCLUSIVE', True)
    dates = {'invoice_date': {'value': '01-02-2026', 'label': 'Invoice Date'},
             'order_date':   {'value': '01-02-2026', 'label': 'Date'}}
    assert set(kw._drop_generic_caption_steals(dates)) == {'invoice_date', 'order_date'}


# ── TYPE_TITLE_OWNER_PRECEDENCE ──────────────────────────────────────────────
ORDER_CONF_PAGE = "\n".join([
    'Veltrix Automotive Parts',
    'Unit 9, Parkway',
    '',
    'ORDER CONFIRMATION',
    '',
    'Order No   VXS79871',
    'Your Order  PO-1234',
    'Order Date  16-04-2026',
])
INSTALLED = ['Invoice', 'Sales Order', 'Purchase Order', 'Order Confirmation']


@case
def test_typeowner_off_elects_the_builtin():
    """OFF: today's behaviour, and the defect itself — the built-in wins on bucket sum even though
    the page's own title is the install type's name."""
    _flag('TYPE_TITLE_OWNER_PRECEDENCE', False)
    r = kw.detect_document_type(ORDER_CONF_PAGE, PATTERNS, known_types=INSTALLED)
    assert r and r['type'] == 'Sales Order', f'OFF arm changed: {r and r["type"]!r}'


@case
def test_typeowner_on_promotes_the_title_owner():
    _flag('TYPE_TITLE_OWNER_PRECEDENCE', True)
    r = kw.detect_document_type(ORDER_CONF_PAGE, PATTERNS, known_types=INSTALLED)
    assert r and r['type'] == 'Order Confirmation', f'got {r and r["type"]!r}'
    assert r['confidence'] >= 70, f"confidence {r['confidence']} would disarm title_trusted"


@case
def test_typeowner_on_pins_the_inversion_as_intended():
    """THE ACCEPTED TRADE-OFF, pinned: the built-in still scores HIGHER on the bucket sum and is
    still overruled. If someone 'fixes' this by reverting to the sum, this fails."""
    _flag('TYPE_TITLE_OWNER_PRECEDENCE', True)
    r = kw.detect_document_type(ORDER_CONF_PAGE, PATTERNS, known_types=INSTALLED)
    scores = r['all_scores']
    assert scores.get('Sales Order', 0) > scores.get('Order Confirmation', 0), \
        'fixture no longer separates the two — it must, or the pin proves nothing'
    assert r['type'] == 'Order Confirmation'


@case
def test_typeowner_on_never_inverts_a_correct_answer():
    _flag('TYPE_TITLE_OWNER_PRECEDENCE', True)
    page = ORDER_CONF_PAGE.replace('ORDER CONFIRMATION', 'SALES ORDER')
    r = kw.detect_document_type(page, PATTERNS, known_types=INSTALLED)
    assert r and r['type'] == 'Sales Order', f'got {r and r["type"]!r}'


@case
def test_typeowner_on_needs_the_type_installed():
    """Promotion requires an INSTALLED owner — a phrase alone is not enough."""
    _flag('TYPE_TITLE_OWNER_PRECEDENCE', True)
    r = kw.detect_document_type(ORDER_CONF_PAGE, PATTERNS,
                                known_types=['Invoice', 'Sales Order', 'Purchase Order'])
    assert r and r['type'] == 'Sales Order', f'got {r and r["type"]!r}'


@case
def test_typeowner_on_declines_a_body_mention():
    """A name mentioned in running prose is not an owner — only a standalone heading is."""
    _flag('TYPE_TITLE_OWNER_PRECEDENCE', True)
    page = ORDER_CONF_PAGE.replace('ORDER CONFIRMATION',
                                   'Please see our order confirmation dated 4 April for details')
    r = kw.detect_document_type(page, PATTERNS, known_types=INSTALLED)
    assert r and r['type'] == 'Sales Order', f'got {r and r["type"]!r}'


@case
def test_typeowner_on_declines_a_deep_page_heading():
    """PINS THE CONFIDENCE SEAM. Promotion is top-band only: a deep heading would recompute a low
    confidence, and below 70 `title_trusted` goes False downstream and disarms the type refuse and
    the ambiguity guard together. Do not relax the band."""
    _flag('TYPE_TITLE_OWNER_PRECEDENCE', True)
    filler = "\n".join(f'line {i} of padding text' for i in range(60))
    page = filler + "\n" + ORDER_CONF_PAGE
    r = kw.detect_document_type(page, PATTERNS, known_types=INSTALLED)
    assert r and r['type'] == 'Sales Order', f'deep heading must not promote, got {r and r["type"]!r}'


if __name__ == '__main__':
    failed = 0
    for fn in CASES:
        try:
            fn()
            print(f'  PASS  {fn.__name__}')
        except AssertionError as e:
            failed += 1
            print(f'  FAIL  {fn.__name__}: {e}')
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f'  ERROR {fn.__name__}: {type(e).__name__}: {e}')
        finally:
            for f in ('STAGE05_REF_CODE_GATE', 'KEYWORD_GENERIC_CAPTION_EXCLUSIVE',
                      'TYPE_TITLE_OWNER_PRECEDENCE'):
                os.environ.pop(f, None)
    _reload_mapper()
    print(f'\n{len(CASES) - failed}/{len(CASES)} passed')
    sys.exit(1 if failed else 0)
