"""
test_name_relocate_disagreement.py — the NAME-RELOCATE DISAGREEMENT GUARD (slice 1, 2026-07-14;
gary-designed, Oracle-signed WITH CONDITIONS). Pins the pure predicate
`engine._name_relocate_should_hold`: a taught anchor's garbled RELOCATED name read must not beat a
CLEAN keyword name of the same field — keep the keyword + flag (cap <=69 + note → review).

Load-bearing pins (a future dev must not silently revert them and re-open the "comer Clinic" class):
  - INCIDENT: keyword "Fernbank Veterinary Clinic"(nq 1.0) vs relocate "comer Clinic"(nq 0.5) → HOLD.
  - ORACLE FLOOR: keyword clean-but-WRONG "Alpha Vets"(1.0) vs taught relocate "McConnell Kelly
    Solicitors"(0.667, mixed-case under-rated) → NOT held (the re-teach must still win Tier-A).
  - STRICT '<': equal-clean re-teach ("Alpha Vets" 1.0 vs "Beta Clinic" 1.0) → NOT held.
  - scope: supplier_name excluded; only a 'keyword' incumbent vs a relocate/inline candidate;
    rigid anchor_crop untouched; non-name fields untouched; kill switch.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_name_relocate_disagreement.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import _name_relocate_should_hold, _NAME_RELOCATE_NOTE, _cmp_norm

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond:
        fails += 1

def kw(v, conf=78):
    return {"value": v, "method": "keyword", "confidence": conf}

def relo(v, method="anchor_crop_relocated"):
    return {"value": v, "method": method}

def main():
    # ── INCIDENT: garbled relocate vs clean keyword name → HOLD ──────────────
    inc_kw, inc_re = kw("Fernbank Veterinary Clinic"), relo("comer Clinic")
    check("incident: 'comer Clinic' relocate held vs clean keyword",
          _name_relocate_should_hold(inc_kw, inc_re, "customer_name") is True)

    # the fired branch caps <=69 and carries a note (mirror the merge branch's effect)
    capped = min(int(inc_kw.get("confidence") or 0), 69)
    check("fired branch caps confidence <=69 (78 -> 69)", capped == 69)
    check("hold note is non-empty", bool(_NAME_RELOCATE_NOTE.strip()))

    # ── ORACLE FLOOR (BLOCKING pin): a legit mixed-case teach must NOT be demoted ──
    # keyword read a CLEAN-but-WRONG neighbour name (1.0); the user taught the CORRECT
    # "McConnell Kelly Solicitors" (0.667, interior capital under-rated). 0.667 >= 0.6 floor
    # → the guard ABSTAINS → the taught relocate wins its Tier-A. (Re-breaking this = the
    # "my teach never sticks" bug.)
    check("ORACLE FLOOR: taught 'McConnell Kelly Solicitors'(0.667) NOT held vs clean-wrong keyword",
          _name_relocate_should_hold(kw("Alpha Vets"), relo("McConnell Kelly Solicitors"),
                                     "customer_name") is False)

    # ── STRICT '<' : an equal-clean re-teach must win (not held) ─────────────
    check("equal-clean re-teach ('Beta Clinic' 1.0 vs 'Alpha Vets' 1.0) NOT held",
          _name_relocate_should_hold(kw("Alpha Vets"), relo("Beta Clinic"), "customer_name") is False)

    # ── AGREE → no-op (different case/spacing, same value) ───────────────────
    check("agree (case/space only) → not held",
          _name_relocate_should_hold(kw("Fernbank Veterinary Clinic"),
                                     relo("fernbank  veterinary clinic"), "customer_name") is False)
    check("_cmp_norm collapses case+ws for the agree check",
          _cmp_norm("Fernbank Veterinary Clinic") == _cmp_norm("fernbank  veterinary clinic"))

    # ── a CLEANER relocate over a garbled keyword → relocate should win (not held) ──
    check("cleaner relocate over garbled keyword → not held (keyword not clean)",
          _name_relocate_should_hold(kw("comer Clinic"), relo("Fernbank Veterinary Clinic"),
                                     "customer_name") is False)

    # ── scope / method pins ─────────────────────────────────────────────────
    check("rigid anchor_crop (not a relocate) → not held",
          _name_relocate_should_hold(inc_kw, relo("comer Clinic", method="anchor_crop"),
                                     "customer_name") is False)
    check("anchor_inline relocate method → held (same incident shape)",
          _name_relocate_should_hold(inc_kw, relo("comer Clinic", method="anchor_inline"),
                                     "customer_name") is True)
    check("supplier_name EXCLUDED (slice-1 scope) → not held",
          _name_relocate_should_hold(inc_kw, inc_re, "supplier_name") is False)
    check("non-name field (invoice_number) → not held",
          _name_relocate_should_hold(inc_kw, inc_re, "invoice_number") is False)
    check("incumbent is not a plain keyword read (anchor) → not held",
          _name_relocate_should_hold({"value": "Fernbank Veterinary Clinic", "method": "anchor"},
                                     inc_re, "customer_name") is False)
    check("empty relocate value → not held",
          _name_relocate_should_hold(inc_kw, relo(""), "customer_name") is False)
    check("empty keyword value → not held",
          _name_relocate_should_hold(kw(""), inc_re, "customer_name") is False)
    check("missing existing → not held",
          _name_relocate_should_hold(None, inc_re, "customer_name") is False)

    # ── custom name-like key (not just customer_name) ───────────────────────
    check("custom 'client_name' key held (is_name_like)",
          _name_relocate_should_hold(inc_kw, inc_re, "client_name") is True)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
