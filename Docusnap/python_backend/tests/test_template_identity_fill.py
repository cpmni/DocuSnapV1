"""
test_template_identity_fill.py — the TEMPLATE-IDENTITY SUPPLIER FILL (2026-07-14; gary-designed,
Oracle SIGN-OFF WITH CONDITIONS). Pins the pure helper `engine._template_identity_for_fill`: when a
template matched (keyword fingerprint) but the supplier is UNRESOLVED (flaky logo drifted out of
range), fill the supplier from the template's DOMINANT CONFIRMED issuer so its taught anchors admit —
but ALWAYS review-bound (a persisted note), never a silent auto-file of an inferred identity.

Load-bearing pins a future dev must NOT silently revert:
  - ORACLE BLOCKING: BOTH tiers carry a non-empty note (the majority tier must NOT be made
    silently-auto-fileable by dropping the note — that is the wrong-folder / scope-poison hole).
  - AMBIGUOUS plurality (count==1, total>1) → None (never fill an arbitrary tie).
  - NEVER reads matched_tmpl['name'] (cosmetic first-confirmed name can be a garble/postcode) — only
    the dominant_supplier distribution.
  - Implausible-shaped identity ("IN", "36552") → None.
  - Strict majority: count*2 > total (a 2-of-4 tie is NOT a majority).

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_template_identity_fill.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import (_template_identity_for_fill,
                               _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE,
                               _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY)
from extraction import keyword

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond:
        fails += 1

def tmpl(dominant=None, count=None, total=None, name=None):
    d = {}
    if dominant is not None: d["dominant_supplier"] = dominant
    if count is not None:    d["dominant_supplier_count"] = count
    if total is not None:    d["dominant_supplier_total"] = total
    if name is not None:     d["name"] = name
    return d

def main():
    # ── MAJORITY tier: >=2 confirms, strict majority ─────────────────────────
    r = _template_identity_for_fill(tmpl("Acme Ltd", 3, 4))
    check("majority: 3/4 → tier 'majority'", r is not None and r["tier"] == "majority")
    check("majority: value is the dominant issuer", r and r["value"] == "Acme Ltd")
    check("majority: note is the MAJORITY note", r and r["note"] == _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY)

    # ── SINGLE tier: exactly one unanimous confirm (the doc-#2 fix) ───────────
    s = _template_identity_for_fill(tmpl("Acme Ltd", 1, 1))
    check("single: 1/1 → tier 'single'", s is not None and s["tier"] == "single")
    check("single: note is the SINGLE note", s and s["note"] == _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE)

    # ── ORACLE BLOCKING: BOTH tiers are review-bound (non-empty note) ─────────
    check("BLOCKING pin: majority note is non-empty (never silent auto-file)",
          bool(_TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY.strip()))
    check("BLOCKING pin: single note is non-empty",
          bool(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE.strip()))
    check("both notes distinct (honest source copy per tier)",
          _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE != _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY)

    # ── AMBIGUOUS plurality: count==1 but total>1 → None (never fill a tie) ───
    check("ambiguous: 1/2 → None (never fill an arbitrary plurality)",
          _template_identity_for_fill(tmpl("Acme Ltd", 1, 2)) is None)
    check("ambiguous: 2/5 (not strict majority) → None",
          _template_identity_for_fill(tmpl("Acme Ltd", 2, 5)) is None)

    # ── STRICT-majority boundary: count*2 > total ────────────────────────────
    check("boundary: 2/4 (tie, 4>4 False) → None",
          _template_identity_for_fill(tmpl("Acme Ltd", 2, 4)) is None)
    check("boundary: 2/3 (4>3 True) → majority",
          (_template_identity_for_fill(tmpl("Acme Ltd", 2, 3)) or {}).get("tier") == "majority")

    # ── ZERO / missing distribution ──────────────────────────────────────────
    check("zero confirms 0/0 → None", _template_identity_for_fill(tmpl("Acme Ltd", 0, 0)) is None)
    check("empty dominant_supplier → None", _template_identity_for_fill(tmpl("", 1, 1)) is None)
    check("None template → None", _template_identity_for_fill(None) is None)
    check("missing count/total fields → None", _template_identity_for_fill(tmpl("Acme Ltd")) is None)

    # ── Garbage count/total (non-int) swallowed → None (try/except both) ──────
    check("garbage count → None", _template_identity_for_fill(tmpl("Acme Ltd", "x", 1)) is None)
    check("garbage total → None", _template_identity_for_fill(tmpl("Acme Ltd", 1, "y")) is None)

    # ── PLAUSIBILITY gate: implausible shapes rejected ───────────────────────
    check("implausible 'IN' (real plausibility test) → None",
          _template_identity_for_fill(tmpl("IN", 3, 3)) is None)
    check("implausible '36552' → None",
          _template_identity_for_fill(tmpl("36552", 3, 3)) is None)
    check("sanity: 'DOCUMENT SOLUTIONS' IS plausible",
          keyword._is_plausible_supplier_name("DOCUMENT SOLUTIONS") is True)

    # ── NEVER reads matched_tmpl['name'] (garble/postcode) — only dominant ────
    # A template NAMED with a plausible-looking value but whose confirmed distribution is empty must
    # NOT fall back to the name. dominant empty → None regardless of a plausible name.
    check("never uses name: plausible name but empty dominant → None",
          _template_identity_for_fill(tmpl("", 1, 1, name="Northgate Textiles")) is None)
    # A postcode name with NO dominant → None (pins we never impose the cosmetic name).
    check("never uses name: postcode name 'BT23 1BE', no dominant → None",
          _template_identity_for_fill(tmpl(None, None, None, name="BT23 1BE")) is None)

    print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
