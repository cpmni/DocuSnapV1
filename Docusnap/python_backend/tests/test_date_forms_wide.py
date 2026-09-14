#!/usr/bin/env python3
"""
tests/test_date_forms_wide.py
-----------------------------
date_forms_wide (mig 167, 2026-09-14; reggie design -> Oracle): the MONTH-NAME date family accepts any single
separator (, . / \\ - or none), an ordinal on the day, a trailing dot on the month, "Sept", a 2- or 4-digit year and
OCR-glued forms — in validator.parse_date when DATE_FORMS_WIDE is on. Numeric dates are NOT widened (the month
name is the guard). OFF must be byte-identical to the pre-change behaviour.

The vectors are SHARED with the JS twins (date_forms_vectors.json — filing/handler.js normaliseDate pin +
the review/teach surface pin), so every surface produces the same DD-MM-YYYY for the same input.

Usage: py -3.12 python_backend/tests/test_date_forms_wide.py
Exit 0 = every vector holds under both switch states; 1 = a gap.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
from extraction import validator  # noqa: E402

V = json.loads((HERE / "date_forms_vectors.json").read_text(encoding="utf-8"))
fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def fmt(d):
    return d.strftime("%d-%m-%Y") if d else None


print("-- OFF (default): byte-identical — the wide-only vectors stay as before, the rest already parsed --")
validator.DATE_FORMS_WIDE = False
for v in V["accept"]:
    got = fmt(validator.parse_date(v["in"]))
    if v["python_off"]:
        check(f"OFF already parsed {v['in']!r} -> {v['out']}", got == v["out"])
    else:
        check(f"OFF does NOT parse the wide-only {v['in']!r} (byte-identical)", got != v["out"])
for s in V["refuse_py"]:
    check(f"OFF refuses {s!r}", validator.parse_date(s) is None)

print("-- ON: every accept vector parses to the shared canonical output; every refuse vector stays refused --")
validator.DATE_FORMS_WIDE = True
for v in V["accept"]:
    check(f"ON {v['in']!r} -> {v['out']}", fmt(validator.parse_date(v["in"])) == v["out"])
for s in V["refuse_py"]:
    check(f"ON refuses {s!r}", validator.parse_date(s) is None)
# The guard: numeric dates are NOT widened — a free 3-token rule would take these; the month name is required.
for s in ["23 08 2026", "23,08,2026", "23\\08\\2026"]:
    check(f"ON: a NUMERIC date with a non-date separator is NOT widened (the month name is the guard): {s!r}", validator.parse_date(s) is None)

print("-- the switch is read from the environment at import, like the other DARK switches --")
src = (HERE.parent / "extraction" / "validator.py").read_text(encoding="utf-8")
check("DATE_FORMS_WIDE = os.environ.get('DATE_FORMS_WIDE', '0') != '0'", "DATE_FORMS_WIDE = os.environ.get('DATE_FORMS_WIDE', '0') != '0'" in src)
check("the wide rule runs ONLY under the flag and only rebuilds a month-name form", "if DATE_FORMS_WIDE:\n        wide = _wide_month_form(s)" in src)
asrc = (HERE.parent / "extraction" / "anchor.py").read_text(encoding="utf-8")
check("anchor._crop_is_credible merges config `date_wide` only for dates and only under the flag", 'if val_type == "date" and _DATE_FORMS_WIDE:' in asrc and '.get("date_wide")' in asrc)
validator.DATE_FORMS_WIDE = False

print()
print("ALL OK" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
