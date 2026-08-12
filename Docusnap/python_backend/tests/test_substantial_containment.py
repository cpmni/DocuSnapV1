"""tests/test_substantial_containment.py — the containment-witness predicate (reggie spec,
owner-directed 2026-08-12). SHIPS INERT — no consumer; these pins define the contract before any
consumer slice (which carries its own flag and its own "genuine disagreement still flags" pin).

True ⇔ the CLEAN reading is witnessed inside the DIRTY reading as "the same name plus junk".
Rules pinned: token-level; 1-token cleans refuse (equality only — 'Ltd'/'BP' are values, not
witnesses); equality refuses (that's _cmp_norm's claim); contiguous in-order slice; majority alnum
mass; the SURPLUS must fail name-likeness (nested REAL names — 'Office Interiors' ⊂ 'Pelican
Office Interiors' — must never corroborate).

Run: py -3.12 python_backend/tests/test_substantial_containment.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extraction.engine import substantial_containment as sc          # noqa: E402

FAILURES = []


def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name}  {detail}')
        FAILURES.append(name)


print('1. The exhibit — garble prefix + same name')
check("'Bramblewood Joinery Ltd' ⊂ 'ne ay - Bramblewood Joinery Ltd' → True",
      sc('Bramblewood Joinery Ltd', 'ne ay - Bramblewood Joinery Ltd') is True)
check('per-token edge punctuation tolerated',
      sc('Bramblewood Joinery Ltd', 'ne ay - Bramblewood, Joinery Ltd.') is True)

print('2. Trivial/equality refusals')
check("1-token clean refuses ('Ltd')", sc('Ltd', 'ne ay Bramblewood Joinery Ltd') is False)
check("1-token clean refuses ('BP')", sc('BP', 'BP Group Holdings') is False)
check('identical values refuse (equality, not containment)',
      sc('Bramblewood Joinery Ltd', 'Bramblewood Joinery Ltd') is False)
check('empty/None refuse', sc('', 'anything at all') is False and sc(None, None) is False)

print('3. Order/contiguity')
check('reordered tokens refuse',
      sc('Bramblewood Joinery Ltd', 'Joinery Bramblewood Ltd xx') is False)
check('interleaved junk inside the span refuses',
      sc('Bramblewood Joinery Ltd', 'Bramblewood XX Joinery Ltd') is False)

print('4. Substantiality + surplus-junk (the precision clauses)')
check("nested REAL names refuse ('Office Interiors' ⊂ 'Pelican Office Interiors')",
      sc('Office Interiors', 'Pelican Office Interiors') is False)
check('name buried in a long junk paragraph refuses (minority mass)',
      sc('Bramblewood Joinery Ltd',
         'xq zzt vv qq ww ee rr tt yy uu Bramblewood Joinery Ltd aa bb cc dd ee ff gg hh') is False)

print()
if FAILURES:
    print(f'{len(FAILURES)} FAILED')
    sys.exit(1)
print('ALL PASS')
