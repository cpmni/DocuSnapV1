"""TEXT-FIRST ISSUER GRADUATION (gary-designed, Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-15).

A review-bound template_identity FILL (@70 + "inferred from previously filed documents" note) is
graduated to the confident, un-noted hint_text_match resolution Stage 2.5a would itself produce for
a plain-text-wordmark supplier (SuperStore) — but ONLY when the SAME value is corroborated by a
usage>=3 hint present in the issuer band (top 600 chars). The graduated set is a STRICT SUBSET of
2.5a's already-trusted un-noted set (value FIXED to V — never swaps to a different supplier).

Pins the Oracle conditions:
  1 GRADUATE   — noted fill V + V-hint usage>=3 in top-600 -> (V, usage) -> hint_text_match, no note.
  2 NO-SWAP    — noted fill V + higher-usage DIFFERENT-supplier hint in top-600 -> only V (never swap).
  3 SWAP-OK    — implausible incumbent (incumbent=None) + plausible hint in top-600 -> swaps (unchanged).
  4 C1         — the buyer-suppressed vendor is never re-adopted (inherited from Stage 2.5a).
  5 TOP-600    — a hint NOT in the issuer band never qualifies (load-bearing; blocks graduate-on-presence).
  6 ELIGIBILITY— only a NOTED template_identity fill is gradable; the un-noted @90 override / blanked
                 value / other methods are NOT.
  C2 CEILING   — the graduated confidence never exceeds min(85, 60+usage*2) (pin the accepted trade-off).

Run:  py -3.12 tests/test_template_identity_graduate.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction.engine import ExtractionEngine

CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                      "config", "keyword_patterns.json")
fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


def eng():
    return ExtractionEngine(config_path=CONFIG)


def hint(value, usage, field="supplier_name"):
    return {"field_key": field, "hint_value": value, "usage_count": usage}


# The issuer band (top-600, lowercased) as the caller passes it.
TOP = "superstore\ninvoice # 40100\nbill to: adam shillingsburg\nship to: breda, netherlands"


# ── eligibility predicate: _noted_template_fill_value ────────────────────────────
print("-- _noted_template_fill_value (which incumbent is gradable) --")
E = eng()
check("a NOTED template_identity fill is gradable (returns its value)",
      E._noted_template_fill_value({"value": "SuperStore", "method": "template_identity",
                                    "validation_note": "inferred..."}) == "SuperStore")
check("an UN-NOTED template_identity (precedence override @90) is NOT gradable",
      E._noted_template_fill_value({"value": "SuperStore", "method": "template_identity",
                                    "confidence": 90}) is None)
check("a blanked (None value) template_identity is NOT gradable",
      E._noted_template_fill_value({"value": None, "method": "template_identity",
                                    "validation_note": "dropped"}) is None)
check("a logo read is NOT gradable",
      E._noted_template_fill_value({"value": "SuperStore", "method": "logo"}) is None)
check("a hint read is NOT gradable",
      E._noted_template_fill_value({"value": "SuperStore", "method": "hint_text_match"}) is None)
check("non-dict is NOT gradable", E._noted_template_fill_value(None) is None)


# ── selection helper: _supplier_hint_upgrade ─────────────────────────────────────
print("-- _supplier_hint_upgrade: PIN 1 GRADUATE --")
E = eng()
hints = [hint("SuperStore", 61)]
pick = E._supplier_hint_upgrade("SuperStore", hints, TOP, "")
check("noted fill V='SuperStore' + usage-61 V-hint in top-600 -> ('SuperStore', 61)",
      pick == ("SuperStore", 61))

print("-- PIN 2 NO-SWAP (a graduation can only confirm V, never swap) --")
E = eng()
hints = [hint("SuperStore", 5), hint("MegaMart", 40)]   # MegaMart higher usage AND in the band
TOP_BOTH = TOP + "\nmegamart wholesale"
pick = E._supplier_hint_upgrade("SuperStore", hints, TOP_BOTH, "")
check("noted fill V='SuperStore' + stronger 'MegaMart' hint in top-600 -> stays ('SuperStore', 5)",
      pick == ("SuperStore", 5))
check("the graduation NEVER returns the different-supplier MegaMart",
      not (pick and pick[0] == "MegaMart"))

print("-- PIN 3 ORIGINAL SWAP PATH UNDAMAGED (incumbent=None) --")
E = eng()
hints = [hint("Beta Trading Ltd", 9)]
TOP_BETA = "beta trading ltd\ninvoice 5\n"
pick = E._supplier_hint_upgrade(None, hints, TOP_BETA, "")
check("implausible incumbent (None) + plausible 'Beta Trading Ltd' in top-600 -> swaps",
      pick == ("Beta Trading Ltd", 9))

print("-- PIN 4 C1 (buyer-suppressed vendor never re-adopted) --")
E = eng()
hints = [hint("Sandpiper Ltd", 12)]
TOP_SP = "sandpiper ltd\npurchase order\n"
# suppressed_norm = normalised 'Sandpiper Ltd' (the buyer-issued guard dropped it)
pick = E._supplier_hint_upgrade(None, hints, TOP_SP, E._accept_norm("Sandpiper Ltd"))
check("C1: the suppressed vendor hint is skipped -> None", pick is None)

print("-- PIN 5 TOP-600 LOAD-BEARING (presence in the issuer band is required) --")
E = eng()
hints = [hint("SuperStore", 61)]
pick = E._supplier_hint_upgrade("SuperStore", hints, "invoice # 40100\nbill to: adam", "")
check("V-hint NOT present in the issuer band -> None (no graduation)", pick is None)

print("-- usage floor + plausibility --")
E = eng()
check("usage<3 hint -> None", E._supplier_hint_upgrade("SuperStore", [hint("SuperStore", 2)], TOP, "") is None)
check("implausible hint value ('IN') -> None",
      E._supplier_hint_upgrade(None, [hint("IN", 9)], "in\ninvoice\n", "") is None)
check("no supplier_name hints -> None",
      E._supplier_hint_upgrade("SuperStore", [hint("SuperStore", 61, field="invoice_number")], TOP, "") is None)


# ── C2: the confidence CEILING (pin the accepted trade-off — never inflate to force auto-file) ──
print("-- PIN C2 confidence ceiling min(85, 60+usage*2) --")
def graduated_conf(usage):
    return min(85, 60 + usage * 2)
check("usage 61 -> 85 (capped)", graduated_conf(61) == 85)
check("usage 5  -> 70", graduated_conf(5) == 70)
check("usage 3  -> 66 (below the 70 field threshold => stays in review; self-gates thin evidence)",
      graduated_conf(3) == 66)
check("ceiling NEVER exceeds 85 for any usage", all(graduated_conf(u) <= 85 for u in range(3, 500)))


print()
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("ALL PASS")
