#!/usr/bin/env python3
"""tests/test_template_fixed_name_presence.py — pins TEMPLATE_FIXED_NAME_PRESENCE_VETO
(2026-07-31; gary + Oracle SIGN-OFF-W/COND): the UN-NAMED twin of BRANDING_NAMED_BLANK.

The Ironbridge-as-Copperfield class (live docs 171/173/180/181): a phash/keyword collision
seeds a Copperfield template's FROZEN fixed supplier (method 'template_fixed') on an
Ironbridge page. The rival can't be NAMED (a new supplier has no template bank), so the
un-named branding branch kept the wrong prefill at 69 — one confirm-keystroke from GT-poison.
The veto BLANKS the stamp when the stamped supplier reliably PRINTS its own name (the learned
supplier_prints_name ratio threaded via the templates payload — database/modules/templates.js
getAll / namePresence.supplierNamePresenceRatio) but the name is ABSENT from THIS page
(_template_identity_corroborated's >=60%-distinctive-token fuzzy check).

Fail-toward-keep at every doubt; destructive only behind the C2 text-sufficiency floor.

    py -3.12 tests/test_template_fixed_name_presence.py    (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction.engine import ExtractionEngine, _prints_name_stats

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


# Copperfield's branding fingerprint: 9 distinctive words INCLUDING the name tokens, so a page
# carrying only the printed name scores 2/9 ≈ 0.22 < _BRANDING_PRESENT_RATIO (0.25) and still
# reaches the un-named branch (own branding "absent") — the corroboration arm is then what keeps it.
COPPERFIELD_T = {
    "name": "Copperfield Electrical",
    "keyword_fingerprint": ["Copperfield", "Electrical", "Voltage", "Birmingham", "Powergrid",
                            "Substation", "Rewiring", "Transformer", "Switchgear"],
    "supplier_prints_name": {"supplier": "Copperfield Electrical", "ratio": 1.0, "count": 5},
}

# An Ironbridge PO page — Copperfield appears NOWHERE. First 6 lines carry >=10 tokens
# (the C2 issuer-band floor) and the page >=50 tokens (the C2 page floor).
IRONBRIDGE_PAGE = (
    "Ironbridge Fabrication\n"
    "Foundry Yard, Coalport Road\n"
    "Telford TF8 7HT\n"
    "T 01952 433016\n"
    "PURCHASE ORDER\n"
    "Order No. PO-18233  Order Date 14/12/2026\n"
    "Supplier\nHalcyon Leisure Group\nThe Pavilion, Marine Parade\nTorquay TQ2 5TR\n"
    "Description Unit Qty Amount\n"
    "Timber batten 2.4m 103.53 20 2070.60\n"
    "Primer 5L 214.01 26 5564.26\n"
    "Steel plate 6mm 238.50 1 238.50\n"
    "Cable 2.5mm twin 83.46 2 166.92\n"
    "Insulation roll 227.79 26 5922.54\n"
    "Fixings box of 100 64.23 21 1348.83\n"
    "Net Total GBP 15311.65\nVAT 20 percent GBP 3062.33\nOrder Total GBP 18373.98\n"
)

# The SAME page but genuinely Copperfield-issued (name printed) — corroboration must keep it.
COPPERFIELD_PAGE = IRONBRIDGE_PAGE.replace("Ironbridge Fabrication", "Copperfield Electrical")

# A genuine Copperfield doc whose letterhead OCR'd to mush — the PINNED trade-off class: the
# name tokens are unreadable (>40% garbled → corroboration fails) but the page text is rich.
DEGRADED_COPPERFIELD_PAGE = IRONBRIDGE_PAGE.replace(
    "Ironbridge Fabrication", "C0pperf1eld E1ectr1cal")

# Thin page — below the 50-token page floor → UNJUDGEABLE → veto must abstain (flag-only keep).
THIN_PAGE = "Copper Works\nGeneric delivery note\nItems one box two crates three pallets"

# A rival WITH a bank on the page → the NAMED branch runs instead (BRANDING_NAMED_BLANK
# territory) — this file pins that the new code leaves that branch alone.
THORNBURY_T = {"name": "Thornbury Fasteners",
               "keyword_fingerprint": ["Thornbury", "Fasteners", "Bay", "Severn", "Trading",
                                       "Estate", "Bristol", "Quayside", "Forge"]}
THORNBURY_PAGE = (
    "Thornbury Fasteners\nBay 12, Severn Trading Estate\nBristol BS35 1RY\n"
    "Quayside Forge Works\nPURCHASE ORDER\nOrder No. PO-99120  Order Date 01/03/2026\n"
    "Description Unit Qty Amount\nBolt M8 pack 12.10 4 48.40\nWasher pack 3.30 2 6.60\n"
    "Nut M8 pack 4.10 3 12.30\nAnchor sleeve 9.90 1 9.90\nScrew box 7.75 2 15.50\n"
    "Net Total GBP 92.70\nVAT GBP 18.54\nOrder Total GBP 111.24\n"
)


class FakeSelf:
    def __init__(self, accepted=None):
        self.accepted_issuers = set(accepted or [])
    _accept_norm = staticmethod(lambda v: " ".join(str(v or "").strip().lower().split()))


def run(supplier, page, templates=None, method="template_fixed", conf=95):
    results = {"supplier_name": {"value": supplier, "confidence": conf, "method": method},
               "_needs_review": False}
    tmpls = templates if templates is not None else [COPPERFIELD_T]
    ExtractionEngine._flag_branding_conflict(FakeSelf(), results, supplier, tmpls, page)
    return results


def blanked(r):
    f = r["supplier_name"]
    return (f.get("value") is None and int(f.get("confidence") or 0) == 0
            and r.get("_supplier_name", "sentinel") is None
            and r.get("_needs_review") is True
            and "couldn't be confirmed" in (f.get("validation_note") or ""))


def kept_flagged(r, value="Copperfield Electrical"):
    f = r["supplier_name"]
    return (f.get("value") == value and int(f.get("confidence") or 0) <= 69
            and r.get("_needs_review") is True
            and bool((f.get("validation_note") or "").strip()))


print("§1 THE VETO — un-named collision stamp, name-printing supplier, name absent → BLANK:")
r = run("Copperfield Electrical", IRONBRIDGE_PAGE)
check("doc-171 shape: value None + conf 0 + _supplier_name None + needs_review + veto note",
      blanked(r))
check("note still routes the renderer's branding flag (ends 'confirm the correct company')",
      "confirm the correct company" in (r["supplier_name"].get("validation_note") or ""))
check("PIN: NO suggested_supplier on the un-named veto (a one-click wrong answer must never arm)",
      "suggested_supplier" not in r["supplier_name"])

print("\n§2 Fail-toward-keep abstains (each keeps today's flag+69, value untouched):")
check("name IS on the page (corroborated) → kept + flagged @<=69",
      kept_flagged(run("Copperfield Electrical", COPPERFIELD_PAGE)))
low_ratio = dict(COPPERFIELD_T, supplier_prints_name={"supplier": "Copperfield Electrical",
                                                      "ratio": 0.5, "count": 5})
check("prints-name ratio 0.5 < 0.80 (genuinely name-less supplier class) → kept",
      kept_flagged(run("Copperfield Electrical", IRONBRIDGE_PAGE, templates=[low_ratio])))
young = dict(COPPERFIELD_T, supplier_prints_name={"supplier": "Copperfield Electrical",
                                                  "ratio": 1.0, "count": 2})
check("sample count 2 < 3 (young supplier) → kept",
      kept_flagged(run("Copperfield Electrical", IRONBRIDGE_PAGE, templates=[young])))
check("thin page (< C2 text floor — unjudgeable, never 'name absent') → kept",
      kept_flagged(run("Copperfield Electrical", THIN_PAGE)))
no_stats = {k: v for k, v in COPPERFIELD_T.items() if k != "supplier_prints_name"}
check("PIN backward-compat: payload WITHOUT supplier_prints_name (old JS) → kept, byte-identical",
      kept_flagged(run("Copperfield Electrical", IRONBRIDGE_PAGE, templates=[no_stats])))
check("PIN: method template_fixed_locked (deliberate admin intent) → kept, flag-only",
      kept_flagged(run("Copperfield Electrical", IRONBRIDGE_PAGE, method="template_fixed_locked")))
check("method logo (not a frozen stamp) → kept",
      kept_flagged(run("Copperfield Electrical", IRONBRIDGE_PAGE, method="logo")))

print("\n§3 Kill switch:")
os.environ["TEMPLATE_FIXED_NAME_PRESENCE_VETO"] = "0"
try:
    check("TEMPLATE_FIXED_NAME_PRESENCE_VETO=0 → kept (byte-identical to pre-fix)",
          kept_flagged(run("Copperfield Electrical", IRONBRIDGE_PAGE)))
finally:
    del os.environ["TEMPLATE_FIXED_NAME_PRESENCE_VETO"]

print("\n§4 The NAMED branch is untouched (BRANDING_NAMED_BLANK territory):")
r = run("Copperfield Electrical", THORNBURY_PAGE, templates=[COPPERFIELD_T, THORNBURY_T])
note = r["supplier_name"].get("validation_note") or ""
check("rival nameable → the NAMED branch runs (note names 'Thornbury Fasteners'), never the "
      "un-named veto note ('couldn't be confirmed')",
      "Thornbury Fasteners" in note and "couldn't be confirmed" not in note)

print("\n§5 PIN THE ACCEPTED TRADE-OFF — genuine supplier, degraded letterhead:")
# A real Copperfield doc whose name OCR'd to mush blanks to review instead of keeping the 69
# prefill. BOTH outcomes are review-bound; only the prefill + learning scope differ. A future dev
# "restoring the prefill to reduce review typing" re-opens the collision GT-poison vector — this
# test must fail if they do.
check("degraded genuine doc → BLANK + review (the pinned trade-off, not a bug)",
      blanked(run("Copperfield Electrical", DEGRADED_COPPERFIELD_PAGE)))

print("\n§6 _prints_name_stats parsing:")
stats = _prints_name_stats([COPPERFIELD_T], FakeSelf._accept_norm)
check("keyed by _accept_norm, (ratio, count) tuple",
      stats.get("copperfield electrical") == (1.0, 5))
check("malformed/missing entries skipped, never throw",
      _prints_name_stats([{"supplier_prints_name": {"supplier": "", "ratio": 1}},
                          {"supplier_prints_name": "junk"}, {}, None],
                         FakeSelf._accept_norm) == {})

print()
if fails:
    print(f"{fails} CHECK(S) FAILED")
    sys.exit(1)
print("ALL CHECKS PASSED")
