#!/usr/bin/env python3
"""
Guards validator.arith_witness_misread_total + ExtractionEngine._flag_singlechar_reconcile_misread —
the DEFAULT-OFF arithmetic-witness single-digit total misread FLAG (RECON_SINGLECHAR_MISREAD_FLAG).

THE DEFECT (pendingfeatures.md ~1310, the ONLY wrong-value money auto-file in 1,076 corpus docs):
#464 Nordwind prints Total (inc VAT) £2,363.76; the pipeline commits 2,368.76 (a single 3->8), which
balances subtotal 1969.80 + tax 393.96 = 2363.76 only through the 2% tolerance (delta £5 << tol £47.38)
-> reconciles True -> no note -> would auto-file WRONG.

THE PINS (gary -> Oracle SIGN-OFF-W/COND 2026-09-23):
 - #464 fires; a correct total NEVER fires (penny-scale rounding, or a combo that balances exactly).
 - BOTH subtotal AND tax must parse (never default tax to 0) — abstain otherwise (Oracle C3).
 - single-digit substitution ONLY (comparator == 1); 2-digit / transposition / different-length -> None.
 - FLAG-never-adopt: value unchanged, no corrected_to, conf capped (the trade-off lock).
 - the note is NEUTRAL/SYMMETRIC and is NOT a class-F verification-doubt mark (class F is ON by default,
   so a doubt-clear must never lift this hold) — Oracle C2.
 - OFF => byte-identical.

Run: py -3.12 python_backend/tests/test_arith_witness_misread.py   (exit 0 = pass)
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.validator import arith_witness_misread_total as awm
from extraction.suffix_reconcile import digit_substitution_diff

fails = []
def check(label, cond):
    if not cond:
        fails.append(label)
    print(f"  {'OK ' if cond else 'BAD'} {label}")

def res(sub=None, tax=None, ship=None, disc=None):
    r = {}
    if sub is not None:  r['subtotal'] = {'value': sub}
    if tax is not None:  r['vat_tax']  = {'value': tax}
    if ship is not None: r['shipping'] = {'value': ship}
    if disc is not None: r['discount'] = {'value': disc}
    return r

print("arith_witness_misread_total — the predicate:")
# ── the load-bearing catch ──
def near(x, v):
    return x is not None and abs(x - v) < 0.005
check("#464 fires -> computed 2363.76", near(awm("2368.76", res("1969.80", "393.96")), 2363.76))
check("#464 comparator == 1",           digit_substitution_diff("2368.76", "2363.76") == 1)
check("#464 with GBP/commas parses",    near(awm("£2,368.76", res("£1,969.80", "£393.96")), 2363.76))

# ── a correct total NEVER fires ──
check("penny rounding +0.01 -> None",   awm("120.01", res("100.00", "20.00")) is None)
check("penny rounding +0.02 -> None",   awm("120.02", res("100.00", "20.00")) is None)
check("pence single-char 0.03 (<min_delta) -> None", awm("120.03", res("100.00", "20.00")) is None)
check("exact total -> None",            awm("120.00", res("100.00", "20.00")) is None)
# a combo balancing to the penny protects a correct total that neighbours another combo
check("correct-via-shipping not flagged", awm("125.00", res("100.00", "20.00", "5.00")) is None)

# ── witnesses required (Oracle C3: both subtotal AND tax) ──
check("no tax -> abstain (None)",       awm("2368.76", res("1969.80", None)) is None)
check("no subtotal -> abstain (None)",  awm("2368.76", res(None, "393.96")) is None)
check("non-numeric tax -> abstain",     awm("2368.76", res("1969.80", "n/a")) is None)

# ── out of band / out of shape ──
check("running balance (delta > tol) -> None", awm("500.00", res("100.00", "20.00")) is None)
check("two-digit diff in band -> None", awm("2411.00", res("2000.00", "400.00")) is None)   # computed 2400.00, 2 diffs
check("transposition in band -> None",  awm("2386.76", res("1969.80", "393.96")) is None)   # vs 2363.76: 2 diffs

# ── a single-digit tens/units misread in band DOES fire ──
check("tens-place £40 single digit fires", awm("2440.00", res("2000.00", "400.00")) == 2400.00)

# ── the neutral note is NOT a class-F verification-doubt mark (Oracle C2) ──
try:
    from extraction.engine import _SINGLECHAR_MISREAD_NOTE, _is_verification_doubt_note
    rendered = _SINGLECHAR_MISREAD_NOTE.format("2368.76", "1969.80", "393.96", "2363.76")
    check("note is NOT a class-F doubt mark", _is_verification_doubt_note(rendered) is False)
    check("note names BOTH numbers (symmetric)", "2368.76" in rendered and "2363.76" in rendered)
    check("note makes no directional 'should be' claim", "should be" not in rendered.lower())
except ImportError:
    check("engine note constants importable (wired)", False)

# ── Method-level wiring pins (_flag_singlechar_reconcile_misread) ──
import extraction.engine as engine_mod
from extraction.engine import ExtractionEngine

class _Stub:
    """Duck-typed self — the method only touches results, validator, keyword aliases, and _t."""
    def __init__(self): self.traces = []
    def _t(self, ev, **kw): self.traces.append((ev, kw))

FIELDS = [{"key": "total_amount", "type": "currency"},
          {"key": "subtotal", "type": "currency"}, {"key": "vat_tax", "type": "currency"}]

def run_method(flag_on, results, credit_expected=None):
    prev = engine_mod.RECON_SINGLECHAR_MISREAD_FLAG
    engine_mod.RECON_SINGLECHAR_MISREAD_FLAG = flag_on
    try:
        ExtractionEngine._flag_singlechar_reconcile_misread(_Stub(), results, FIELDS, credit_expected)
    finally:
        engine_mod.RECON_SINGLECHAR_MISREAD_FLAG = prev

def n464():
    return {"total_amount": {"value": "2368.76", "confidence": 90, "method": "anchor_inline"},
            "subtotal":     {"value": "1969.80", "confidence": 88, "method": "keyword"},
            "vat_tax":      {"value": "393.96",  "confidence": 88, "method": "keyword"}}

print("\n_flag_singlechar_reconcile_misread — the method:")
# flag ON: #464 -> capped + noted, value UNCHANGED (the flag-not-adopt trade-off lock)
res = n464(); run_method(True, res); t = res["total_amount"]
check("ON: value UNCHANGED (never swapped/adopted)", t["value"] == "2368.76")
check("ON: no corrected_to (never adopts)",          not t.get("corrected_to"))
check("ON: confidence capped to 50",                 t["confidence"] == 50)
check("ON: note names BOTH numbers",
      "2368.76" in (t.get("validation_note") or "") and "2363.76" in (t.get("validation_note") or ""))

# flag OFF: byte-identical
res2 = n464(); run_method(False, res2)
check("OFF: untouched (no cap, no note)",
      res2["total_amount"]["confidence"] == 90 and not res2["total_amount"].get("validation_note"))

# one-note guard (Oracle C5): an already-noted total is left alone (no double-cap)
res3 = n464(); res3["total_amount"]["validation_note"] = "a prior arm spoke"; run_method(True, res3)
check("one-note guard: already-noted total not re-capped",
      res3["total_amount"]["confidence"] == 90 and res3["total_amount"]["validation_note"] == "a prior arm spoke")

if fails:
    print(f"\nFAILED ({len(fails)}): " + "; ".join(fails))
    sys.exit(1)
print("\nAll arith-witness pins passed.")
