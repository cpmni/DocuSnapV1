"""test_issuer_region_presence.py — pins for TEMPLATE_ISSUER_REGION_PRESENCE (Oracle's Fix 2).

Run: py -3.12 python_backend/tests/test_issuer_region_presence.py

WHAT THIS IS. The STANDING GUARD behind the arbiter cure (TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE).
With the registration arbiter silenced for anchor-less mappings, an issuer box on a genuinely
drifted page has no drift compensation left, and whatever it reads still displaces the curated
`template_fixed` seed through `is_curated_refinement`. This asks a question about THIS DOCUMENT
instead of about the layout: is the curated name actually PRINTED where the operator taught it?

THE CONTRACT THESE PINS DEFEND — every clause is Oracle's, and each one is a place a future
"simplification" would quietly turn a confirming guard into a destructive one:
  • POSITIVE EVIDENCE ONLY. Confirmed -> keep the seed. Not found -> fall through. Region empty or
    unreadable -> ALSO fall through, and that case is asserted SEPARATELY from not-found, because
    *could not read* and *is not there* are different facts (Oracle C2'). Fail-closed on the
    CONFIRM direction only.
  • CONFIRMATION GRANTS NO NEW AUTHORITY. It licenses keeping what Stage 0 already seeded — never
    a raised confidence, never a new method string, never a mutation of either dict.
  • SHARE THE PRIMITIVE, NEVER THE DECISION. The fuzzy distinctive-token test is reused from
    TEMPLATE_FIXED_NAME_PRESENCE_VETO; its >=3-sample / >=0.80 `supplier_prints_name` gate is NOT.
    That gate protects a DESTRUCTIVE action (blanking a stamped supplier) and would disarm a
    confirming one for exactly the new suppliers this helps.
  • NOT AN EXEMPTION IN `_flag_branding_conflict`. "This string is printed near the taught spot"
    is not "this supplier's branding is present on this document". Someone will propose wiring
    this confirmation into the page-wide branding guard; the source pin below shuts that door.
  • NO `tessedit_char_whitelist` ON THE REGION READ. A whitelist force-fits glyphs toward the
    string you are hoping to find — the exact bias a presence test must not have.

NAMED FALSE POSITIVE, pinned rather than hand-waved: a 150% pad can reach the recipient block on a
compact layout. Harmless when testing one known string — unless the template was mis-taught and its
`fixed_value` IS the recipient, in which case this confirms the mis-teach. Re-teaching is the cure,
as for every other seed branch. The pin exists so the trade-off is discovered by reading the tests
rather than by a customer.
"""
import os, sys, inspect
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

from extraction import engine as E                            # noqa: E402
from extraction import template_mapper as tm                  # noqa: E402

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


def _code_only(fn):
    """A function's source with its docstring and comment lines removed, so a source-level pin
    judges the implementation rather than the prose that explains it."""
    import ast, textwrap
    src = textwrap.dedent(inspect.getsource(fn))
    tree = ast.parse(src).body[0]
    body = tree.body[1:] if (tree.body and isinstance(tree.body[0], ast.Expr)
                             and isinstance(getattr(tree.body[0], 'value', None), ast.Constant)
                             and isinstance(tree.body[0].value.value, str)) else tree.body
    lines = src.splitlines()
    first = min((n.lineno for n in body), default=len(lines) + 1) - 1
    return "\n".join(ln for ln in lines[first:] if not ln.strip().startswith('#'))


SEED = {"method": "template_fixed", "value": "Castellan Security Systems", "confidence": 95}
READ = {"method": "template_registration", "value": "SERVICE WORKSHEET", "confidence": 82}
MAPPINGS = [{"field_key": "supplier_name", "page_number": 0,
             "target_x_norm": 0.27, "target_y_norm": 0.10,
             "target_w_norm": 0.45, "target_h_norm": 0.025}]
PAGE = object()          # never touched — region_text is stubbed in the decision tests


class _Stub:
    """Swap `template_mapper.region_text` for a canned answer and record the calls."""
    def __init__(self, ret):
        self.ret, self.calls = ret, []
    def __enter__(self):
        self._orig = tm.region_text
        tm.region_text = lambda page, box, pad=1.5: (self.calls.append((box, pad)) or self.ret)
        return self
    def __exit__(self, *a):
        tm.region_text = self._orig


def _confirm(region_ret, seed=SEED, read=READ, mappings=MAPPINGS, pages=(PAGE,)):
    with _Stub(region_ret) as s:
        out = E._region_confirms_curated_seed('supplier_name', dict(seed), dict(read),
                                              mappings, list(pages))
    return out, s.calls


# ── the three verdicts, each asserted for its OWN reason ─────────────────────────────────────────
@case
def test_name_printed_in_the_taught_region_confirms():
    out, calls = _confirm('Castellan Security Systems  Unit 4, Sawpit Lane')
    assert out is True, f'the curated name is printed in the region; expected True, got {out!r}'
    assert len(calls) == 1, 'the region must be read exactly once'


@case
def test_name_absent_from_the_region_falls_through():
    out, _ = _confirm('SERVICE WORKSHEET  Job Ref JB-8887')
    assert out is False, f'read the region and the name is not there -> False, got {out!r}'


@case
def test_unreadable_region_is_unjudgeable_NOT_absence():
    """C2'. `region_text` returning None means the crop or the OCR failed. Asserted separately from
    the not-found case above: collapsing the two is how a guard starts reporting "the name is not
    on this page" about a scan it never managed to read."""
    out, _ = _confirm(None)
    assert out is None, f'unreadable region must be None (unjudgeable), got {out!r}'


@case
def test_empty_region_is_unjudgeable_NOT_absence():
    """The other half of C2': the region read fine and produced nothing. Still not confirmation,
    and still not counted as absence."""
    out, _ = _confirm('   ')
    assert out is None, f'empty region must be None (unjudgeable), got {out!r}'


# ── inert wherever it has no business acting ─────────────────────────────────────────────────────
@case
def test_agreement_never_reads_the_page():
    """The read already equals the seed: nothing is under threat, so this must cost ZERO OCR. The
    call count is the pin — a version that reads first and compares afterwards passes the verdict
    assertion and silently adds a crop OCR to every taught document."""
    out, calls = _confirm('anything', read={"method": "template_mapping",
                                            "value": SEED["value"], "confidence": 78})
    assert out is None and not calls, f'agreement must short-circuit before the read, got {out!r} calls={len(calls)}'


@case
def test_non_seed_incumbent_is_ignored():
    out, calls = _confirm('Castellan Security Systems',
                          seed={"method": "template_mapping", "value": "Something Else", "confidence": 90})
    assert out is None and not calls, 'only a curated template_fixed/_locked seed is defended'


@case
def test_other_fields_are_ignored():
    with _Stub('Castellan Security Systems') as s:
        out = E._region_confirms_curated_seed('customer_name', dict(SEED), dict(READ), MAPPINGS, [PAGE])
    assert out is None and not s.calls, 'scoped to supplier_name (customer_name is legitimately variable)'


@case
def test_no_taught_box_is_unjudgeable():
    out, calls = _confirm('Castellan Security Systems', mappings=[{"field_key": "invoice_number"}])
    assert out is None and not calls, 'no taught geometry for this field -> unjudgeable, no read'


@case
def test_missing_page_is_unjudgeable():
    out, calls = _confirm('Castellan Security Systems', pages=())
    assert out is None and not calls, 'no page image -> unjudgeable, no read'


# ── the contract clauses ─────────────────────────────────────────────────────────────────────────
@case
def test_confirmation_mutates_nothing():
    """CONFIRMATION GRANTS NO NEW AUTHORITY. The helper answers a question; it must not touch the
    seed's confidence, the read, or either method string. The caller keeps the seed by declining
    the read — there is nothing here to 'promote'."""
    seed, read = dict(SEED), dict(READ)
    with _Stub('Castellan Security Systems'):
        out = E._region_confirms_curated_seed('supplier_name', seed, read, MAPPINGS, [PAGE])
    assert out is True
    assert seed == SEED and read == READ, f'inputs were mutated: {seed!r} {read!r}'


@case
def test_does_not_borrow_the_destructive_vetos_sample_gate():
    """SHARE THE PRIMITIVE, NEVER THE DECISION. TEMPLATE_FIXED_NAME_PRESENCE_VETO needs >=3 samples
    at >=0.80 before it will BLANK a supplier. Reusing that gate here would make the confirming
    guard silent for every supplier taught fewer than three times — the ones it exists to help.
    Source-level, because the absence of a dependency cannot be asserted behaviourally."""
    src = inspect.getsource(E._region_confirms_curated_seed)
    for banned in ('_prints_name_stats', 'supplier_prints_name',
                   'TEMPLATE_NAME_PRESENCE_MIN_SAMPLE', 'TEMPLATE_NAME_PRESENCE_RATIO'):
        assert banned not in src, f'the destructive veto\'s gate leaked in: {banned}'
    assert '_template_identity_corroborated' in src, 'the shared fuzzy primitive must be the test'


@case
def test_is_not_an_exemption_in_the_branding_guard():
    """NOT AN EXEMPTION IN `_flag_branding_conflict`. The page-wide branding guard keeps its own
    note/blank jurisdiction: "printed near the taught spot" is not "this supplier's branding is on
    this document". Pinned at the source because the tempting change is a one-line early return."""
    src = inspect.getsource(E.ExtractionEngine._flag_branding_conflict)
    for banned in ('region_presence', '_region_confirms_curated_seed',
                   '_ISSUER_REGION_PRESENCE_ON', 'region_text'):
        assert banned not in src, f'branding guard gained a region-presence exemption: {banned}'


@case
def test_region_read_uses_no_char_whitelist():
    """NO `tessedit_char_whitelist`. It force-fits glyphs toward the string being searched for, so
    a whitelisted read would confirm the name it was handed almost regardless of the pixels."""
    # Scan the CODE, not the prose: both bans are discussed in the function's own docstring, so a
    # naive substring test on the raw source passes judgement on the explanation instead of the
    # implementation (it did, on the first draft of this pin).
    src = _code_only(tm.region_text)
    assert '_ocr_lines(' in src, 'the presence read must go through the shared word-geometry pass'
    assert 'tessedit_char_whitelist' not in _code_only(tm._ocr_lines), \
        'the word-geometry pass gained a character whitelist — it would force-fit the searched string'
    assert '_clean_value' not in src, \
        'value CLEANING must not run on a presence read — it trims free text by shape'


# ── the pad geometry ─────────────────────────────────────────────────────────────────────────────
@case
def test_pad_grows_about_the_centre():
    b = {"x_norm": 0.40, "y_norm": 0.40, "w_norm": 0.20, "h_norm": 0.10}
    p = tm.pad_box_about_centre(b, 1.5)
    assert abs((p["x_norm"] + p["w_norm"] / 2) - 0.50) < 1e-9, 'centre x moved'
    assert abs((p["y_norm"] + p["h_norm"] / 2) - 0.45) < 1e-9, 'centre y moved'
    assert abs(p["w_norm"] - 0.30) < 1e-9 and abs(p["h_norm"] - 0.15) < 1e-9, p


@case
def test_pad_is_a_noop_at_or_below_one_and_clamps_at_the_page_edge():
    b = {"x_norm": 0.40, "y_norm": 0.40, "w_norm": 0.20, "h_norm": 0.10}
    assert tm.pad_box_about_centre(b, 1.0) == {k: v for k, v in b.items()}, 'ratio 1.0 must be a no-op'
    edge = tm.pad_box_about_centre({"x_norm": 0.0, "y_norm": 0.0, "w_norm": 0.20, "h_norm": 0.10}, 3.0)
    assert edge["x_norm"] >= 0.0 and edge["y_norm"] >= 0.0, edge
    assert edge["x_norm"] + edge["w_norm"] <= 1.0 and edge["y_norm"] + edge["h_norm"] <= 1.0, edge


# ── the named false positive, pinned as a trade-off rather than left to be discovered ────────────
@case
def test_mistaught_template_whose_fixed_value_is_the_recipient_DOES_confirm():
    """THE ACCEPTED FALSE POSITIVE. If the template was taught with the RECIPIENT's name as its
    `fixed_value`, a 150% pad that reaches the recipient block confirms it and the mis-teach is
    kept. This is the documented cost of a region test that pads; it is not a reason to shrink the
    pad below the drift it exists to tolerate. Re-teaching remains the cure, exactly as for the
    other curated-seed branches. If this ever needs closing, close it with an ANCHOR on the issuer
    box (the teach-side idea), not by tightening this predicate."""
    out, _ = _confirm('Bramblewood Joinery Ltd  Unit 4, Sawpit Lane',
                      seed={"method": "template_fixed", "value": "Bramblewood Joinery Ltd",
                            "confidence": 95})
    assert out is True, 'documents the trade-off; if this flips, the pad or the predicate changed'


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
        print(f"{fails} check(s) failed - TEMPLATE_ISSUER_REGION_PRESENCE regressed.")
        return 1
    print("All checks passed - the region confirm keeps the seed on positive evidence only.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
