"""test_currency_snap_drift_row.py — pins for the 2026-08-09 money slice.

Run: py -3.12 python_backend/tests/test_currency_snap_drift_row.py

Two independently kill-switched fixes, both DEFAULT OFF, found by scoring the 140-document teach
run's totals lane against corpus ground truth and then tracing the losers through the real
extractor:

  TEMPLATE_CURRENCY_EDGE_GROW   money is the one field type whose taught box is sized to a SAMPLE
                                VALUE and is RIGHT-ALIGNED, so a longer value overflows LEFT and the
                                box reads '0,603.44' where the page prints '£10,603.44'. Currency was
                                absent from `_SNAP_VAL_TYPES`, which scopes BOTH the absolute-rung
                                edge guard AND the derived-rung word snap. The live read comes from
                                the DERIVED rung, so the snap is the repair that matters (the flag's
                                first version admitted currency to the edge guard alone and measured
                                inert — that correction is why the snap leg exists).
  TEMPLATE_DRIFT_ROW_PITCH      `_label_drifted` floors its VERTICAL tolerance at _DRIFT_FLOOR=0.02,
                                worth ~1.5 text rows, so a label found ONE ROW lower is called "not
                                drifted" and the stationary box keeps the neighbouring row's value.
                                On money that value is TYPE-VALID, so nothing downstream catches it:
                                19 of 23 wrong totals were EXACTLY the truth / 6 — the arithmetic
                                fingerprint of reading the 20% VAT row instead of the total row.
                                ARMED ONLY FOR A LABEL THAT ACTUALLY MATCHED — measured, not assumed:
                                a blanket tolerance drop regressed 14 non-money fields in a second
                                taught state, because the 0.02 floor was ALSO shielding fuzzy label
                                mis-matches. Traced: needle 'Credit Ref' matched 'Credit Date' one
                                row below (they share 'Credit'), and believing that mis-locate seated
                                the credit-note number on the date row. Every heal has
                                matched_text == anchor_text; every regression is a fuzzy neighbour.

THE ANTI-LOOSEN CONTRACT:
  • OFF is byte-identical for both. Every ON test has an OFF twin asserting today's behaviour.
  • The money snap leg is a GEOMETRIC proof, not a shape guess: the snapped union's RIGHT edge must
    coincide with the taught box's right edge within one glyph. Both directions are load-bearing —
    a union reaching right is the next column, and a union sitting left is `cluster_value_words`
    having picked the run nearest `expect_x` rather than the run under the box. Do not relax either
    side into a one-sided "must not extend right" test; the left-hand pin below fails if you do.
  • `_label_drifted`'s X axis KEEPS the 0.02 floor. Only the Y axis was ever the row-scale question.
  • A proximity-only locate (matched_text None) must never count as drift, armed or not.
  • The armed path is a strict SUPERSET of the legacy one: everything the floor already called
    drifted still is. It only ADDS the sub-floor, one-row case, and only for an exactly-matched
    label. Do not "simplify" it back into a smaller tolerance — the mis-locate pins below fail.
"""
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

import importlib                                              # noqa: E402
from extraction import template_mapper as tm                  # noqa: E402

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


def _arm(**flags):
    """template_mapper reads its switches at IMPORT time (house style: the flag zone above the
    first def), so an arm must re-import the module and use the RETURNED reference."""
    for k, v in flags.items():
        if v:
            os.environ[k] = '1'
        else:
            os.environ.pop(k, None)
    return importlib.reload(tm)


# ── geometry from the live exhibit (doc 325, Pelican-Office_invoice_0030) ────────────────────────
# Taught box, re-seated by the relocate; the page prints '£10,603.44' whose left glyphs fall outside.
SEATED = {"x_norm": 0.86527, "y_norm": 0.48907, "w_norm": 0.05979, "h_norm": 0.01467}
LABEL  = {"x_norm": 0.69815, "y_norm": 0.48800, "w_norm": 0.08912, "h_norm": 0.00772}   # 'Balance Due'
MONEY  = {"text": "£10,603.44", "x_norm": 0.84727, "y_norm": 0.48950,
          "w_norm": 0.07455, "h_norm": 0.00772}
PAGE = object()          # never touched: the line cache is pre-seeded below


@case
def test_sub_floor_drift_is_measured_on_the_LABEL_box_not_the_matched_line():
    """FRAME (007), DOWNGRADED TO A DEFENSIVE PIN BY ORACLE C5 (2026-08-09) — read this before
    treating it as evidence of anything. `_relocate_and_read` seats from `label_box`, so measuring
    drift against it is right on principle. But under TODAY's code the two boxes cannot differ
    materially where it matters: `_locate_anchor` sets matched_text to the LINE text and `_ocr_lines`
    builds the line box as the union of that same line's words, so whenever the exactness predicate
    passes, the line IS the label. 007's stated rationale (a `located_h` inflated by emphasised money
    on the row) therefore cannot occur — a row carrying its own figure only passes via the inline
    form. The code stays because it is free and correct; this pin guards a FUTURE line-grouping
    change, and it is NOT proof that the frame fix does anything today."""
    mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=True)
    # tight label one row down (drift), wrapped in a tall merged LINE whose centre barely moved
    loc = {"x_norm": 0.69815, "y_norm": 0.42000, "w_norm": 0.22000, "h_norm": 0.02600,
           "matched_text": 'Balance Due',
           "label_box": {"x_norm": 0.69815, "y_norm": 0.43945, "w_norm": 0.08912, "h_norm": 0.00772}}
    assert mod._label_drifted(ANCHOR, loc, 'Balance Due') is True, \
        'the tight label moved a row; judging the merged line would have missed it'


def _snap(mod, words, seated=SEATED, label=LABEL, val_type='currency'):
    """Call the real _snap_box_to_words with a pre-seeded full-page line cache (the same key the
    function itself computes), so no OCR and no page image are needed."""
    cache = {(id(PAGE), 0.0, 0.0, 1.0, 1.0): [{"words": list(words)}]}
    return mod._snap_box_to_words(PAGE, dict(seated), val_type, None, cache, label_box=label)


# ── TEMPLATE_CURRENCY_EDGE_GROW — the derived-rung word snap ─────────────────────────────────────
@case
def test_money_snap_off_is_byte_identical():
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=False)
    out = _snap(mod, [MONEY])
    assert out == SEATED, f'OFF must return the seated box unchanged, got {out}'


@case
def test_money_snap_on_restores_the_overflowed_left_glyphs():
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    out = _snap(mod, [MONEY])
    assert out != SEATED, 'armed snap must move the box onto the word'
    # grows LEFT to the word (minus the shared 0.004 pad) and never past the located label
    assert abs(out["x_norm"] - (MONEY["x_norm"] - 0.004)) < 1e-6, out
    assert out["x_norm"] > LABEL["x_norm"] + LABEL["w_norm"], 'must never re-absorb the label'


@case
def test_money_snap_needs_the_word_snap_switch_too():
    """The currency flag ADMITS a type; it does not turn the snap on by itself."""
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=False, TEMPLATE_CURRENCY_EDGE_GROW=True)
    assert _snap(mod, [MONEY]) == SEATED


def _both_types(mod, words):
    """A money leg only PROVES something when the same geometry snaps for a CODE: the shared
    majority-inside / label-cut filters reject before the money legs ever run, so a refusal with no
    control is indistinguishable from a vacuous test. Returns (currency_result, code_result)."""
    code = [dict(w, text='PI255450') for w in words]
    return _snap(mod, words, val_type='currency'), _snap(mod, code, val_type='alphanumeric')


@case
def test_money_snap_refuses_a_union_reaching_into_the_column_to_the_RIGHT():
    """VACUOUS-PIN HISTORY (007, 2026-08-09): the first version of this pin used x=0.89 w=0.07455,
    which is 47.0% inside — under the 0.5 majority floor, so it was refused before the money leg was
    reached, and deleting the leg entirely left the test green. Geometry is now 69.3% inside, and
    the CODE control asserts the money leg is what refuses."""
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    right = dict(MONEY, x_norm=0.88000, w_norm=0.06500)   # ends 0.0199 past the box: ~3 glyphs
    money, code = _both_types(mod, [right])
    assert code != SEATED, 'control: this geometry MUST snap for a code, or the pin is vacuous'
    assert money == SEATED


@case
def test_money_snap_refuses_a_union_sitting_in_the_column_to_the_LEFT():
    """`cluster_value_words` returns the run nearest expect_x, which on a multi-column row need not
    be the run under the box. A one-sided 'must not extend right' rule would ACCEPT this."""
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    left = dict(MONEY, x_norm=0.85000, w_norm=0.04500)        # 66% inside, x2 = 0.895 vs box 0.925
    money, code = _both_types(mod, [left])
    assert code != SEATED, 'control: this geometry MUST snap for a code, or the pin is vacuous'
    assert money == SEATED


@case
def test_money_snap_refuses_a_TRUNCATION_that_drops_a_leading_token():
    """THE RIGHT-EDGE RULE IS BLIND TO WHAT A RE-FIT SHRINKS PAST, and left is money's only failure
    direction (007, 2026-08-09; Oracle ruled the shrink seam on 2026-08-06). Here '£10' is partly
    covered by the taught box — under the majority floor, so it is dropped — while '603.44' snaps
    with its right edge perfectly pinned. Without the left leg this adopts a truncation at full
    confidence, which is the worst class this module can produce."""
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    lead = {"text": "£10,", "x_norm": 0.84200, "y_norm": 0.48950, "w_norm": 0.02600, "h_norm": 0.00772}
    tail = {"text": "603.44", "x_norm": 0.87000, "y_norm": 0.48950, "w_norm": 0.05300, "h_norm": 0.00772}
    assert _snap(mod, [lead, tail]) == SEATED
    # the same geometry with a NON-numeric left neighbour is a caption, not a lost token -> snaps
    assert _snap(mod, [dict(lead, text='Due'), tail]) != SEATED


@case
def test_money_snap_refuses_a_truncation_whose_lead_is_FULLY_OUTSIDE_the_box():
    """ORACLE C1 (BLOCKING, 2026-08-09). The first anti-truncation leg scanned only words that
    INTERSECT the seated box, so a leading token entirely left of it was invisible to admission AND
    to the leg — the union's right edge stayed pinned, the single-row leg passed, and a truncation
    committed at 90 and auto-filed. That is precisely the case oracle_log 2026-08-06 named, while
    the comment claimed to cover it. Reachable: this repo already documents Tesseract splitting a
    thousands separator ('$15 707.84' -> '$15', anchor.py), and the rejoin can only repair what is
    inside the crop. Taught '£99.00', sibling prints '£15,707.84' -> commits '707.84'."""
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    lead = {"text": "£15,", "x_norm": 0.83400, "y_norm": 0.48950, "w_norm": 0.02600, "h_norm": 0.00772}
    tail = {"text": "707.84", "x_norm": 0.87000, "y_norm": 0.48950, "w_norm": 0.05300, "h_norm": 0.00772}
    assert lead["x_norm"] + lead["w_norm"] < SEATED["x_norm"], 'fixture must put the lead OUTSIDE'
    assert _snap(mod, [lead, tail]) == SEATED
    # The guard is GAP-BOUNDED by design: a digit-bearing word a full column away is a neighbouring
    # column, not a lost leading token, and must NOT veto a legitimate snap.
    far = dict(lead, x_norm=0.74000)
    assert _snap(mod, [far, tail]) != SEATED


@case
def test_money_snap_refuses_dropping_a_leading_SIGN_token():
    """ORACLE C2 (BLOCKING, 2026-08-09). The dropped-token test was digits-only, so a separately
    tokenised leading '-' is not 'digit-bearing' and was dropped — a CREDIT NOTE would commit
    POSITIVE at 90 with no flag. The measured exhibit for the row fix (doc 263) is a credit note,
    and this project has sign-blindness on record in three comparators."""
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    sign = {"text": "-", "x_norm": 0.85800, "y_norm": 0.48950, "w_norm": 0.00700, "h_norm": 0.00772}
    tail = {"text": "586.22", "x_norm": 0.87000, "y_norm": 0.48950, "w_norm": 0.05300, "h_norm": 0.00772}
    assert _snap(mod, [sign, tail]) == SEATED
    # a genuine CAPTION word to the left is not a lost token — that must still snap (the control)
    assert _snap(mod, [dict(sign, text='Due', w_norm=0.02000), tail]) != SEATED


@case
def test_money_snap_refuses_a_union_spanning_TWO_ROWS():
    """Every figure in a totals column shares one right edge, so the right-edge rule has no vertical
    power. An over-tall taught money box (this project has one on record at 2.2 line-heights) admits
    the row above; both rows pass; clean_crop_segment then takes the FIRST line — the wrong one."""
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    tall = dict(SEATED, h_norm=0.02800, y_norm=0.47800)
    vat = {"text": "£1,767.24", "x_norm": 0.85000, "y_norm": 0.48100, "w_norm": 0.07200, "h_norm": 0.00772}
    total = {"text": "£10,603.44", "x_norm": 0.84727, "y_norm": 0.49500, "w_norm": 0.07455, "h_norm": 0.00772}
    # NB compare against `tall` — the refusal returns the box that was PASSED IN, not the module's
    # standard SEATED. (This assertion originally compared to SEATED and failed for that reason.)
    assert _snap(mod, [vat, total], seated=tall) == tall, 'a two-row money union must be refused'
    assert _snap(mod, [total], seated=tall) != tall       # one row alone still snaps


@case
def test_money_snap_refuses_a_word_with_no_digit():
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    assert _snap(mod, [dict(MONEY, text="Balance")]) == SEATED


@case
def test_code_scope_is_unchanged_by_the_currency_admission():
    """The shipped code/date scope must behave identically whether or not the money flag is armed."""
    code = {"text": "PI255450", "x_norm": 0.84727, "y_norm": 0.48950,
            "w_norm": 0.07455, "h_norm": 0.00772}
    a = _snap(_arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=False),
              [code], val_type='alphanumeric')
    b = _snap(_arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True),
              [code], val_type='alphanumeric')
    assert a == b and a != SEATED, (a, b)
    # ...and a code is NOT held to the money right-edge rule — a code may be cut on EITHER side, so
    # the same geometry that money refuses must still snap for a code. (Word is majority-inside; its
    # right edge sits 0.030 left of the box's, ~5 glyphs.)
    lefty = dict(code, x_norm=0.85000, w_norm=0.04500)
    mod = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    assert _snap(mod, [lefty], val_type='alphanumeric') != SEATED, 'a code must still snap'
    assert _snap(mod, [dict(lefty, text="£576.00")], val_type='currency') == SEATED, \
        'the same geometry must be refused for money — right edges do not coincide'


@case
def test_currency_still_admitted_to_the_absolute_rung_edge_guard():
    """The first version of the flag (abs rung only) stays wired — it is the same clip on a page
    that has NOT drifted. Armed, currency must be in the guard's scope; unarmed, it must not."""
    mod = _arm(TEMPLATE_CURRENCY_EDGE_GROW=True)
    assert 'currency' in mod._EDGE_GUARD_VAL_TYPES and mod._CURRENCY_EDGE_GROW_ON
    assert 'currency' not in mod._SNAP_VAL_TYPES, \
        'the shipped snap scope must stay untouched — the admission is a separate predicate'
    mod = _arm(TEMPLATE_CURRENCY_EDGE_GROW=False)
    assert not mod._CURRENCY_EDGE_GROW_ON


# ── TEMPLATE_DRIFT_ROW_PITCH — _label_drifted's vertical tolerance ───────────────────────────────
# Doc 296: taught anchor y=0.42075 h=0.00831, 'Balance Due' located at y=0.43945 h=0.00772.
ANCHOR = {"x_norm": 0.69815, "y_norm": 0.42075, "w_norm": 0.08900, "h_norm": 0.00831}
TAUGHT = 'Balance Due'
def _located(y, h=0.00772, x=0.69815, w=0.08912, matched='Balance Due'):
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h, "matched_text": matched}


@case
def test_one_row_move_is_not_drift_today():
    mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=False)
    assert mod._label_drifted(ANCHOR, _located(0.43945), TAUGHT) is False, \
        'the legacy 0.02 floor calls a one-row move "not drifted" — that IS the defect'


@case
def test_one_row_move_is_drift_when_armed_and_the_label_matched():
    mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=True)
    assert mod._label_drifted(ANCHOR, _located(0.43945), TAUGHT) is True


@case
def test_a_fuzzy_neighbouring_label_is_NOT_drift_even_armed():
    """THE REGRESSION THIS SLICE WAS REDESIGNED AROUND (measured on the arm, traced on the page):
    the local locate answered needle 'Credit Ref' with 'Credit Date' one row below — they share
    'Credit'. Believing that mis-locate seated the credit-note number on the date row and committed
    '07-08-2025' as a reference. Sub-floor drift must require the taught label itself."""
    mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=True)
    assert mod._label_drifted(ANCHOR, _located(0.43945, matched='Credit Date'), 'Credit Ref') is False
    # ...and with no anchor text to compare against, there is nothing to believe
    assert mod._label_drifted(ANCHOR, _located(0.43945), None) is False


@case
def test_a_suffix_extended_caption_is_NOT_the_taught_label():
    """THE SECOND REVIEW KILL (gary + 007, 2026-08-09). This predicate briefly accepted 'the label
    followed by anything with a digit', because `_locate_anchor` returns the whole matched LINE as
    matched_text. That admits every caption which EXTENDS the taught one on a line carrying its own
    figure — and in a totals block captions are systematically prefix-extended and one row apart,
    which is the precise family this predicate exists to refuse. 'VAT' -> 'VAT Reg No ...' is the
    class a shipped guard (vat_reg_not_amount) already exists to block."""
    mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=True)
    for taught, line in (('VAT', 'VAT Reg No 651 0027 84'),
                         ('Total', 'Total VAT 226.32'),
                         ('Total', 'Total Due 1,234.56'),
                         ('Total', 'Total to Pay £1,357.92')):
        assert mod._label_drifted(ANCHOR, _located(0.43945, matched=line), taught) is False, \
            f'{taught!r} must not be satisfied by {line!r}'


@case
def test_an_inline_row_where_the_VALUE_follows_the_label_IS_the_taught_label():
    """MEASUREMENT OVERRULED BOTH ADVISORS HERE — pin the reason so it is not re-litigated.
    Both recommended dropping this form entirely, on the reasoning that no measured heal used it.
    Re-running the live corpus with it gone cost FOUR heals: templates taught against
    'Total (inc VAT)' / 'Total inc. VAT' print label and value on one line, so they can never
    satisfy exact equality, and they reverted to reading the VAT row. The discriminator is that the
    FIRST token after the label carries the digit — its value — rather than another caption's word.
    Do not collapse this to exact-only (costs 4) and do not widen it to 'a digit anywhere in the
    tail' (re-admits every case in the test above)."""
    mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=True)
    for taught, line in (('Total (inc VAT)', 'Total (inc VAT) £3,564.72'),
                         ('Total inc. VAT', 'Total inc. VAT £1,239.72'),
                         ('Invoice Number', 'Invoice Number PI255450'),
                         ('Balance Due', 'Balance Due £10,603.44')):
        assert mod._label_drifted(ANCHOR, _located(0.43945, matched=line), taught) is True, \
            f'{taught!r} must be satisfied by its own inline row {line!r}'


@case
def test_the_taught_label_alone_still_counts_however_it_is_punctuated():
    """Exactness is after alnum-folding, so teach/scan disagreement about case, ':' or '.' does not
    cost the heal — that is the whole reason the predicate normalises."""
    mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=True)
    for line in ('Balance Due', 'BALANCE DUE', 'Balance Due:', 'balance  due.'):
        assert mod._label_drifted(ANCHOR, _located(0.43945, matched=line), 'Balance Due') is True


@case
def test_above_the_floor_is_unchanged_by_the_flag():
    """The armed path only ADDS the sub-floor case. A move beyond 0.02 was drift before and stays
    drift — fuzzy match or not, so no existing relocation is withdrawn."""
    far = _located(0.42075 + 0.05000, matched='Credit Date')
    for on in (False, True):
        mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=on)
        assert mod._label_drifted(ANCHOR, far, 'Credit Ref') is True, f'armed={on}'


@case
def test_within_row_jitter_is_never_drift():
    """The floor existed to stop within-line jitter false-flagging a row move. The replacement must
    keep that property, or every clean page pays a needless relocation."""
    for on in (False, True):
        mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=on)
        assert mod._label_drifted(ANCHOR, _located(0.42100), TAUGHT) is False, f'armed={on}'
        assert mod._label_drifted(ANCHOR, _located(0.42400), TAUGHT) is False, f'armed={on}'


@case
def test_x_axis_keeps_the_drift_floor():
    """Only the Y axis was ever the row-scale question. A 0.015 horizontal shift is inside the
    0.02 floor and must stay 'not drifted' in BOTH arms."""
    for on in (False, True):
        mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=on)
        assert mod._label_drifted(ANCHOR, _located(0.42075, x=0.71315), TAUGHT) is False, f'armed={on}'


@case
def test_proximity_only_locate_is_never_drift():
    for on in (False, True):
        mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=on)
        assert mod._label_drifted(ANCHOR, _located(0.43945, matched=None), TAUGHT) is False, f'armed={on}'
        assert mod._label_drifted(ANCHOR, None, TAUGHT) is False, f'armed={on}'


@case
def test_armed_tolerance_is_the_taller_box_never_smaller():
    """Tying tol_y to the boxes must not make it SMALLER than either of them, or ordinary box-height
    slop reads as a row move."""
    mod = _arm(TEMPLATE_DRIFT_ROW_PITCH=True)
    tall = _located(0.42075 + 0.00900, h=0.01800)     # centre moved by half its own (tall) height
    assert mod._label_drifted(ANCHOR, tall, TAUGHT) is False
    assert mod._label_drifted(ANCHOR, _located(0.42075 + 0.02000, h=0.01800), TAUGHT) is True


@case
def test_the_caller_passes_the_taught_label():
    """A three-argument helper called with two is a dead guard: the sub-floor branch would never
    fire in production and every test above would still pass."""
    import inspect
    src = inspect.getsource(_arm(TEMPLATE_DRIFT_ROW_PITCH=True)._extract_one)
    assert '_label_drifted(anchor_box, drift_located, anchor_text)' in src, \
        'the drift branch must hand _label_drifted the taught anchor text'


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
            for f in ('TEMPLATE_TARGET_WORD_SNAP', 'TEMPLATE_CURRENCY_EDGE_GROW',
                      'TEMPLATE_DRIFT_ROW_PITCH'):
                os.environ.pop(f, None)
    importlib.reload(tm)
    print(f'\n{len(CASES) - failed}/{len(CASES)} passed')
    sys.exit(1 if failed else 0)
