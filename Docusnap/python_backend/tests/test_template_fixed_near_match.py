#!/usr/bin/env python3
"""tests/test_template_fixed_near_match.py — TEMPLATE_FIXED_NEAR_MATCH_RECONCILE +
TEMPLATE_FIXED_FRAGMENT_DECLINE (gary -> Oracle SIGN-OFF-W/COND C1..C7, 2026-08-06).

THE BUG THIS PINS (Castellan Security, template 32):
Stage 0 seeds the template's curated `fixed_value` for supplier_name at conf 95, method
`template_fixed` (template_matcher.py:819-824). The Stage-0.5 merge (engine.py:4905-4917) then lets a
mapping READ displace that seed on AUTHORITY — `is_curated_refinement` is True whenever the incumbent
method is template_fixed/template_anchor/template_fixed_locked — guarded only by `_ft_mapping_weak`
(free-text reads below conf 75). Edge-glyph misreads of the letterhead arrive ABOVE 75 and win:
    'Castellan Security System:'  (terminal s -> ':')      conf 78
    'Cas tellan Security System:' (+ a segmenter space)    conf 78
    'tastellan Security Systems'  (leading C -> t)         conf 95  <-- SILENT
    'ba)'                                                  conf 78
All four are a WRONG supplier: a wrong output folder AND a wrong learning scope (anchors/hints/logos/
template identity all key off supplier_name).

WHY IT WAS SILENT (the Oracle's seam): the more corrupted the string, the more completely it EVADES
the branding cross-check — `_branding_own_ratio` (engine.py:993) finds no bank for
'tastellan Security Systems', returns None = "unjudgeable", and `_flag_branding_conflict` fail-safes
without flagging. Keeping the SEED (rather than snapping the read to the same string) is what puts the
value back under that guard's jurisdiction, and keeps `method == 'template_fixed'` which
TEMPLATE_FIXED_NAME_PRESENCE_VETO (engine.py:3018) and BRANDING_NAMED_BLANK (engine.py:2983) key on
EXACTLY.

ACCEPTED TRADE-OFF (Oracle C3) — pinned by test 3 below: a `fixed_value` that is ITSELF one glyph
wrong is no longer displaced by a correct page read via this path, so that poison stops self-healing
on the affected templates. The containment carve-out covers the CLIP half of that class. Do NOT widen
the budget past 1 and do NOT remove the carve-out.

Run: py -3.12 python_backend/tests/test_template_fixed_near_match.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import name_match as nm

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


FIXED = "Castellan Security Systems"

# ── the pure predicate ──────────────────────────────────────────────────────────────────────────
check("fold strips punctuation, case and whitespace",
      nm.fold_identity("Cas tellan Security System:") == "castellansecuritysystem")

# BRANCH B — the whole residual class is edit-distance 1 after folding. NOTE (Oracle correction):
# branch A (fold-equal) fires on NONE of these — the ':' IS the misread final 's', so stripping
# punctuation does not restore it. Branch A and B therefore ship on ONE switch; staging A first
# would be a zero-yield flip.
check("B: terminal ':' misread of the final 's' is a near-match",
      nm.near_match_identity("Castellan Security System:", FIXED) is True)
check("B: same, with a segmenter space split inside the first token",
      nm.near_match_identity("Cas tellan Security System:", FIXED) is True)
check("B: leading-glyph substitution 'C'->'t' is a near-match "
      "(plain Levenshtein — 'C'->'t' is letter->letter and is NOT in the OCR confusion maps, "
      "so reusing ocr_corrector._is_confusion verbatim would reject this real case)",
      nm.near_match_identity("tastellan Security Systems", FIXED) is True)
check("A: an exact fold-match is a near-match (zero characters guessed)",
      nm.near_match_identity("castellan  SECURITY systems", FIXED) is True)

# ── the negatives that matter ───────────────────────────────────────────────────────────────────
check("OVER-REACH PIN: 'Bramblewood Joinery Ltd' (a REAL, DIFFERENT company — the owner's own, "
      "printed on every one of these pages as the DELIVER TO block) is NOT a near-match",
      nm.near_match_identity("Bramblewood Joinery Ltd", FIXED) is False)
check("'DELIVER TO' is not a near-match", nm.near_match_identity("DELIVER TO", FIXED) is False)
check("'ba)' is not a near-match (23 edits)", nm.near_match_identity("ba)", FIXED) is False)
check("'1 264.00' is not a near-match", nm.near_match_identity("1 264.00", FIXED) is False)
check("a 2-edit read is NOT a near-match (budget is 1, and must stay 1)",
      nm.near_match_identity("tastellan Security Systemz", FIXED) is False)

# ── CLIP CARVE-OUT (Oracle C5 pin 3) — the mirror of the bug ────────────────────────────────────
# A mis-taught, leading-glyph-CLIPPED fixed_value ('altmarsh Seafoods' class) is ALSO 1 edit from the
# CORRECT page read. Without the carve-out this rule would discard the correct read and freeze the
# clipped literal forever. Containment => the read is the fuller string => let the read win.
check("CARVE-OUT: a clipped seed 'astellan Security Systems' does NOT capture the correct read",
      nm.near_match_identity("Castellan Security Systems", "astellan Security Systems") is False)
check("CARVE-OUT: a seed contained in a LONGER read is never a near-match "
      "('Castellan Security Systems Ltd' must not be swallowed by the shorter seed)",
      nm.near_match_identity("Castellan Security Systems Ltd", FIXED) is False)

# ── length floor: short names need exact, which also excludes BP/3M/IBM by construction ─────────
check("FLOOR: a <8-char fixed value never near-matches ('BP' vs 'BR')",
      nm.near_match_identity("BR", "BP") is False)
check("FLOOR: empty read is never a near-match", nm.near_match_identity("", FIXED) is False)

# ── the fragment guard (Oracle C2 — replaces gary's REJECTED name_quality rule) ──────────────────
# gary proposed `name_quality(value) == 0.0`. MEASURED: name_quality('BP')=0.0, '3M'=0.0, 'IBM'=0.0
# — it is length-biased (value_quality.py:237 needs len>=4), so it would demote legitimate short
# company names. This deterministic length rule needs no lexicon and no name_quality.
check("FRAGMENT: 'ba)' folds to 2 chars against a 24-char curated name -> fragment",
      nm.is_fragment_read("ba)", FIXED) is True)
check("FRAGMENT: a legitimate short name is NOT a fragment when the curated name is also short",
      nm.is_fragment_read("BP", "BP") is False)
check("FRAGMENT: a full-length read is not a fragment",
      nm.is_fragment_read("Bramblewood Joinery Ltd", FIXED) is False)
check("FRAGMENT: empty read is not treated as a fragment (the empty path has its own owner)",
      nm.is_fragment_read("", FIXED) is False)

# ── flags default OFF ───────────────────────────────────────────────────────────────────────────
check("TEMPLATE_FIXED_NEAR_MATCH_RECONCILE defaults OFF",
      os.environ.get("TEMPLATE_FIXED_NEAR_MATCH_RECONCILE") in (None, "0"))
check("TEMPLATE_FIXED_FRAGMENT_DECLINE defaults OFF",
      os.environ.get("TEMPLATE_FIXED_FRAGMENT_DECLINE") in (None, "0"))

# ── MERGE-LEVEL behaviour (Oracle C5: assert the METHOD, not just the value) ────────────────────
# A value-only assertion would go green under the "snap the read" implementation the Oracle
# explicitly rejected, because that produces the same string with a veto-exempt method.
from extraction import engine as eng


def merge(read_value, read_conf, fixed_value, *, near=True, frag=True, key="supplier_name"):
    """Drive the real Stage-0.5 decision helper with a template_fixed incumbent."""
    eng._FIXED_NEAR_MATCH_ON = near
    eng._FIXED_FRAGMENT_DECLINE_ON = frag
    existing = {"value": fixed_value, "confidence": 95, "method": "template_fixed"}
    data = {"value": read_value, "confidence": read_conf, "method": "template_mapping"}
    return eng._fixed_seed_declines_mapping(key, existing, data)


check("MERGE: the silent one — 'tastellan Security Systems'@95 is DECLINED, seed kept",
      merge("tastellan Security Systems", 95, FIXED) == "near_match")
check("MERGE: 'Castellan Security System:'@78 is DECLINED, seed kept",
      merge("Castellan Security System:", 78, FIXED) == "near_match")
check("MERGE: 'ba)'@78 is DECLINED by the fragment guard",
      merge("ba)", 78, FIXED) == "fragment")
check("MERGE: an exactly-agreeing read is a NO-OP (never declined) — this keeps the blast radius "
      "to disagreements only, instead of flipping every taught supplier to template_fixed",
      merge(FIXED, 78, FIXED) is None)
check("OVER-REACH: 'Bramblewood Joinery Ltd' still DISPLACES the seed (this rule is "
      "identity-preserving, NOT an authority flip — making fixed_value authoritative would "
      "reinstate the frozen-stamp class TEMPLATE_FIXED_NAME_PRESENCE_VETO exists for, and that "
      "veto needs >=3 confirms so it is inert for a new supplier)",
      merge("Bramblewood Joinery Ltd", 78, FIXED) is None)
check("SCOPE: customer_name is NEVER declined — it is legitimately variable per document "
      "(post-mig-44 COMPANY_KEYS is supplier_name ONLY)",
      merge("tastellan Security Systems", 95, FIXED, key="customer_name") is None)
check("CARVE-OUT at the merge: a clipped seed does not capture the correct read",
      merge("Castellan Security Systems", 78, "astellan Security Systems") is None)
check("SWITCHES OFF: byte-identical (no decline on any input)",
      merge("tastellan Security Systems", 95, FIXED, near=False, frag=False) is None
      and merge("ba)", 78, FIXED, near=False, frag=False) is None)
check("SUB-SWITCH: fragment guard alone does not enable the near-match rule",
      merge("tastellan Security Systems", 95, FIXED, near=False, frag=True) is None
      and merge("ba)", 78, FIXED, near=False, frag=True) == "fragment")
check("a non-curated incumbent is untouched (rule only guards a template_fixed seed)",
      eng._fixed_seed_declines_mapping(
          "supplier_name",
          {"value": FIXED, "confidence": 90, "method": "anchor_crop"},
          {"value": "tastellan Security Systems", "confidence": 95, "method": "template_mapping"}) is None)

print()
print(f"{fails} FAILED" if fails else "All TEMPLATE_FIXED near-match / fragment pins passed")
sys.exit(1 if fails else 0)
