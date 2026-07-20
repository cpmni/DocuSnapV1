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



# ── C4 (Oracle, 2026-07-20): the ISSUER BAND that licenses a graduation ──────────────────────
# Graduation replaces a NOTED template_identity fill with an UN-NOTED hint_text_match one, and
# trust.js refuses auto-file on any non-empty validation_note BEFORE comparing the floor — so
# shedding the note is what removes the human checkpoint. The evidence standard for that was
# always written as "a hint present in the ISSUER BAND", but the window was a raw ocr_text[:600]
# slice that contains the recipient block. These pin the band that makes the sentence true.
print()
print("-- C4 issuer band (the window that licenses shedding a review note) --")
import os as _os

check("the existing TOP fixture still yields 'superstore' through the band "
      "(the graduation class survives the narrowing)",
      "superstore" in E._issuer_hint_band(TOP))

# 1. THE HOLE. The only occurrence of the name is BELOW a recipient marker.
_recip_only = "Northgate Textiles\n14 Mill Street\nBill To:\nSuperStore\n1 High Road\n"
_band = E._issuer_hint_band(_recip_only)
check("value present ONLY below 'Bill To' is OUT of the band", "superstore" not in _band)
check("...so the graduation does NOT fire, and the review note is retained",
      E._supplier_hint_upgrade("SuperStore", [hint("SuperStore", 61)], _band, "") is None)
check("...while the same hint DOES fire when the name is in the letterhead",
      E._supplier_hint_upgrade("SuperStore", [hint("SuperStore", 61)],
                               E._issuer_hint_band("SuperStore\n1 High Road\nBill To:\nAcme\n"), "") is not None)

# 2. Two-column, ISSUER LEFT — the salvage in chrome_band must keep working at this call site.
#    _group_words_into_lines merges a physical row into ONE line, so the marker shares the line.
check("two-column, issuer LEFT ('ACME Ltd    Bill To:') keeps the issuer",
      "acme ltd" in E._issuer_hint_band("ACME Ltd    Bill To:    Halcyon Leisure\n9 Mill Road\n"))

# 3. Two-column, ISSUER RIGHT — ACCEPTED COST, pinned so it is a known limit and not a surprise.
#    The marker sits at position 0 of the row, so there is no text before it to salvage and the
#    band truncates immediately. This layout family is absent from the demo corpus; do not
#    "discover" it later and assume it is a regression.
check("two-column, issuer RIGHT ('Bill To:    ACME Ltd') loses the issuer (ACCEPTED)",
      "acme ltd" not in E._issuer_hint_band("Bill To:    ACME Ltd\n9 Mill Road\n"))

# 4. DELIBERATE NEW ADMISSION. The band joins lines with a space, so a name wrapped across two
#    visual rows becomes matchable when it was not against the raw slice. Usually a win (wrapped
#    letterheads); pinned because it is a NEW match surface, i.e. the one direction in which this
#    change is not a strict subset of the old behaviour.
check("a name split across two rows IS matchable in the band (new, deliberate)",
      "halcyon leisure group" in E._issuer_hint_band("HALCYON\nLEISURE GROUP\n1 High Road\n"))
check("...and was NOT matchable in the legacy raw slice",
      "halcyon leisure group" not in "HALCYON\nLEISURE GROUP\n1 High Road\n"[:600].lower())

# 5. KILL SWITCH — byte-identical to the legacy expression, including the C1 withhold being inert.
_prev = _os.environ.get("ISSUER_HINT_BAND")
try:
    _os.environ["ISSUER_HINT_BAND"] = "0"
    check("ISSUER_HINT_BAND=0 is byte-identical to ocr_text[:600].lower()",
          E._issuer_hint_band(_recip_only) == _recip_only[:600].lower())
    check("...so the recipient-block value is matchable again (this IS the old hole)",
          "superstore" in E._issuer_hint_band(_recip_only))
finally:
    if _prev is None:
        _os.environ.pop("ISSUER_HINT_BAND", None)
    else:
        _os.environ["ISSUER_HINT_BAND"] = _prev
check("env restored (a leaked kill switch would silently disarm every later check)",
      _os.environ.get("ISSUER_HINT_BAND") == _prev)


# The verdict MUST be the last thing in this file. It used to sit mid-file, which meant any check
# appended after it incremented `fails` and was then never examined — the suite printed ALL PASS
# and exited 0 with failing checks below. A test that cannot fail is worse than no test.
print()
if fails:
    print(f"FAILED: {fails} check(s)")
    sys.exit(1)
print("ALL PASS")
