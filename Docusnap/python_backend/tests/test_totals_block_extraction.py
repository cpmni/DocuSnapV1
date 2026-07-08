#!/usr/bin/env python3
"""
Synthetic 'scanned invoice' totals-block extraction tests.

Covers the Total-vs-Subtotal label ambiguity ("total" ⊂ "sub**total**") and thousands-group
preservation, across the ways OCR reads a scanned totals block: colons present OR dropped,
right-aligned OR left-aligned amounts, and a floated totals block where Subtotal sits NEARER
the Total anchor's taught position than the real Total row (so ONLY the label score — not
proximity — can pick correctly). The fix strips the taught label's edge caption punctuation
so the word-boundary guard in _label_score is robust to however OCR read the colon.

Deterministic: uses the born-digital text-layer locate (_locate_in_text_lines) so the same
label-selection + harvest logic runs with no OCR flakiness. Values mirror a real SuperStore
invoice (Subtotal $2,318.11 / Total $2,150.86).

Usage: py -3.12 python_backend/tests/test_totals_block_extraction.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import anchor
from extraction.template_mapper import _label_score, _normalise

fails = []
def check(name, got, exp):
    ok = got == exp
    print(f"  {'OK ' if ok else 'FAIL'} {name}" + ("" if ok else f"  got={got!r} exp={exp!r}"))
    if not ok: fails.append(name)
def check_true(name, cond):
    print(f"  {'OK ' if cond else 'FAIL'} {name}")
    if not cond: fails.append(name)


def _line(text, y, words):
    xs = [w[1] for w in words]
    x0 = min(xs); x1 = max(w[1] + w[2] for w in words)
    return {"text": text, "x_norm": x0, "y_norm": y, "w_norm": x1 - x0, "h_norm": 0.012,
            "words": [{"text": t, "x_norm": x, "y_norm": y, "w_norm": w, "h_norm": 0.012} for (t, x, w) in words]}

# A floated totals block: SUBTOTAL sits at y=0.500, TOTAL just below at y=0.528. Right-aligned
# amounts in a far column (x~0.82). Two label variants — colons kept, and colons dropped by OCR.
def block(colon, xlab=0.10, xval=0.82):
    c = ":" if colon else ""
    return [
        _line(f"Subtotal{c} $2,318.11", 0.500, [("Subtotal" + c, xlab, 0.11), ("$2,318.11", xval, 0.12)]),
        _line(f"Discount{c} $231.81",   0.514, [("Discount" + c, xlab, 0.11), ("$231.81",   xval, 0.10)]),
        _line(f"Total{c} $2,150.86",    0.528, [("Total" + c,    xlab, 0.07), ("$2,150.86", xval, 0.12)]),
    ]

# Total anchor taught NEAR the Subtotal row (cy=0.508) — proximity favours Subtotal, so a
# correct pick can only come from the label score.
TOTAL_VBOX    = (0.88, 0.508, 0.12, 0.012)   # cx, cy, vw, vh
SUBTOTAL_VBOX = (0.88, 0.500, 0.12, 0.012)

def harvest(label, direction, vbox, lines):
    loc = anchor._locate_for_relocation(object(), label, direction, vbox, page_text_lines=[dict(l) for l in lines])
    return (loc or {}).get("inline_value"), (loc or {}).get("matched_text")


print("1) Core label-score robustness (scanned strings, colon present AND dropped):")
for h, exp in [("total: 2150.86", 1.0), ("subtotal: 2318.11", 0.0),
               ("total 2150.86", 1.0), ("subtotal 2318.11", 0.0)]:
    check(f"score('Total:', {h!r})", _label_score("total:", _normalise(h)), exp)

print("\n2) Colons PRESENT - Total anchor must NOT grab the (nearer) Subtotal row:")
iv, mt = harvest("Total:", "right", TOTAL_VBOX, block(colon=True))
check("Total anchor harvests the Total value", iv, "$2,150.86")
check_true("...and matched the Total line, not Subtotal", mt is not None and "subtotal" not in mt.lower())
iv2, _ = harvest("Subtotal:", "right", SUBTOTAL_VBOX, block(colon=True))
check("Subtotal anchor harvests the Subtotal value", iv2, "$2,318.11")

print("\n3) Colons DROPPED by OCR - the fragile case (used to tie 0.83 -> wrong row):")
iv3, mt3 = harvest("Total:", "right", TOTAL_VBOX, block(colon=False))
check("Total anchor STILL harvests the Total value (colon-robust)", iv3, "$2,150.86")
check_true("...still didn't fall onto Subtotal", mt3 is not None and "subtotal" not in mt3.lower())

print("\n4) Left-aligned amounts (value right after the label):")
iv4, _ = harvest("Total:", "right", (0.30, 0.508, 0.12, 0.012), block(colon=True, xval=0.24))
check("left-aligned Total value harvested", iv4, "$2,150.86")

print("\n5) Thousands group preserved (no '$2,' truncation):")
check_true("Total value keeps its thousands group", iv3 and "2,150" in iv3)
check_true("Subtotal value keeps its thousands group", iv2 and "2,318" in iv2)

if fails:
    print(f"\n{len(fails)} FAILED"); sys.exit(1)
print("\nAll synthetic totals-block extraction checks passed.")
