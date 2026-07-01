"""
Guard test for anchor._pick_unambiguous_supplier — the logo-match ambiguity guard.

A wrong supplier is worse than none (it mis-scopes every per-supplier learning corpus
and files under the wrong company), and compute_logo_hash is a colour-blind 64-bit
greyscale phash, so near-identical marks land only a few hamming apart. The winner is
trusted ONLY when it clears the confidence gate AND is at least LOGO_AMBIGUITY_MARGIN
closer than the next DIFFERENT supplier; otherwise → None (defer to keyword/template/
review). No image or real OCR needed — the decision is a pure function of the per-
supplier distances.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extraction import anchor  # noqa: E402
from extraction.anchor import _pick_unambiguous_supplier as pick, LOGO_AMBIGUITY_MARGIN as M  # noqa: E402

fail = 0
def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1

def sup(**kv):  # {name: dist} -> {name: {'dist':dist,'match_count':1}}
    return {k: {"dist": v, "match_count": 1} for k, v in kv.items()}

print(f"_pick_unambiguous_supplier (margin={M}):")

# Decisive win — winner far closer than any other supplier → accepted (unchanged behaviour).
r = pick(sup(Acme=2, Bolt=20))
check("decisive win -> winner accepted", r and r["supplier_name"] == "Acme")

# Near-tie with a DIFFERENT supplier → fail safe (None), even though the winner alone
# would clear the confidence gate. This is the wrong-company class the guard kills.
check("near-tie (diff 2) -> None", pick(sup(Acme=2, Bolt=4)) is None)
check("near-tie (diff 3) -> None", pick(sup(Acme=2, Bolt=5)) is None)

# Exactly at the margin is NOT ambiguous (reject only when strictly closer than margin).
r = pick(sup(Acme=2, Bolt=6))
check("separation == margin -> accepted", r and r["supplier_name"] == "Acme")

# Single supplier can never be ambiguous.
r = pick(sup(Acme=5))
check("single supplier -> accepted", r and r["supplier_name"] == "Acme")

# Confidence gate (dist<=6 => 100-dist*6 >= 60) still applies.
check("dist 7 fails the confidence gate -> None", pick(sup(Acme=7)) is None)
r = pick(sup(Acme=6))
check("dist 6 passes the gate (single) -> accepted", r and r["confidence"] == 64)

# A close runner-up that is a WORSE supplier still blocks a gate-passing winner.
check("gate-passing winner but ambiguous -> None", pick(sup(Acme=2, Bolt=3)) is None)

# Empty / no suppliers.
check("empty -> None", pick({}) is None)

# Three suppliers: only the SECOND-closest matters for the tie test.
check("3 suppliers, clear winner -> accepted",
      (pick(sup(Acme=1, Bolt=9, Cog=12)) or {}).get("supplier_name") == "Acme")
check("3 suppliers, top two tied -> None", pick(sup(Acme=1, Bolt=2, Cog=30)) is None)

print(f"\n{fail} check(s) FAILED" if fail else "\nAll logo-ambiguity guard checks passed.")
sys.exit(1 if fail else 0)
