"""test_fixed_seed_agreement.py — pins for TEMPLATE_FIXED_SEED_AGREEMENT_KEEP.

Run: py -3.12 python_backend/tests/test_fixed_seed_agreement.py

THE DEFECT. When the Stage-0.5 mapping read is EXACTLY the curated `fixed_value`, the merge still
lets the read displace the seed: same string, lower confidence, different method. Measured on the
issuer arm — four documents keep a CORRECT company name and move `template_fixed`@95 ->
`template_mapping`@78, and all four drop out of the >=88 band for it. Reading the same name a second
time is CORROBORATION; today it is charged as a refinement.

WHAT THESE PINS DEFEND
  • EXACT equality only. Inexact agreement belongs to the near-match / fragment / garbled branches,
    which exist to JUDGE it; widening this one would silently swallow their jurisdiction and their
    flags' measured trade-offs.
  • The disagreement branches keep working, and keep their own names — an armed 'agreement' must
    never mask a 'near_match'/'garbled'/'not_issuer' verdict, because those names are what the log
    line and the trace event report.
  • A genuinely different company still displaces the seed. This is not an authority flip; the
    re-teach escape hatch must survive.
  • OFF is byte-identical: the branch returns None and the read is applied exactly as today.

THE SEAM, pinned so it cannot be forgotten: keeping the seed keeps `method == 'template_fixed'`,
which is what TEMPLATE_FIXED_NAME_PRESENCE_VETO (a guard that can BLANK the supplier),
BRANDING_NAMED_BLANK, and the branding note/cap all key on EXACTLY. So this flag ARMS a destructive
guard on every taught document whose issuer reads correctly. The plausible safety argument — the
name was read off this page, so an absence test must pass — is an argument, not proof: a crop read
and the full-page PSM-3 text can disagree. The corpus gate counts BLANKED suppliers, not just lane
scores, and that is deliberate.
"""
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

import importlib                                              # noqa: E402
from extraction import engine as E                            # noqa: E402

CASES = []
def case(fn):
    CASES.append(fn)
    return fn


def _arm(**flags):
    """The engine reads its switches at IMPORT time, so an arm re-imports and uses the RETURN."""
    for k, v in flags.items():
        if v:
            os.environ[k] = '1'
        else:
            os.environ.pop(k, None)
    return importlib.reload(E)


SEED = {"method": "template_fixed", "value": "Castellan Security Systems", "confidence": 95}


def _verdict(mod, read, seed=SEED):
    return mod._fixed_seed_declines_mapping('supplier_name', dict(seed), {"value": read})


# ── the headline ─────────────────────────────────────────────────────────────────────────────────
@case
def test_off_lets_the_agreeing_read_through():
    """OFF twin. Without it the correct name arrives from the mapping tier and the seed's 95 is
    lost — the behaviour this flag exists to change, asserted so the ON case proves something."""
    mod = _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=False)
    assert _verdict(mod, SEED["value"]) is None, 'OFF must be byte-identical'


@case
def test_armed_exact_agreement_keeps_the_seed():
    mod = _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=True)
    assert _verdict(mod, SEED["value"]) == 'agreement', 'the read equals the confirmed name — keep the seed'


@case
def test_locked_seed_is_covered_too():
    """`template_fixed_locked` is deliberate admin intent and is in `_FIXED_SEED_METHODS`; an
    agreeing read must not quietly downgrade THAT either."""
    mod = _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=True)
    seed = {"method": "template_fixed_locked", "value": SEED["value"], "confidence": 95}
    assert _verdict(mod, SEED["value"], seed) == 'agreement'


# ── exactness, and the neighbouring branches' jurisdiction ───────────────────────────────────────
@case
def test_inexact_agreement_is_NOT_this_branch():
    """A one-glyph misread is `near_match`'s business (and only when THAT flag is armed). If this
    pin ever goes green through the agreement branch, this flag has absorbed a decision that was
    measured, conditioned and signed off separately."""
    mod = _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=True,
               TEMPLATE_FIXED_NEAR_MATCH_RECONCILE=False,
               TEMPLATE_FIXED_FRAGMENT_DECLINE=False, TEMPLATE_FIXED_ISSUER_REPAIR=False)
    for near in ('Castellan Security System:', 'castellan security systems',
                 'Castellan  Security Systems', 'Castellan Security Systems '):
        assert _verdict(mod, near) is None, f'{near!r} is not EXACT agreement'


@case
def test_disagreement_branches_keep_their_own_names():
    mod = _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=True, TEMPLATE_FIXED_NEAR_MATCH_RECONCILE=True,
               TEMPLATE_FIXED_ISSUER_REPAIR=True)
    assert _verdict(mod, 'Castellan Security System:') == 'near_match', 'near-match verdict was masked'
    assert _verdict(mod, 'DATE 14-03-2026 Job Ref JB-8887') == 'not_issuer', 'not-issuer verdict was masked'


@case
def test_a_different_company_still_displaces_the_seed():
    """THE INVARIANT. `fixed_value` does not become authoritative: the recipient block, or a genuinely
    new sender, still wins — which is what keeps re-teaching a working cure for a stale seed."""
    mod = _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=True, TEMPLATE_FIXED_NEAR_MATCH_RECONCILE=True,
               TEMPLATE_FIXED_FRAGMENT_DECLINE=True, TEMPLATE_FIXED_ISSUER_REPAIR=True)
    assert _verdict(mod, 'Bramblewood Joinery Ltd') is None


# ── scope ────────────────────────────────────────────────────────────────────────────────────────
@case
def test_scoped_to_supplier_name_and_to_a_curated_seed():
    mod = _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=True)
    assert mod._fixed_seed_declines_mapping('customer_name', dict(SEED),
                                            {"value": SEED["value"]}) is None, \
        'customer_name is legitimately variable — never governed by a fixed value'
    assert mod._fixed_seed_declines_mapping(
        'supplier_name', {"method": "template_mapping", "value": SEED["value"], "confidence": 90},
        {"value": SEED["value"]}) is None, 'only a curated template_fixed/_locked seed is kept'


@case
def test_empty_sides_are_still_inert():
    mod = _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=True)
    assert _verdict(mod, '') is None, 'an empty read is not agreement'
    assert mod._fixed_seed_declines_mapping('supplier_name',
                                            {"method": "template_fixed", "value": ""},
                                            {"value": ""}) is None, 'two empties are not agreement'


def main():
    fails = 0
    for fn in CASES:
        try:
            fn()
            print(f"  OK  {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"  BAD {fn.__name__}: {e}")
    _arm(TEMPLATE_FIXED_SEED_AGREEMENT_KEEP=False, TEMPLATE_FIXED_NEAR_MATCH_RECONCILE=False,
         TEMPLATE_FIXED_FRAGMENT_DECLINE=False, TEMPLATE_FIXED_ISSUER_REPAIR=False)
    if fails:
        print(f"{fails} check(s) failed - TEMPLATE_FIXED_SEED_AGREEMENT_KEEP regressed.")
        return 1
    print("All checks passed - exact agreement keeps the seed; every other verdict is untouched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
