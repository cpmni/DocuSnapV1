"""test_inject_shapes.py — PIN the flip-test corpus failure-mode injector SHAPES (gary design 2026-09-12).

The three value-shape injectors in gen_customer_test.py only FIRE their DARK switch because the HISTORY
docs carry an ATTESTATION shape that defeats the shipped pre-empt gate, and the TEST docs carry the failure
shape. This pins that exact property so a future edit can't silently "fix" an injector by restoring the
pre-empt (which would make the whole census vacuously green):
  - ref_confusable (mig 159): history 'S{2-9}-#####' (head != s0 so C1 disarm can't trip; SAME @#-#####
    fine-shape as the test so the Stage-4.5 shape-check can't pre-empt), test 'S0-#####' (the digit-0
    class-outlier of canonical 'SO').
  - format_class_join (mig 120): ref alternates 'SO-#####' / '#######' so the 3 newest distinct span two
    coarse classes -> classify_format folds to FREETEXT -> the entry is dropped OFF / joined ON.
  - name_nonname (mig 156): customer_name history is a space-free CODE (word_like=False so the wordness
    gate abstains), test is a bare UK postcode (nonname_structured_match fires).

    py -3.12 stress_test/test_inject_shapes.py
"""
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_customer_test as gen

gen._pool_init()  # populate gen._LOGOS
ISS = {i["slug"]: i for i in gen.ISSUERS}
fails = 0


def _gt(slug, dtype, setname, idx, mode):
    issuer = ISS[slug]
    rng = random.Random(f"{slug}|{dtype}|{setname}|{idx}")
    _pdf, gt = gen.build_doc(issuer, dtype, idx, gen._LOGOS, rng, setname, mode)
    return gt


def check(label, cond):
    global fails
    print(("  OK  " if cond else "  BAD ") + label)
    if not cond:
        fails += 1


print("ref_confusable (mig 159) — history S{2-9}-##### (@#-#####), test S0-#####:")
for idx in range(1, 6):
    h = _gt("Harrowgate-Timber", "sales_order", "manual", idx, "ref_confusable")
    t = _gt("Harrowgate-Timber", "sales_order", "live", idx, "ref_confusable")
    check(f"[{idx}] history ref {h['ref']!r} matches ^S[2-9]-\\d{{5}}$", bool(re.fullmatch(r"S[2-9]-\d{5}", h["ref"])))
    check(f"[{idx}] test ref {t['ref']!r} matches ^S0-\\d{{5}}$", bool(re.fullmatch(r"S0-\d{5}", t["ref"])))
    check(f"[{idx}] failure_mode tagged", h.get("failure_mode") == "ref_confusable" and t.get("failure_mode") == "ref_confusable")

print("\nformat_class_join (mig 120) — ref alternates SO-##### / #######, both classes present:")
seen = set()
for idx in range(1, 9):
    g = _gt("Silverbeck-Cleaning", "sales_order", "manual", idx, "format_class_join")
    ok = bool(re.fullmatch(r"SO-\d{5}", g["ref"]) or re.fullmatch(r"\d{7}", g["ref"]))
    check(f"[{idx}] ref {g['ref']!r} is SO-##### or #######", ok)
    seen.add("SO" if g["ref"].startswith("SO") else "digits")
    check(f"[{idx}] failure_mode tagged", g.get("failure_mode") == "format_class_join")
check("both coarse classes appear over the history (the FREETEXT fold)", seen == {"SO", "digits"})

print("\nname_nonname (mig 156) — history CODE (word_like=False), test bare postcode:")
POSTCODES = {"CH1 2HU", "SW1A 1AA", "EH11 3PL", "BT1 1HE"}
for idx in range(1, 6):
    h = _gt("Pelican-Office", "invoice", "manual", idx, "name_nonname")
    t = _gt("Pelican-Office", "invoice", "live", idx, "name_nonname")
    check(f"[{idx}] history customer {h['customer']!r} matches ^[A-Z]{{2}}\\d{{4}}$", bool(re.fullmatch(r"[A-Z]{2}\d{4}", h["customer"])))
    check(f"[{idx}] test customer {t['customer']!r} is a bare UK postcode", t["customer"] in POSTCODES)
    check(f"[{idx}] failure_mode tagged", h.get("failure_mode") == "name_nonname" and t.get("failure_mode") == "name_nonname")

# The whole point: a non-injected doc is byte-unchanged (no failure_mode, owner-name customer).
print("\nno injector => byte-unchanged GT (no failure_mode, customer is the owner):")
base = _gt("Harrowgate-Timber", "invoice", "live", 1, None)
check("no failure_mode key", "failure_mode" not in base)
check("customer is the owner company", base["customer"] == gen.OWNER["name"])

print("\n" + (f"FAILED: {fails}" if fails else "ALL PASS"))
sys.exit(1 if fails else 0)
