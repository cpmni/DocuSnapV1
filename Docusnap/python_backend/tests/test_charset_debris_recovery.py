#!/usr/bin/env python3
"""
tests/test_charset_debris_recovery.py

ANCHOR_CHARSET_DEBRIS (Oracle SIGN-OFF-WITH-CONDITIONS, 2026-07-27) — the learned-charset
bare-alnum debris arm in _recover_clean_token, built for the SuperStore 61-doc class: the
crop pad clips the neighbouring "#" caption glyph, it OCRs as "F", "F 33504" fails the
credibility gate, and the correct keyword read is then permanently capped 69 by the
taught-ownership guard ("taught position couldn't be confirmed").

Load-bearing pins (each with a POSITIVE CONTROL proving the pin can detect its bug —
Oracle C7 red-first):
  * DN pin: a scope whose confirmed history carries ANY letter NEVER strips letter debris
    (unanimity beats dominance — a real "F-14266" prefix must never be stripped).
  * Edge-contact: an INTERIOR letter token (real page content / format drift) never strips;
    only boundary-abutting debris (clipped-glyph physics) may.
  * Internal-never / glued-never: "F33504" is one token — refused; junk between two value
    fragments → ≥2 value tokens → refused.
  * Rigid-site-only: allow_alnum_debris=False (the registration call site) refuses letters.
  * Vector-refutation (Oracle C4): when the born-digital text layer prints the stripped
    token adjacent to the value ("F 14266"), _vector_refutes_strip fires → the caller caps
    +flags (never noteless, never tier 3). "#" adjacent → no refutation.
  * Kill OFF / cold scope / support<10 / has_space ⇒ byte-identical refusal.

Run:  py -3.12 python_backend/tests/test_charset_debris_recovery.py
Exit 0 = all checks passed.  Exit 1 = failure(s).
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from extraction.anchor import (_recover_clean_token, _vector_refutes_strip,
                               _alnum_debris_admissible)
from extraction.format_anomaly_checker import _derive_charset


def check(label: str, cond: bool) -> bool:
    print(f"  {'OK ' if cond else 'BAD'}  {label}")
    return cond


fails = 0

# The shipped alphanumeric validation pattern (config/keyword_patterns.json shape).
VPATS = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}

DIGIT_CS  = {'has_letter': False, 'has_digit': True, 'has_space': False, 'literals': set()}
LETTER_CS = {'has_letter': True,  'has_digit': True, 'has_space': False, 'literals': {'-'}}
ENTRY     = lambda cs, support=54: {'class': 'numeric', 'shapes': ['#####'], 'support': support, 'charset': cs}
LOOKUP    = lambda entry: (lambda fk: entry)
EDGE_L    = (True, False)
EDGE_R    = (False, True)

def rec(value, entry=None, edge=EDGE_L, allow=True, out=None):
    return _recover_clean_token(value, "alphanumeric", VPATS, None,
                                field_key="invoice_number",
                                format_lookup=(LOOKUP(entry) if entry else None),
                                edge_contact=edge, allow_alnum_debris=allow,
                                debris_out=out)

os.environ["ANCHOR_CHARSET_DEBRIS"] = "1"

print("\n§1 the incident: 'F 33504' on a digit-unanimous scope, edge-contact left")
out = {}
v = rec("F 33504", ENTRY(DIGIT_CS), out=out)
fails += not check(f"strips to '33504' (got {v!r})", v == "33504")
fails += not check("debris_out records [('F','left')] for the refutation check",
                   out.get('alnum') == [('F', 'left')])
fails += not check("trailing junk '33504 F' with right edge-contact strips too",
                   rec("33504 F", ENTRY(DIGIT_CS), edge=EDGE_R) == "33504")

print("\n§2 DN pin: a lettered-history scope NEVER strips letter debris (unanimity)")
fails += not check("'F 38472' on has_letter scope → refused",
                   rec("F 38472", ENTRY(LETTER_CS)) is None)
fails += not check("positive control: same read, letterless scope → strips (pin detects its bug)",
                   rec("F 38472", ENTRY(DIGIT_CS)) == "38472")

print("\n§3 edge-contact: interior letters are real content, never debris")
fails += not check("left junk without left ink-contact → refused",
                   rec("F 33504", ENTRY(DIGIT_CS), edge=EDGE_R) is None)
fails += not check("no edge metadata at all → refused",
                   rec("F 33504", ENTRY(DIGIT_CS), edge=None) is None)
fails += not check("positive control: with left contact → strips",
                   rec("F 33504", ENTRY(DIGIT_CS), edge=EDGE_L) == "33504")

print("\n§4 glued / internal / mixed — never touched")
fails += not check("glued 'F33504' (single token) → refused", rec("F33504", ENTRY(DIGIT_CS)) is None)
fails += not check("split value '335 F 04' → refused (not exactly one value token)",
                   rec("335 F 04", ENTRY(DIGIT_CS)) is None)
fails += not check("mixed token 'F3 3504' (in-charset digit inside junk) → refused",
                   rec("F3 3504", ENTRY(DIGIT_CS)) is None)
fails += not check("3+ char junk 'REF 33504' → refused (debris length bound)",
                   rec("REF 33504", ENTRY(DIGIT_CS)) is None)

print("\n§5 scope gates: cold / support boundary / has_space / kill switch / call site")
fails += not check("no learned entry → refused", rec("F 33504", None) is None)
fails += not check("support 9 → refused", rec("F 33504", ENTRY(DIGIT_CS, support=9)) is None)
fails += not check("support 10 → strips (the pinned boundary)",
                   rec("F 33504", ENTRY(DIGIT_CS, support=10)) == "33504")
sp = dict(DIGIT_CS); sp['has_space'] = True
fails += not check("space-bearing history → refused", rec("F 33504", ENTRY(sp)) is None)
fails += not check("registration site (allow_alnum_debris=False) → refused",
                   rec("F 33504", ENTRY(DIGIT_CS), allow=False) is None)
os.environ["ANCHOR_CHARSET_DEBRIS"] = "0"
fails += not check("kill switch OFF → refused (byte-identical)",
                   rec("F 33504", ENTRY(DIGIT_CS)) is None)
os.environ["ANCHOR_CHARSET_DEBRIS"] = "1"

print("\n§6 original punctuation arm untouched (regex-only, no history needed)")
fails += not check("'. = 317437' with NO entry still recovers",
                   rec(". = 317437", None, edge=None, allow=False) == "317437")
fails += not check("bare '2 317437' still refused without charset evidence",
                   rec("2 317437", None, edge=EDGE_L, allow=True) is None)

print("\n§7 vector-refutation (Oracle C4)")
ANCH = {"h_norm": 0.02}
LINES = lambda text: [{"text": text, "y_norm": 0.07, "h_norm": 0.02}]
# y0 = y_norm + h/2 = 0.08 matches the line centre band
fails += not check("'F 14266' printed in vector text → REFUTED",
                   _vector_refutes_strip("14266", [("F", "left")], ANCH, 0.07, LINES("F 14266")) is True)
fails += not check("'F-14266' (glued separator) → REFUTED",
                   _vector_refutes_strip("14266", [("F", "left")], ANCH, 0.07, LINES("Ref F-14266")) is True)
fails += not check("case-insensitive: vector 'f 14266' vs stripped 'F' → REFUTED",
                   _vector_refutes_strip("14266", [("F", "left")], ANCH, 0.07, LINES("f 14266")) is True)
fails += not check("'# 33504' (non-alnum chrome) → NOT refuted",
                   _vector_refutes_strip("33504", [("F", "left")], ANCH, 0.07, LINES("# 33504")) is False)
fails += not check("scanned page (no vector lines) → not refuted (tier 3 can't fire there anyway)",
                   _vector_refutes_strip("33504", [("F", "left")], ANCH, 0.07, None) is False)
fails += not check("wrong row (outside the taught band) → not refuted",
                   _vector_refutes_strip("14266", [("F", "left")], ANCH, 0.50, LINES("F 14266")) is False)

print("\n§8 charset derivation: unanimity over ALL raw confirmed values")
cs = _derive_charset(["12471", "29721", "33504"])
fails += not check("pure digits → has_letter False, has_digit True",
                   cs == {'has_letter': False, 'has_digit': True, 'has_space': False, 'literals': set()})
cs = _derive_charset(["12471", "2/259"])          # the live doc-1043 poison shape
fails += not check("one '/'-bearing value only adds the literal (letters stay excluded)",
                   cs['has_letter'] is False and cs['literals'] == {'/'})
cs = _derive_charset(["12471", "F-14266"])
fails += not check("ONE lettered confirm anywhere → has_letter True (arm disabled for the scope)",
                   cs['has_letter'] is True)
fails += not check("space-bearing value → has_space True",
                   _derive_charset(["AB 123"])['has_space'] is True)
fails += not check("empty input → None", _derive_charset([]) is None)

print("\n§9 admissibility unit seams")
fails += not check("admissible: 'F' left on digit scope with left contact",
                   _alnum_debris_admissible("F", "left", "invoice_number", LOOKUP(ENTRY(DIGIT_CS)), EDGE_L) is True)
fails += not check("format_lookup raising → refused (total function)",
                   _alnum_debris_admissible("F", "left", "invoice_number",
                                            (lambda fk: (_ for _ in ()).throw(RuntimeError())), EDGE_L) is False)
fails += not check("no charset key on entry → refused",
                   _alnum_debris_admissible("F", "left", "invoice_number",
                                            LOOKUP({'class': 'numeric', 'support': 54}), EDGE_L) is False)

print()
del os.environ["ANCHOR_CHARSET_DEBRIS"]
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("All charset-debris recovery checks passed.")
sys.exit(0)
