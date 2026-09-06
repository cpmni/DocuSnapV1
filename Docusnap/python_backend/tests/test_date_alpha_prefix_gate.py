"""Date pattern ALNUM lookbehind — log review Item 3 (reggie + Oracle SIGN OFF W/COND, 2026-09-05).

Pelican 0023: `invoice_date` read `26-01-6000` @40 from `1/26/6000` — the TAIL of the reference
`PI/26/6000`. The shipped numeric date patterns forbade only a preceding DIGIT (`(?<!\\d)`), so an
unanchored search (keyword._clean_value / _validate, anchor._crop_is_credible) matched inside a
letter-prefixed code; dmy failed on month 26 and the MDY fallthrough produced a date. The fix is
the PATTERN: `(?<![A-Za-z0-9])` on both numeric patterns, trailing `(?!\\d)` untouched. Strictly
tighter — it can only newly REJECT. JS twin: database/modules/test_date_alpha_prefix_gate.js runs the
SAME vector file through `new RegExp(p, 'i')`.

Pins:
  1 the shipped patterns carry the alnum lookbehind (both numeric patterns), trailing guard intact
  2 shared vectors: accept / reject through keyword._validate (= re.search, the keyword site)
  3 _clean_value picks the REAL date past a code-shaped window ("P1/26/6000    26/01/2026")
  4 the exhibit is decisive: the OLD lookbehind (documented here) DID match "1/26/6000"
  5 the crop site (_crop_is_credible) agrees with the keyword site on every vector
  6 the named recall cost is deliberate: "l26/01/2026" -> not a date (review), never 26-01-2026

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_date_alpha_prefix_gate.py
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(HERE))

from extraction.keyword import _validate, _clean_value          # noqa: E402
from extraction.anchor import _crop_is_credible                 # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


cfg = json.load(io.open(os.path.join(ROOT, 'config', 'keyword_patterns.json'), encoding='utf-8'))
VAL = cfg['validation_patterns']
DATE = VAL['date']
vec = json.load(io.open(os.path.join(HERE, 'date_alpha_prefix_vectors.json'), encoding='utf-8'))

print('-- 1 the shipped patterns --')
numeric = [p for p in DATE if p.startswith('(?<!')]
check('exactly two numeric date patterns carry a lookbehind', len(numeric) == 2)
for p in numeric:
    check(f'alnum lookbehind: {p}', p.startswith('(?<![A-Za-z0-9])'))
    check(f'trailing (?!\\d) untouched: {p}', p.endswith('(?!\\d)'))
check('the month-name patterns are untouched (4 patterns total)', len(DATE) == 4)

print('-- 2 shared vectors through the keyword site (_validate == re.search) --')
for s in vec['accept']:
    check(f'ACCEPT {s!r}', _validate(s, DATE))
for s in vec['reject']:
    check(f'REJECT {s!r}', not _validate(s, DATE))

print('-- 3 _clean_value extracts the real date past a code-shaped window --')
check("'P1/26/6000    26/01/2026' -> '26/01/2026'",
      _clean_value('P1/26/6000    26/01/2026', 'date', VAL) == '26/01/2026')
check("'26/01/2026' unchanged", _clean_value('26/01/2026', 'date', VAL) == '26/01/2026')
check("'Date: 2026-01-26' -> '2026-01-26'", _clean_value('Date: 2026-01-26', 'date', VAL) == '2026-01-26')

print('-- 4 the exhibit is decisive: the OLD lookbehind matched inside the code --')
OLD = [r'(?<!\d)\d{4}[/\-]\d{2}[/\-]\d{2}(?!\d)', r'(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)']
old_hit = next((re.search(p, 'P1/26/6000', re.IGNORECASE) for p in OLD if re.search(p, 'P1/26/6000', re.IGNORECASE)), None)
check("OLD pattern matched '1/26/6000' inside 'P1/26/6000' (the bug)", old_hit is not None and old_hit.group(0) == '1/26/6000')
check("NEW pattern matches nothing in 'P1/26/6000'", not any(re.search(p, 'P1/26/6000', re.IGNORECASE) for p in DATE))

print('-- 5 the crop site agrees with the keyword site on every vector --')
for s in vec['accept']:
    check(f'crop ACCEPT {s!r}', _crop_is_credible(s, 'date', VAL))
for s in vec['reject']:
    check(f'crop REJECT {s!r}', not _crop_is_credible(s, 'date', VAL))

print('-- 6 the named recall cost is deliberate --')
check("'l26/01/2026' is NOT a date (reads empty -> review; never 26-01-2026)", not _validate('l26/01/2026', DATE))
check("…but a dash boundary still reads: 'REF-2026-01-26X'", _validate('REF-2026-01-26X', DATE))

print(f"\n{'FAILED: ' + str(fails) if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
