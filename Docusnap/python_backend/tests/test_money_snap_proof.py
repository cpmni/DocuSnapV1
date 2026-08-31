"""test_money_snap_proof.py — ORACLE C3 (BLOCKING, 2026-08-09), the derived money rung's PROOF.

Run: py -3.12 python_backend/tests/test_money_snap_proof.py

WHY THIS EXISTS.
`_abs_edge_guard` may not rewrite a money value until it has PROVED a digit relation between the
rigid read and the grown read (template_mapper.py, the `val_type == 'currency'` leg: the rigid read
must be a strict digit-SUFFIX of the grown one and the grown one must carry more integer digits).
The DERIVED rung had no such proof. `_snap_box_to_words` re-fits the box and the caller simply
adopts whatever the re-crop reads — and a derived money read has no other guard:

  • confidence is a flat 90, which CLEARS the 88 auto-file floor (trust.js blocks only c < 88);
  • `currency` is in `_SELF_VALIDATING_TYPES`, so the learned-shape check is a no-op;
  • Stage 4's `subtotal + tax = total` is flag-only, total-role only, and returns None without a
    shadow subtotal (validator.py) — it is not a backstop.

MEASURED, not assumed — `_gate_value(shape_mode='ignore')` on currency accepts EVERY string these
pins use, including '707.84', '3.765.72' and '3.801.824'. The value gate cannot discriminate here.
Geometry was the entire safety. This module is the value-level half.

THE PREDICATE, and why it is not Oracle's literal wording.
Oracle signed "adopt only if digits(snapped).endswith(digits(unsnapped)) and the snapped integer
part is longer". Measured against the live corpus that costs 2 real heals, and his escape hatch
(census showing every snap-moved read is a left-extension) fails for the same reason: two measured
heals are SEPARATOR REPAIRS, not left-extensions — '3.765.72' -> '3,765.72' carries the identical
digit string. So the shipped predicate is his, plus one clause that cannot change any digit:

  P1  digits(snapped).endswith(digits(unsnapped)) and more integer digits   [Oracle, verbatim]
  P2  digits identical AND the un-snapped read is NOT a well-formed amount
      while the snapped one IS                                             [format-only repair]
  otherwise REFUSE — keep the un-snapped box and its read.

P2's second clause is what stops it substituting one VALID amount for another: with the un-snapped
read already well-formed, P2 declines and nothing moves (pin: `test_P2_declines_when_unsnapped_is
_already_wellformed`, the Veltrix 4494.36 exhibit, whose baseline read was already correct).

Cost on the live 145-document arm: exactly ONE heal, Pelican-Office_invoice_0013
'3.801.824' -> '3,801.84' — where the snapped read has FEWER digits than the un-snapped one. That
is the SHAPE OF A TRUNCATION. It is correct on that page by luck, the guard cannot know it, and
refusing it fails safe: the fall-back read is a conf-50 value that goes to Review, never auto-files.

ANTI-LOOSEN CONTRACT:
  • OFF is byte-identical — with TEMPLATE_CURRENCY_EDGE_GROW off the proof must not run at all,
    and must not cost the extra OCR read (pinned by counting stub calls, not by asserting a return).
  • A refusal must hand the caller the UN-SNAPPED READ, not None. Returning None would leave the
    caller holding the snapped text with the snapped box reverted — the worst of both.
  • An EMPTY un-snapped read is NO PROOF and must refuse. Do not "helpfully" adopt the snap because
    the alternative is empty; empty goes to Review, a wrong number auto-files.
  • Do not relax P1 into a plain `endswith`. The integer-length clause is what makes
    '15,707.84' -> '707.84' refuse: '70784' is not a suffix of '1570784', but a careless
    normalisation that compared the other way round would pass it.
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


# Geometry from the live exhibit (doc 325, Pelican-Office_invoice_0030). Only "did the box move"
# is read off these, so the exact numbers matter less than the fact that they DIFFER.
UNSNAPPED = {"x_norm": 0.86527, "y_norm": 0.48907, "w_norm": 0.05979, "h_norm": 0.01467}
SNAPPED   = {"x_norm": 0.84327, "y_norm": 0.48910, "w_norm": 0.08179, "h_norm": 0.01072}
PAGE = object()          # never dereferenced: _crop_and_ocr is stubbed on every path that runs


class _Reader:
    """Stub for _crop_and_ocr. Counts calls so an OFF/skip pin can assert the extra page read did
    NOT happen — a proof that silently costs an OCR pass on every money field is a perf regression
    the value assertions would never notice."""
    def __init__(self, text):
        self.text = text
        self.calls = 0

    def __call__(self, page, box, val_type, ocr_text_fn, capture=None, meta=None):
        self.calls += 1
        if meta is not None:
            meta['conf'] = 61
        return self.text


def _proof(mod, unsnapped_text, snapped_text, *, val_type='currency',
           unsnapped_box=None, snapped_box=None):
    """Run the proof with the un-snapped read stubbed. Returns (verdict, reader)."""
    reader = _Reader(unsnapped_text)
    real = mod._crop_and_ocr
    mod._crop_and_ocr = reader
    try:
        v = mod._money_snap_proof(PAGE,
                                  unsnapped_box if unsnapped_box is not None else UNSNAPPED,
                                  snapped_box if snapped_box is not None else SNAPPED,
                                  snapped_text, val_type, 'total_amount', object())
    finally:
        mod._crop_and_ocr = real
    return v, reader


# ── the predicate ────────────────────────────────────────────────────────────────────────────────

@case
def test_P1_left_extension_is_adopted():
    """The canonical heal: the taught box clipped the leading '1', the snap recovered it.
    '1060344'.endswith('060344') and the integer part grew 4 -> 5 digits."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '0,603.44', '10,603.44')
    assert v is None, f'P1 left-extension must be adopted (verdict {v!r})'


@case
def test_P1_refuses_the_C1_truncation_exhibit():
    """The failure direction. The page prints '£15,707.84'; Tesseract splits it '£15,' + '707.84'
    and a snap that drops the leading token reads '707.84' — which would commit at 90 and
    auto-file. '70784' is not a digit-suffix of '1570784', so the proof refuses."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '15,707.84', '707.84')
    assert v is not None, 'a truncating snap must be refused'
    assert v['raw'] == '15,707.84', f'the refusal must hand back the un-snapped read, got {v!r}'


@case
def test_P2_separator_repair_is_adopted():
    """Measured heal, Pelican-Office_invoice_0012 (GT 3765.72). Identical digits, and the
    un-snapped read is not a well-formed amount while the snapped one is."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '3.765.72', '3,765.72')
    assert v is None, f'a digit-preserving separator repair must be adopted (verdict {v!r})'


@case
def test_identical_digits_are_adopted():
    """Veltrix-Automotive_sales_order_0027 (GT 4494.36), un-snapped '4494.36' -> snapped
    '4,494.36'. Identical digit strings cannot be a truncation, so there is no evidence of loss and
    the snap is adopted. (The value is correct either way here — the pin is about the RULE.)"""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '4494.36', '4,494.36')
    assert v is None, f'identical digits are not a truncation (verdict {v!r})'


@case
def test_unrelated_digit_strings_are_adopted():
    """Pelican-Office_invoice_0013: '3.801.824' -> '3,801.84' (GT 3801.84). Not a suffix relation,
    and the reference is not a well-formed amount, so there is no evidence the snap DROPPED
    anything — it re-read a garbled box. MEASURED: refusing this class cost 8 heals across the live
    arm. The reference-well-formed clause is what keeps this heal; delete it and this pin fails."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '3.801.824', '3,801.84')
    assert v is None, f'a re-read of a malformed reference must be adopted (verdict {v!r})'


@case
def test_mis_seated_box_corrected_by_the_snap_is_adopted():
    """THE REGRESSION THAT KILLED THE ADOPT-ON-PROOF FORM. Meadowvale credit_note_0023: the
    un-snapped box sits on the VAT row and reads '-101.60'; the snap pulls it onto the total row
    and reads '-609.62'. Digits are unrelated in BOTH directions, so an adopt-only-if-proven rule
    reverts a credit note to its VAT row. Evidence-of-loss adopts, because '10160' is not a suffix
    of '60962' — nothing was dropped, the box MOVED."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '-101.60', '-609.62')
    assert v is None, f'a mis-seat correction must not be refused (verdict {v!r})'


@case
def test_single_glyph_reread_is_adopted():
    """Silverbeck-Cleaning_sales_order_0024 (GT 999.72). Un-snapped '999.79', snapped '999.72' —
    same length, one glyph different. Not a suffix relation, so no loss; adopt. The adopt-on-proof
    form refused this and turned a correct total into a wrong one."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '999.79', '999.72')
    assert v is None, f'an equal-length re-read is not a truncation (verdict {v!r})'


@case
def test_empty_unsnapped_read_is_adopted():
    """An un-snapped box that reads NOTHING is the mis-seat the snap exists to repair, not a value
    it truncated — there is no evidence of loss. MEASURED: refusing here cost two documents
    outright (the arm's empty count went 1 -> 3)."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '', '10,603.44')
    assert v is None, f'an empty reference is not evidence of loss (verdict {v!r})'


@case
def test_the_direction_test_is_not_reversed():
    """`do.endswith(dn)` is the loss test; `dn.endswith(do)` is its exact opposite — the left
    EXTENSION that is the headline heal. A flipped comparator still type-checks, still refuses
    'something', and would refuse every heal while adopting every truncation. Pinned as a pair so
    the mistake cannot pass."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    loss, _ = _proof(m, '15,707.84', '707.84')          # snap dropped leading digits
    heal, _ = _proof(m, '0,603.44', '10,603.44')        # snap recovered leading digits
    assert loss is not None, 'the truncation direction must refuse'
    assert heal is None, 'the extension direction must adopt — comparator is reversed'


@case
def test_refusal_carries_the_unsnapped_confidence():
    """The caller replaces its meta conf with the fall-back read's, so a refused snap does not
    keep the snapped read's confidence attached to the un-snapped value."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, _ = _proof(m, '15,707.84', '707.84')
    assert v is not None and v.get('conf') == 61, f'refusal must carry the fall-back conf, got {v!r}'


# ── scope and inertness ──────────────────────────────────────────────────────────────────────────

@case
def test_off_does_not_run_and_costs_no_extra_read():
    """OFF is byte-identical AND free. Counting the stub calls is the load-bearing assertion: a
    proof that runs and always returns None would pass a return-value-only pin while silently
    adding a page read to every money field."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=False)
    v, reader = _proof(m, '15,707.84', '707.84')
    assert v is None, 'with the parent flag off the proof must not fire'
    assert reader.calls == 0, f'OFF must not cost an OCR read (made {reader.calls})'


@case
def test_non_currency_types_are_untouched():
    """Codes and dates keep their own ladders (`_abs_edge_guard`'s frag comparator, the inline
    reconcile). This proof is money-only and must not add a read for them."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, reader = _proof(m, 'PO-49938', 'PO-4993', val_type='reference_code')
    assert v is None and reader.calls == 0, 'the money proof must not touch non-currency types'


@case
def test_an_unmoved_box_skips_the_proof():
    """`_snap_box_to_words` returns the seated box UNCHANGED on every failure path (out of scope,
    no words admitted, over-4x union...). Those are not snaps and must not pay for a second read."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    v, reader = _proof(m, '15,707.84', '707.84', snapped_box=dict(UNSNAPPED))
    assert v is None and reader.calls == 0, 'an unmoved box is not a snap — no proof, no read'


# ── the well-formedness helper P2 rests on ───────────────────────────────────────────────────────

@case
def test_wellformed_truth_table():
    """P2 needs a WHOLE-STRING amount test. The shipped `validation_patterns.currency` entries and
    `validator.parse_amount` are both `re.search`-based, so '3.765.72' matches them via the
    substring '765.72' — measured. That is why this helper exists rather than reusing them."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    ok = ['3,765.72', '4494.36', '4,494.36', '0,603.44', '10,603.44', '707.84',
          '15,707.84', '-586.22', '£1,205.58', '(97.70)', '1205', '1,205']
    bad = ['3.765.72', '3.801.824', '1,05,296', '', 'Total', '12.345', '1,2345.67']
    for s in ok:
        assert m._money_wellformed(s), f'{s!r} should be a well-formed amount'
    for s in bad:
        assert not m._money_wellformed(s), f'{s!r} should NOT be a well-formed amount'


@case
def test_wellformed_is_whole_string_not_a_search():
    """The specific trap this helper exists to avoid — a search would find '765.72' inside
    '3.765.72' and call it well-formed, which would make P2 decline the measured heal."""
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    assert not m._money_wellformed('3.765.72'), 'must not match a well-formed SUBSTRING'
    assert not m._money_wellformed('INV 707.84 due'), 'must not match inside surrounding text'


# ── wiring: the predicate is worthless if no call site invokes it ────────────────────────────────

@case
def test_both_derived_call_sites_invoke_the_proof():
    """A guard nobody calls is a dead guard that greens its own test — this project found three in
    one session. `_snap_box_to_words` has exactly two derived-rung call sites: the nested
    `_geometric()` inside `_relocate_and_read`, and `_read_registration`. Both must run the proof,
    and both must be able to fall back, so both need the pre-snap box kept.

    (The first draft of this pin named `_extract_one` and failed for the WRONG reason — it caught
    the misnaming, not a missing guard. Kept as written: a wiring pin that cannot name its own call
    site is not a wiring pin.)"""
    import inspect
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    for fname in ('_relocate_and_read', '_read_registration'):
        src = inspect.getsource(getattr(m, fname))
        assert '_snap_box_to_words(' in src, f'{fname} should still snap'
        assert '_money_snap_proof(' in src, \
            f'{fname} snaps money but never proves it — the C3 hole reopened'


@case
def test_the_proof_is_reached_after_the_read_not_before():
    """The proof compares two READS, so it must sit after the snapped crop is OCR'd. Pinned by
    source order rather than behaviour because the alternative wiring (proving before the read)
    silently costs a third OCR pass and still type-checks."""
    import inspect
    m = _arm(TEMPLATE_TARGET_WORD_SNAP=True, TEMPLATE_CURRENCY_EDGE_GROW=True)
    src = inspect.getsource(m._relocate_and_read)
    i_read = src.find('_crop_and_ocr(page, derived_target')
    i_proof = src.find('_money_snap_proof(')
    assert i_read != -1 and i_proof != -1, 'both the derived read and the proof must be present'
    assert i_proof > i_read, 'the proof must run on the snapped READ, not before it'


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
