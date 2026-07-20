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

# ═══════════════════════════════════════════════════════════════════════════════════════════
# FUZZY ALTERNATIVE-SUPPLIER NAMING (2026-07-14, Oracle/gary SIGN-OFF-WITH-CONDITIONS) — a
# GARBLED letterhead ("rthgate textiles") still resolves the known supplier ("Northgate Textiles"),
# ISSUER-BAND scoped, suggest-only. own_ratio stays EXACT + whole-page. Kill switch BRANDING_ALT_FUZZY.
from extraction.template_matcher import _keyword_hit_ratio_fuzzy as _fz

NORTHGATE_T = {"name": "Northgate Textiles",
               "keyword_fingerprint": ["Northgate", "Textiles", "Weavers", "Preston"]}
PRIMROSE_T = {"name": "Primrose Childcare",
              "keyword_fingerprint": ["Primrose", "Childcare", "Vicarage", "Exeter"]}
NORTHGATE_ALT_T = {"name": "Northgate Trading",         # contrived twin → pins the margin gate under fuzzy
                   "keyword_fingerprint": ["Northgate", "Textiles", "Weavers", "Preston"]}
NG_TEMPLATES = [CASCADE_T, NORTHGATE_T, PRIMROSE_T]
# Garbled Northgate letterhead (each distinctive word 1–2 chars off → EXACT misses, FUZZY hits);
# recipient "Primrose Childcare" sits BELOW the 'Customer' marker (mid-page → excluded from the band).
NORTHGATE_GARBLE_PAGE = ("rthgate Textles\n14 Weavrs Way\nPrestn PR1 3QX\n"
                         "SALES ORDER   SO-31427\n"
                         "Customer\nPrimrose Childcare\nThe Old School, Vicarage Rd\nExeter EX4 6NA")
CASCADE_GARBLE_PAGE = "ascade Watr Systms\nSpringfeld Works\nINVOICE INV-1\nBill To\nAcme Ltd"

print("\nFUZZY helper — the metric is pinned (difflib ratio ≥0.85; tokens <6 stay EXACT):")
check("incident: 'rthgate' (2-char drop) fuzzy-matches 'northgate' → present",   _fz(["Northgate"], ["rthgate"]) == 1.0)
check("boundary: 'thgate' (3-char drop) does NOT match 'northgate' → absent",     _fz(["Northgate"], ["thgate"]) == 0.0)
check("short token (<6 chars) requires EXACT: 'oaks' vs 'soaks' → absent",        _fz(["Oaks"], ["soaks"]) == 0.0)
check("unrelated tokens → absent",                                               _fz(["Textiles"], ["reading"]) == 0.0)
check("length window ±2: a long token CONTAINING the word does NOT match",        _fz(["Northgate"], ["northgateshireco"]) == 0.0)

print("\nFUZZY alt-naming — a garbled letterhead names the known supplier + emits the suggestion:")
r = run("Cascade Water Systems", NORTHGATE_GARBLE_PAGE, templates=NG_TEMPLATES)
check("garbled 'rthgate textles…' → FLAGGED and note names 'Northgate Textiles'",
      flagged(r) and "Northgate Textiles" in (r["supplier_name"].get("validation_note") or ""))
check("FLAG-ONLY: value still 'Cascade Water Systems' (no engine value-change)",
      r["supplier_name"]["value"] == "Cascade Water Systems")
check("additive 'suggested_supplier' = the named alt (fed to the renderer 'Use …' button)",
      r["supplier_name"].get("suggested_supplier") == "Northgate Textiles")

print("\nISSUER-BAND restriction (Oracle) — the mid-page RECIPIENT is never named as the issuer:")
check("'Primrose Childcare' (a known supplier, below the 'Customer' marker) is NOT named/suggested",
      "Primrose Childcare" not in (r["supplier_name"].get("validation_note") or "")
      and r["supplier_name"].get("suggested_supplier") != "Primrose Childcare")

print("\nPrecision — no false name:")
check("an unrelated rival (Thornbury) absent from the garbled page → not named",
      "Thornbury" not in (r["supplier_name"].get("validation_note") or ""))
r_margin = run("Cascade Water Systems", NORTHGATE_GARBLE_PAGE, templates=[CASCADE_T, NORTHGATE_T, NORTHGATE_ALT_T])
check("two rivals TIE under fuzzy (margin <0.25) → generic note, no name/suggestion",
      flagged(r_margin) and not r_margin["supplier_name"].get("suggested_supplier"))

print("\nown_ratio stays EXACT + whole-page (the load-bearing seam pin):")
r_own = run("Cascade Water Systems", CASCADE_GARBLE_PAGE, templates=NG_TEMPLATES)
check("resolved supplier's OWN name garbled → own_ratio(exact)≈0 → STILL flagged "
      "(fuzzing own_ratio would raise it and SUPPRESS the flag = fail-open)", flagged(r_own))

print("\nKill switch BRANDING_ALT_FUZZY + backward-compat:")
os.environ["BRANDING_ALT_FUZZY"] = "0"
r_off = run("Cascade Water Systems", NORTHGATE_GARBLE_PAGE, templates=NG_TEMPLATES)
check("=0 reverts to the legacy exact whole-page scan: garbled 'Northgate' not matched, and the "
      "actionable suggestion is fuzzy-path-only → NO suggested_supplier (clean production A/B)",
      flagged(r_off) and not r_off["supplier_name"].get("suggested_supplier"))
del os.environ["BRANDING_ALT_FUZZY"]
check("re-enabled → names Northgate again",
      run("Cascade Water Systems", NORTHGATE_GARBLE_PAGE, templates=NG_TEMPLATES)["supplier_name"].get("suggested_supplier") == "Northgate Textiles")
check("fuzzy ⊇ exact: an EXACT-present alt (Thornbury page) is STILL named (no regression)",
      "Thornbury Fasteners" in (run("Cascade Water Systems", THORNBURY_PAGE)["supplier_name"].get("validation_note") or ""))

print("\nDependency pin — fuzzy naming runs with rapidfuzz BLOCKED (packaged-build reality):")
_blocked = {k: sys.modules.pop(k) for k in [m for m in list(sys.modules) if m == "rapidfuzz" or m.startswith("rapidfuzz.")]}
class _RFBlock:
    def find_module(self, name, path=None):
        return self if (name == "rapidfuzz" or name.startswith("rapidfuzz.")) else None
    def load_module(self, name):
        raise ImportError("rapidfuzz blocked (test)")
sys.meta_path.insert(0, _RFBlock())
try:
    r_dep = run("Cascade Water Systems", NORTHGATE_GARBLE_PAGE, templates=NG_TEMPLATES)
    check("rapidfuzz unavailable → NO ImportError, still names Northgate (chrome_band is stdlib)",
          r_dep["supplier_name"].get("suggested_supplier") == "Northgate Textiles")
finally:
    sys.meta_path.pop(0)
    sys.modules.update(_blocked)

# ═══════════════════════════════════════════════════════════════════════════════════════════
# BRANDING_NAMED_BLANK (slice 4 of the template-misfile fix, Oracle-signed 2026-07-20): a NAMED
# rival on the issuer-band fuzzy path against a plain 'template_fixed' frozen stamp BLANKS the
# value AND the _supplier_name filing/learning scope (stamped before this check runs). Every other
# branch stays FLAG-ONLY — the un-named branch NEVER blanks (a degraded scan of a GENUINE supplier
# has own-absence as its only evidence), and template_fixed_locked/manual are untouched.

print("\nNAMED-BLANK — a frozen template stamp contradicted BY NAME is blanked, not displayed:")
r = run("Cascade Water Systems", THORNBURY_PAGE, method="template_fixed")
check("value BLANKED (no wrong on-screen name / filing folder)", r["supplier_name"]["value"] is None)
check("_supplier_name scope blanked too (no learning under the wrong supplier)",
      "_supplier_name" in r and r["_supplier_name"] is None)
check("note kept and still names the rival + arms the renderer regex",
      "Thornbury Fasteners" in (r["supplier_name"].get("validation_note") or "")
      and "confirm the correct company" in (r["supplier_name"].get("validation_note") or ""))
check("suggested_supplier kept (the 'Use' button renders on a value-less row)",
      r["supplier_name"].get("suggested_supplier") == "Thornbury Fasteners")
check("review-bound with confidence 0", r["_needs_review"] is True and r["supplier_name"]["confidence"] == 0)

print("\nNAMED-BLANK scope pins — everything else stays flag-only:")
r = run("Cascade Water Systems", THORNBURY_PAGE, method="template_fixed_locked")
check("PIN: template_fixed_locked (admin intent) is flagged but NEVER blanked",
      flagged(r) and r["supplier_name"]["value"] == "Cascade Water Systems")
r = run("Cascade Water Systems", NAMELESS_PAGE, method="template_fixed")
check("PIN: the UN-NAMED branch never blanks (own-absence alone deletes correct identities)",
      flagged(r) and r["supplier_name"]["value"] == "Cascade Water Systems")
r = run("Cascade Water Systems", THORNBURY_PAGE, method="logo")
check("PIN: a non-template method (logo) stays flag-only", r["supplier_name"]["value"] == "Cascade Water Systems")
os.environ["BRANDING_ALT_FUZZY"] = "0"
r = run("Cascade Water Systems", THORNBURY_PAGE, method="template_fixed")
del os.environ["BRANDING_ALT_FUZZY"]
check("PIN: the legacy exact whole-page naming (=0, can name a recipient) never blanks",
      r["supplier_name"]["value"] == "Cascade Water Systems")
os.environ["BRANDING_NAMED_BLANK"] = "0"
r = run("Cascade Water Systems", THORNBURY_PAGE, method="template_fixed")
del os.environ["BRANDING_NAMED_BLANK"]
check("kill switch =0 restores flag-only on template_fixed (the red proof/revert pin)",
      flagged(r) and r["supplier_name"]["value"] == "Cascade Water Systems")

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
