"""test_issuer_repair.py — TEMPLATE_FIXED_ISSUER_REPAIR pins (2026-08-09).

Run: py -3.12 python_backend/tests/test_issuer_repair.py

WHAT THIS PINS. When a template has matched, its curated issuer name must not be displaced by a read
that is either the SAME name misread or not a company name at all. Measured on 135 template-matched
documents: 93 read the curated name exactly, 42 did not — 15 an OCR garble of it, 27 metadata (a
date line, a registration code, a page heading). The app already printed the answer — "Letterhead
may read 'Castellan Security Systems' — detected 'DATE 14-03-2026 Job Ref JB-8887'" — and then asked
the operator to confirm what it had itself worked out.

THE INVARIANT THIS MUST NOT BREAK, and it is why the similarity floor exists rather than a blanket
"keep the curated name": a genuinely DIFFERENT company must still displace the seed, so a stale
fixed_value can always be corrected by re-teaching. Measured separation is enormous — a garble of
the same name scores 0.75-0.92, a different company 0.00-0.17 — so 0.75 sits in open space and is
not a tuned constant. If a future change narrows that gap, these pins fail.

SCOPE: supplier_name only (post-mig-44 COMPANY_KEYS), and only ever a DECLINE — the curated seed is
kept with its `template_fixed` method, which is what the branding and presence vetoes key on. This
is not an authority flip.
"""
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))

from extraction import name_match as nm            # noqa: E402

CASES = []
def case(fn):
    CASES.append(fn)
    return fn

IRONCLAD  = 'Ironclad Tool Hire'
CASTELLAN = 'Castellan Security Systems'
SILVER    = 'Silverbeck Cleaning Supplies'


@case
def test_garbles_of_the_same_name_are_recognised():
    """Every one of these was read live off a document whose template curates the name on the right."""
    for read, cur in [('lronciad Tool Hire', IRONCLAD), ('Iranclad Tool H', IRONCLAD),
                      ('onciad Tool Hire -', IRONCLAD), ('ronciad Tool Hire', IRONCLAD),
                      ('lronciad Tool Hir', IRONCLAD), ('lronciad Tool Hit', IRONCLAD),
                      ('siiverbeck Cleaning Supplie', SILVER)]:
        assert nm.garbled_identity(read, cur) is True, f'{read!r} vs {cur!r} not recognised'


@case
def test_a_genuinely_different_company_still_wins():
    """THE LOAD-BEARING PIN. If this fails, a supplier whose name legitimately changed can never be
    corrected by re-teaching, and the curated value is frozen forever."""
    for read in ('Bramblewood Joinery Ltd', 'Pelican Office Interiors', 'Meadowvale Dairy Wholesale'):
        assert nm.garbled_identity(read, CASTELLAN) is False, f'{read!r} must displace the seed'
        assert nm.is_not_an_issuer_read(read, CASTELLAN) is False, f'{read!r} is a real company name'


@case
def test_short_real_company_names_are_never_touched():
    """name_quality was rejected for this job because it scores 'BP' and '3M' at 0.0. Neither
    predicate may demote a genuinely short company name."""
    for read in ('BP', '3M', 'IBM'):
        assert nm.garbled_identity(read, CASTELLAN) is False
        assert nm.is_not_an_issuer_read(read, CASTELLAN) is False


@case
def test_metadata_reads_are_recognised_as_not_an_issuer():
    """A company name carries no printed date and no run of 4+ digits — mechanical, no lexicon."""
    for read in ('DATE 14-03-2026 Job Ref JB-8887', 'DATE 17-07-2025 Job Ref JB-5530',
                 'GB 651 0027 84', 'Reg No GB 8214456'):
        assert nm.is_not_an_issuer_read(read, CASTELLAN) is True, f'{read!r} should be metadata'


@case
def test_a_name_bearing_an_address_number_is_not_metadata():
    """PRECISION: small digits are ordinary in real company names and addresses."""
    for read in ('Unit 4 Trading Ltd', '3M United Kingdom PLC', 'A1 Motors'):
        assert nm.is_not_an_issuer_read(read, CASTELLAN) is False, f'{read!r} wrongly called metadata'


@case
def test_nothing_fires_without_a_substantial_curated_name():
    """A template that knows nothing must never license a repair."""
    for cur in ('', 'AB', 'Xy'):
        assert nm.garbled_identity('lronciad Tool Hire', cur) is False
        assert nm.is_not_an_issuer_read('DATE 14-03-2026', cur) is False


@case
def test_the_separation_between_the_two_classes_stays_wide():
    """The floor is only defensible while the gap is wide. Pin the measured separation itself, so a
    change that erodes it fails here rather than in production."""
    worst_garble = min(nm.similar_identity(r, IRONCLAD)
                       for r in ('lronciad Tool Hire', 'Iranclad Tool H', 'onciad Tool Hire -'))
    best_different = max(nm.similar_identity(r, CASTELLAN)
                         for r in ('Bramblewood Joinery Ltd', 'Pelican Office Interiors'))
    assert worst_garble >= 0.75, f'a real garble scored {worst_garble:.2f}, below the floor'
    assert best_different <= 0.40, f'a different company scored {best_different:.2f} — too close'
    assert worst_garble - best_different > 0.3, 'the two classes are no longer clearly separated'


@case
def test_off_is_byte_identical():
    """The predicates are pure; the SWITCH decides whether they are consulted. Assert the flag is
    read at the decline site and defaults OFF."""
    src = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
    assert "os.environ.get('TEMPLATE_FIXED_ISSUER_REPAIR', '0')" in src, 'flag not read / not default OFF'
    assert '_FIXED_ISSUER_REPAIR_ON' in src and "return 'garbled'" in src and "return 'not_issuer'" in src


if __name__ == '__main__':
    failed = 0
    for fn in CASES:
        try:
            fn(); print(f'  PASS  {fn.__name__}')
        except AssertionError as e:
            failed += 1; print(f'  FAIL  {fn.__name__}: {e}')
        except Exception as e:                                    # noqa: BLE001
            failed += 1; print(f'  ERROR {fn.__name__}: {type(e).__name__}: {e}')
    print(f'\n{len(CASES) - failed}/{len(CASES)} passed')
    sys.exit(1 if failed else 0)
