#!/usr/bin/env python3
"""
tests/test_freetext_guard_parity.py
-----------------------------------
Pins TEMPLATE_FREETEXT_GUARD_PARITY and its blocking companion TEMPLATE_FREETEXT_FALLTHROUGH_CAP
(gary design, Oracle SIGN-OFF-W/COND 2026-08-08). Both DEFAULT OFF; both OFF is byte-identical.

THE DEFECT. `_gate_value`'s OCR-debris guard and name-quality guard arm on `if not val_type`, while
the sibling confidence cap in `_mapping_result` uses `val_type in (None,'text','multiline_text')`.
Six SHIPPED keys carry a truthy free-text validation in config/keyword_patterns.json —
supplier_name, customer_name, payment_terms, buyer_name ('text'), supplier_address,
customer_address ('multiline_text') — so those BUILT-IN keys skip both guards while every CUSTOM
free-text field (val_type None) gets them. The protection runs backwards, which is the exact
inverse of "custom fields must detect the same way as built-in ones".

And `value_quality.is_name_like_field` fires on precisely supplier_name / customer_name /
buyer_name / *_address, so the name-quality guard is DEAD FOR ITS ENTIRE INTENDED POPULATION at
Stage 0.5 while anchor.py applies the same rule to the same keys at Stage 2.

THE COMPANION. Rejecting at the absolute rung hands the field to derived rungs, and `_inline()` and
`_read_registration` build results with no ocr_conf, so the free-text cap cannot fire there — a
garbled read capped at ~50 today (visible in review) would re-commit at 90 unflagged. The cap keeps
such a value below the critical floor and notes it. Guard parity must NOT be flipped without it.

Usage: py -3.12 python_backend/tests/test_freetext_guard_parity.py
Exit 0 = pins hold, 1 = regression.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


def section(t):
    print(f"\n{t}")


def _reload(**env):
    """Re-import the module with the given switch state — the flags are module-level constants."""
    for k in ('TEMPLATE_FREETEXT_GUARD_PARITY', 'TEMPLATE_FREETEXT_FALLTHROUGH_CAP'):
        os.environ.pop(k, None)
    for k, v in env.items():
        os.environ[k] = v
    # importlib.reload, NOT `del sys.modules[...]` + re-import: the `extraction` package object
    # keeps its own `template_mapper` attribute, so a plain re-import hands back the STALE module
    # and every armed assertion below silently tests the dark code. (Found the hard way.)
    import importlib
    from extraction import template_mapper as tm
    return importlib.reload(tm)


# Values chosen by MEASURING value_quality.name_quality, not by eye — the first draft of this file
# used a string that scores exactly 0.500 against a `< 0.5` guard and therefore does NOT reject.
#   'aan EE ..... 4 4.3 Fs . J... .'  -> 0.000  (also caught earlier, by the debris guard)
#   '504 Ald Unkesand Band 20|0U0U'   -> 0.400  (the class the code comments cite)
#   'pantionahe MUGS Liu COTVCE'      -> 0.500  BOUNDARY: kept, because the guard is strict `<`
#   'Northgate Supplies Ltd'          -> 0.667  (a real name, must survive)
#   'Vellum & Crane Stationers'       -> 1.000
DEBRIS = "aan EE ..... 4 4.3 Fs . J... ."
GARBLE = "504 Ald Unkesand Band 20|0U0U"
BOUNDARY = "pantionahe MUGS Liu COTVCE"
GOOD = "Northgate Supplies Ltd"
VP = {"alphanumeric": [r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"]}


def gate(tm, text, val_type, field_key):
    return tm._gate_value(text, val_type, field_key, VP, None, shape_mode='ignore')[0]


section("OFF — the legacy predicate, byte-identical (the six shipped keys stay unguarded)")
tm = _reload()
check("OFF: _ft_regime(None) is True (unchanged)", tm._ft_regime(None) is True)
check("OFF: _ft_regime('text') is False — this IS the defect, pinned",
      tm._ft_regime('text') is False)
check("OFF: _ft_regime('multiline_text') is False", tm._ft_regime('multiline_text') is False)
check("OFF: debris on a text-typed supplier_name COMMITS (the bug reproduces)",
      gate(tm, DEBRIS, 'text', 'supplier_name') == DEBRIS)
check("OFF: garbled name (nq 0.400) on a text-typed customer_name COMMITS",
      gate(tm, GARBLE, 'text', 'customer_name') == GARBLE)
check("OFF: the SAME debris on a CUSTOM field (val_type None) is REJECTED — the inversion",
      gate(tm, DEBRIS, None, 'supplier_name') is None)

section("ARMED — parity restored: the built-in keys are guarded like the custom ones")
tm = _reload(TEMPLATE_FREETEXT_GUARD_PARITY='1')
check("ARMED: _ft_regime('text') is True", tm._ft_regime('text') is True)
check("ARMED: _ft_regime('multiline_text') is True", tm._ft_regime('multiline_text') is True)
check("ARMED: debris on a text-typed supplier_name is REJECTED",
      gate(tm, DEBRIS, 'text', 'supplier_name') is None)
check("ARMED: garbled name on a text-typed customer_name is REJECTED",
      gate(tm, GARBLE, 'text', 'customer_name') is None)
check("ARMED: garbled multiline_text customer_address is REJECTED",
      gate(tm, GARBLE, 'multiline_text', 'customer_address') is None)
check("ARMED: a GOOD company name is still kept (the guard must not over-reach)",
      gate(tm, GOOD, 'text', 'supplier_name') == GOOD)
# PIN the guard BOUNDARY, measured not assumed: name_quality is compared with a strict `<`, so a
# value scoring exactly 0.5 is KEPT. Pinned so nobody "tightens" it to `<=` without meaning to —
# that would start rejecting borderline real names.
check("ARMED: a value scoring exactly 0.5 is KEPT (strict `<`, boundary pinned)",
      gate(tm, BOUNDARY, 'text', 'customer_name') == BOUNDARY)
check("ARMED: a custom field (val_type None) is unchanged — still rejected",
      gate(tm, DEBRIS, None, 'supplier_name') is None)

section("ARMED — the guard must not reach a TYPED field, and must not reach non-name keys")
check("ARMED: an alphanumeric value is untouched by the free-text guards",
      gate(tm, 'PO-48009', 'alphanumeric', 'po_number') == 'PO-48009')
for vt in ('date', 'currency', 'alphanumeric', 'reference_code', 'job_reference'):
    check(f"ARMED: _ft_regime({vt!r}) is False — typed fields keep their own regex",
          tm._ft_regime(vt) is False)
# name-quality is name-like-keys only; a non-name free-text key must keep a plain short value.
check("ARMED: 'Net 30' on payment_terms is KEPT (guard B is name-like keys only)",
      gate(tm, 'Net 30', 'text', 'payment_terms') == 'Net 30')

section("PIN — the free-text set must stay EQUAL to _mapping_result's confidence-cap set")
# The whole defect was these two sets disagreeing. A future dev who fixes one and leaves the other
# recreates it, so assert them equal rather than asserting each separately.
CAP_SET = (None, 'text', 'multiline_text')
for vt in CAP_SET:
    check(f"PIN armed: _ft_regime({vt!r}) matches the cap set membership", tm._ft_regime(vt) is True)
for vt in ('date', 'currency', 'alphanumeric', 'reference_code', 'job_reference', 'currency_code'):
    check(f"PIN armed: _ft_regime({vt!r}) is False, and the cap set excludes it too",
          tm._ft_regime(vt) is False and vt not in CAP_SET)

section("FALL-THROUGH CAP — Oracle's blocking precondition for the flag above")
tm = _reload()
r = {"value": "X", "confidence": 90, "method": "template_mapping", "anchor": "a"}
check("cap OFF: a free-text derived result is untouched (byte-identical)",
      tm._ft_fallthrough_cap(dict(r), 'text')["confidence"] == 90
      and not tm._ft_fallthrough_cap(dict(r), 'text').get("validation_note"))

tm = _reload(TEMPLATE_FREETEXT_FALLTHROUGH_CAP='1')
capped = tm._ft_fallthrough_cap(dict(r), 'text')
check(f"cap ARMED: free-text 90 is held to {tm._FT_FALLTHROUGH_CAP}",
      capped["confidence"] == tm._FT_FALLTHROUGH_CAP)
check("cap ARMED: below the 88 critical-field floor, so it cannot ride into an auto-file",
      capped["confidence"] < 88)
check("cap ARMED: carries a review note", bool(str(capped.get("validation_note") or "").strip()))
check("cap ARMED: a TYPED value is untouched",
      tm._ft_fallthrough_cap(dict(r), 'alphanumeric')["confidence"] == 90)
low = {"value": "X", "confidence": 55, "method": "m", "anchor": "a"}
check("cap ARMED: never RAISES an already-lower confidence",
      tm._ft_fallthrough_cap(dict(low), 'text')["confidence"] == 55)
noted = {"value": "X", "confidence": 90, "method": "m", "anchor": "a",
         "validation_note": "an existing note"}
check("cap ARMED: never REPLACES an existing note",
      tm._ft_fallthrough_cap(dict(noted), 'text')["validation_note"] == "an existing note")
check("cap ARMED: None result is passed through", tm._ft_fallthrough_cap(None, 'text') is None)

for k in ('TEMPLATE_FREETEXT_GUARD_PARITY', 'TEMPLATE_FREETEXT_FALLTHROUGH_CAP'):
    os.environ.pop(k, None)

print()
if fail:
    print(f"{fail} FAILED")
    sys.exit(1)
print("ALL PASS")
