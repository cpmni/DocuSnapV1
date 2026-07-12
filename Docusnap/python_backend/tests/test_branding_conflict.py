#!/usr/bin/env python3
"""tests/test_branding_conflict.py — pins the BRANDING-CONFLICT cross-check (Oracle 2026-07-12):
the logo-collision wrong-supplier class, where a Thornbury docket auto-filed at 100% as
"Cascade Water Systems" because their monogram logos collide and Cascade's logo set was poisoned.

The check flags when the RESOLVED supplier's own printed branding is essentially ABSENT from the
page (we resolved X but X's letterhead words aren't there) → cap supplier ≤69 + review NOTE (naming
the branding-detected alternative) + needs_review. FLAG-ONLY (value untouched); the NOTE is what
blocks the wrong auto-file. Reuses template keyword-fingerprints + _keyword_hit_ratio — no new dep.

Driven directly against the real predicate via a lightweight fake self (`_accept_norm` is a
staticmethod; the check only needs `accepted_issuers` + `_accept_norm`), so no engine instantiation.

    py -3.12 tests/test_branding_conflict.py    (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from extraction import engine
from extraction.engine import ExtractionEngine

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


CASCADE_T = {"name": "Cascade Water Systems",
             "keyword_fingerprint": ["Cascade", "Water", "Systems", "Springfield", "Works", "Reservoir", "Reading"]}
THORNBURY_T = {"name": "Thornbury Fasteners",
               "keyword_fingerprint": ["Thornbury", "Fasteners", "Bay", "Severn", "Trading", "Estate", "Bristol", "DELIVERY", "DOCKET"]}
TEMPLATES = [CASCADE_T, THORNBURY_T]

THORNBURY_PAGE = ("Thornbury Fasteners\nBay 12, Severn Trading Estate\nBristol BS35 1RY\n"
                  "DELIVERY DOCKET   Delivery Note No. DN-51895\nDeliver To\nStonegate Property Mgmt")
CASCADE_PAGE = ("Cascade Water Systems\nSpringfield Works, Reservoir Road, Reading\n"
                "INVOICE   INV-00123\nBill To\nAcme Ltd")
# A genuine CASCADE delivery DOCKET — carries the generic doc-type heading "DELIVERY DOCKET" (both
# suppliers print it) but NO Thornbury branding. Thornbury's fingerprint is polluted with those
# doc-type words, so WITHOUT the stopword strip its ratio here is ~0.3 (> LOW) and a wrongly-resolved
# Thornbury would slip through unflagged (the live #1/#42 silent-misfile gap).
CASCADE_DOCKET = ("Cascade Water Systems\nSpringfield Works, Reservoir Road, Reading\n"
                  "DELIVERY DOCKET   Delivery Note No. DN-62705\nDeliver To\nAcme Ltd")
NAMELESS_PAGE = "Generic Delivery Note\nSome other company address line\nItems: 1 box"


class FakeSelf:
    def __init__(self, accepted=None):
        self.accepted_issuers = set(accepted or [])
    _accept_norm = staticmethod(lambda v: " ".join(str(v or "").strip().lower().split()))


def run(supplier, page, templates=TEMPLATES, method="logo", accepted=None, conf=98):
    results = {"supplier_name": {"value": supplier, "confidence": conf, "method": method},
               "_needs_review": False}
    ExtractionEngine._flag_branding_conflict(FakeSelf(accepted), results, supplier, templates, page)
    return results


def flagged(results):
    f = results["supplier_name"]
    return (results.get("_needs_review") is True
            and int(f.get("confidence")) <= 69
            and bool(str(f.get("validation_note") or "").strip()))


print("Happy path — resolved supplier's own branding IS on the page → no flag (byte-identical):")
r = run("Cascade Water Systems", CASCADE_PAGE)
check("Cascade page resolved Cascade → NOT flagged, conf unchanged (98), no note",
      not flagged(r) and r["supplier_name"]["confidence"] == 98 and not r["supplier_name"].get("validation_note"))

print("\nTHE BUG — resolved Cascade but the page is Thornbury → flag + name the alternative:")
r = run("Cascade Water Systems", THORNBURY_PAGE)
check("flagged: needs_review, conf ≤69, note present", flagged(r))
check("note NAMES the branding-detected alternative 'Thornbury Fasteners'",
      "Thornbury Fasteners" in (r["supplier_name"].get("validation_note") or ""))
check("FLAG-ONLY: the value is untouched (still 'Cascade Water Systems')",
      r["supplier_name"]["value"] == "Cascade Water Systems")

print("\nDOC-TYPE POLLUTION (the reverse-direction #1/#42 gap) — stopword strip is load-bearing:")
# resolved Thornbury on a genuine Cascade DELIVERY DOCKET. Thornbury's fingerprint carries the
# doc-type words 'DELIVERY'/'DOCKET' → without the strip its ratio is ~0.3 (> 0.25) → NO flag → the
# Cascade-doc-read-as-Thornbury silently auto-files. With the strip, Thornbury's DISTINCTIVE tokens
# are absent → ratio 0 → flag.
r = run("Thornbury Fasteners", CASCADE_DOCKET)
check("Thornbury resolved on a Cascade docket ('DELIVERY DOCKET' present, no Thornbury branding) → FLAGGED",
      flagged(r))
check("  and a genuine Cascade doc resolved Cascade is STILL not flagged (docket heading doesn't matter)",
      not flagged(run("Cascade Water Systems", CASCADE_DOCKET)))

print("\nExemptions:")
check("method 'manual' (operator typed it) → NOT flagged",
      not flagged(run("Cascade Water Systems", THORNBURY_PAGE, method="manual")))
check("resolved ∈ accepted_issuers ('Issuer is correct' allowlist) → NOT flagged",
      not flagged(run("Cascade Water Systems", THORNBURY_PAGE, accepted=["cascade water systems"])))
# own_brand < K: Cascade fingerprint shrunk to 2 words → can't judge → fail-safe no flag
SHORT = [{"name": "Cascade Water Systems", "keyword_fingerprint": ["Cascade", "Water"]}, THORNBURY_T]
check("resolved supplier has < K(3) fingerprint words (logo-only/unjudgeable) → NOT flagged",
      not flagged(run("Cascade Water Systems", THORNBURY_PAGE, templates=SHORT)))

print("\nCLOSED HOLE (Oracle C1) — the template path stamps these, so they must NOT be exempt:")
check("method 'template_fixed_locked' → STILL flagged (pins the closed hole)",
      flagged(run("Cascade Water Systems", THORNBURY_PAGE, method="template_fixed_locked")))
check("method 'keyword_override' → STILL flagged",
      flagged(run("Cascade Water Systems", THORNBURY_PAGE, method="keyword_override")))

print("\nGeneric note when no alternative is decisively named (trade-off pin):")
r = run("Cascade Water Systems", NAMELESS_PAGE)
check("branding-absent page (no rival ≥0.75) → STILL flagged (routes to review)", flagged(r))
check("note is the GENERIC form (no false 'Thornbury' naming)",
      "Thornbury" not in (r["supplier_name"].get("validation_note") or ""))
# PIN THE ACCEPTED TRADE-OFF: a legit doc whose resolved supplier's branding is genuinely absent
# routes to review. A future dev "reducing review noise" by removing this breaks the collision defence.
check("PIN trade-off: a branding-absent doc is REVIEW-BOUND (not silently auto-filed)",
      r.get("_needs_review") is True)

print("\nPackaged-build parity (Oracle) — the check runs with identity_fusion ABSENT:")
_saved = getattr(engine, "IDENTITY_FUSION_AVAILABLE", None)
try:
    engine.IDENTITY_FUSION_AVAILABLE = False   # the check never touches it → must still fire
    check("IDENTITY_FUSION_AVAILABLE=False → the bug case STILL flags (dependency-free backstop)",
          flagged(run("Cascade Water Systems", THORNBURY_PAGE)))
finally:
    if _saved is not None:
        engine.IDENTITY_FUSION_AVAILABLE = _saved

print("\nKill switch:")
os.environ["BRANDING_CONFLICT_GUARD"] = "0"
check("BRANDING_CONFLICT_GUARD=0 → the bug case NOT flagged (guard disabled)",
      not flagged(run("Cascade Water Systems", THORNBURY_PAGE)))
del os.environ["BRANDING_CONFLICT_GUARD"]
check("guard re-enabled → flags again", flagged(run("Cascade Water Systems", THORNBURY_PAGE)))

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
