#!/usr/bin/env python3
"""tests/test_stage05_format_yield.py — TEMPLATE_FORMAT_FAIL_YIELD (gary REDESIGN 2026-08-09).

Owner rule: teaching must never make a field WORSE than not teaching. On the stable-template corpus,
teaching HELPS most fields but HURTS total/po_ref — an authoritative Stage-0.5 template_mapping read that
lands on the wrong row / adjacent field / clips-to-junk / garbles ("Account" for po_ref, "L922.14" for a
total) keeps authoritative precedence over the CORRECT keyword read at the Stage-1 merge. The fix yields
such a FORMAT-FAILING taught read to a confident, format-PASSING, disagreeing keyword read (swap+cap+note).

WHY THIS WAS REDESIGNED: the 2026-08-06 version keyed on the `_shapewarn` TAG (L1) and a learned-shape
veto (L2). It GATE-FAILED — a CORRECT taught ref shapewarn'd on a thin shape yielded to a LOOSE-
`alphanumeric`-passing garbage keyword read ("The"/"Tel…"/"25-07-2025"), a live ref -1.0 regression. The
redesign is a PURE, DETERMINISTIC content-nature check: ref-family judged by the HARD, digit-bearing,
anchored `reference_code` pattern (+ a full-date guard); currency by the strict leading-glyph + parse_amount
check. NO shapewarn-tag trust, NO learned-shape veto.

THE SEAM THIS PINS: `engine._stage05_format_fails(value, key, val_type, field_patterns, validation_patterns)`.
Load-bearing guarantees:
  • a VALID taught read PASSES (returns False) — protects the teaching gains (this is what kills the ref
    regression: a correct-but-shapewarn'd ref now PASSES reference_code, so the carve-out never fires on it);
  • a garbled / adjacent-field / digit-free taught read FAILS (returns True);
  • a clipped-but-code-shaped value ("24511"/"19979") PASSES (format-valid, wrong VALUE) — the accepted
    read-layer residual; a future dev must not "fix" it by restoring L1. NOTE (2026-08-31): a merge-layer
    fuller-code containment swap NOW EXISTS as a SEPARATE sanctioned arc (TEMPLATE_FRAGMENT_CONTAINMENT_
    YIELD, Oracle SIGN-OFF-W/COND — the CAD8 ⊂ CAD832694 exhibit). It only adopts a confident keyword read
    that STRICTLY PREFIX-CONTAINS the fragment; these standalone clipped values have no such containing
    challenger, so THIS helper's verdict is UNCHANGED. This helper is not that leg's gate — see
    tests/test_fragment_containment_yield.py for the merge-leg pin (which carries its own mechanical guard);
  • L3 must NOT false-fire on legitimate regional/credit amounts (-£662.18 / £-662.18 / continental / swiss).

Run: py -3.12 python_backend/tests/test_stage05_format_yield.py
"""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import engine as E

# Real validation_patterns from the shipped config — so the reference_code pin is the ACTUAL gate.
_CFG = json.loads((Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json").read_text(encoding="utf-8"))
VP = _CFG["validation_patterns"]
# po_ref/invoice_number resolve to loose 'alphanumeric' via _seed_field_patterns — the loose gate the
# redesign deliberately does NOT use for ref-family. Passed as field_patterns to exercise the real path.
FP = {"po_ref": {"validation": "alphanumeric"},
      "invoice_number": {"validation": "alphanumeric"},
      "total_amount": {"validation": "currency"}}

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond: fails += 1

FF = E._stage05_format_fails

# ── REF-FAMILY judged by the HARD reference_code pattern (digit-bearing, anchored) ─────────────
# po_ref/job_ref are NOT caught by the global _is_ref_field ("ref" != "reference", not _no/_number) —
# the helper's local `endswith('_ref')` predicate must catch them:
check("po_ref recognised ref-family: adjacent-field 'Account' (digit-free) FAILS",
      FF("Account", "po_ref", "alphanumeric", FP, VP) is True)
check("LOOSE-ALPHANUMERIC PIN: 'Account' FAILS — it PASSES the loose 'alphanumeric' pattern, so this "
      "breaks if the gate is ever reverted from reference_code to alphanumeric",
      FF("Account", "po_ref", "alphanumeric", FP, VP) is True)
check("empty taught value FAILS", FF("", "po_ref", "alphanumeric", FP, VP) is True)

# The 3 ref-regression strings (as CHALLENGERS they must FAIL, so the branch's 'keyword PASSES' leg is
# False -> no swap of garbage into a ref):
check("regression string 'The' FAILS (no digit)",
      FF("The", "invoice_number", "alphanumeric", FP, VP) is True)
check("regression string 'Tel 01632 964956 VAT Reg No 123' FAILS (spaces / prose)",
      FF("Tel 01632 964956 VAT Reg No 123", "invoice_number", "alphanumeric", FP, VP) is True)
check("DATE-GUARD: a full numeric date '25-07-2025' FAILS (never swap a date into a ref role)",
      FF("25-07-2025", "invoice_number", "alphanumeric", FP, VP) is True)

# Correct reads PASS — a good teach is never overridden:
check("valid taught po_ref 'PO-56863' PASSES", FF("PO-56863", "po_ref", "alphanumeric", FP, VP) is False)
check("valid taught po_ref 'PO-84783' PASSES", FF("PO-84783", "po_ref", "alphanumeric", FP, VP) is False)
check("ANTI-REGRESSION PIN: a valid ref 'INV-2026-001' PASSES — a _shapewarn tag no longer forces a "
      "FAIL (dropping L1 is what kills the ref regression at its root)",
      FF("INV-2026-001", "invoice_number", "alphanumeric", FP, VP) is False)

# ── ACCEPTED READ-LAYER RESIDUAL: clipped-but-code-shaped values are format-VALID -> NOT caught ──
# These pin the HELPER's verdict (format-valid -> PASSES). The sanctioned merge-layer containment arc
# (TEMPLATE_FRAGMENT_CONTAINMENT_YIELD) does NOT change it: it fires only on a confident keyword read that
# strictly prefix-CONTAINS the fragment, which these standalone clipped values do not have.
check("ACCEPTED-TRADE-OFF PIN: clipped 'PO-'->'19979' PASSES (format-valid wrong value; read-layer)",
      FF("19979", "po_ref", "alphanumeric", FP, VP) is False)
check("ACCEPTED-TRADE-OFF PIN: clipped '24511' PASSES (format-valid wrong value; read-layer)",
      FF("24511", "po_number", "alphanumeric", FP, VP) is False)

# ── CURRENCY — strict leading-glyph + parse_amount (the config currency pattern via re.search is too
#    lenient: it substring-matches 'L922.14') ────────────────────────────────────────────────────
check("currency 'L922.14' (leading letter the substring let through) FAILS",
      FF("L922.14", "total_amount", "currency", FP, VP) is True)
check("currency 'O.00' garble FAILS", FF("O.00", "total_amount", "currency", FP, VP) is True)
# legitimate amounts must PASS (return False) so they are NEVER swapped:
for good in ["922.14", "1,234.00", "£-662.18", "-£662.18", "£1,758.72", "1.234,56", "1'234.56"]:
    check(f"legitimate amount {good!r} PASSES (not swapped)",
          FF(good, "total_amount", "currency", FP, VP) is False)
check("accepted residual: bare '2' PASSES (magnitude, not format; left to NET_MISREAD_TOTAL_FLAG)",
      FF("2", "total_amount", "currency", FP, VP) is False)
check("accepted residual: net total '551.82' PASSES (left to NET_MISREAD_TOTAL_FLAG, not this yield)",
      FF("551.82", "total_amount", "currency", FP, VP) is False)
# currency detected via field_patterns even when val_type is not passed (the fallback leg):
check("currency via field_patterns fallback: 'L922.14' FAILS when val_type is None",
      FF("L922.14", "total_amount", None, FP, VP) is True)

# ── unknown structured field (no ref-family, not currency) -> fail-safe, no swap ─────────────────
check("unknown structured field returns False (fail-safe, never swaps)",
      FF("whatever", "some_custom_field", "text", {}, VP) is False)

# ── Flag default OFF + floor ─────────────────────────────────────────────────────────────────────
check("TEMPLATE_FORMAT_FAIL_YIELD defaults OFF (byte-identical unless enabled)",
      E.TEMPLATE_FORMAT_FAIL_YIELD is False or os.environ.get("TEMPLATE_FORMAT_FAIL_YIELD") == "1")
check("_FORMAT_FAIL_KW_FLOOR is 85 (redesign — reaches the base-80+right seeded inline reads)",
      E._FORMAT_FAIL_KW_FLOOR == 85)


# ── TEMPLATE_FORMAT_FAIL_CODE_AGREE — the CALL-SITE exemption (2026-09-24, Chris teach-round card 2a; reggie →
#    Oracle SIGN-OFF-W/COND C1-C4). The pure helper above stays LEGACY (a code-led read still "fails" it — pinned
#    below); the exemption lives at the merge call site and only ever REMOVES a yield, and ONLY when the code-led
#    mapping read's cents + sign EQUAL the challenger's. Env kill '0' restores the legacy verdict.
print()
print("TEMPLATE_FORMAT_FAIL_CODE_AGREE (call-site exemption)")
CA = E._format_fail_code_agree
FP_CUR = {"total": {"validation": "currency"}}
os.environ.pop("TEMPLATE_FORMAT_FAIL_CODE_AGREE", None)
check("(a) 'GBP 11,066.95' vs '11,066.95' -> EXEMPT (same cents, code aside)", CA("GBP 11,066.95", "11,066.95", "total", "currency", FP_CUR) is True)
check("(a') 'GBP 5,823.50' vs '£5,823.50' -> EXEMPT (symbol on the challenger is fine)", CA("GBP 5,823.50", "£5,823.50", "total", "currency", FP_CUR) is True)
check("(b) 'GBP 1,066.95' vs '11,066.95' -> NOT exempt (a clipped box must keep today's hold)", CA("GBP 1,066.95", "11,066.95", "total", "currency", FP_CUR) is False)
check("(c) 'SBP 10,239.38' vs '10,239.38' -> NOT exempt (a misread code is not a prefix)", CA("SBP 10,239.38", "10,239.38", "total", "currency", FP_CUR) is False)
check("(c') 'VAT 1,234.56' vs '1,234.56' -> NOT exempt (label bleed)", CA("VAT 1,234.56", "1,234.56", "total", "currency", FP_CUR) is False)
check("sign: 'GBP -1,000.00' vs '1,000.00' -> NOT exempt (cents equal, sign differs)", CA("GBP -1,000.00", "1,000.00", "total", "currency", FP_CUR) is False)
check("glued: 'GBP11,066.95' vs '11,066.95' -> NOT exempt (Stage 4 could not strip it)", CA("GBP11,066.95", "11,066.95", "total", "currency", FP_CUR) is False)
check("garble: 'GBP 9 32632.76' vs '932,632.76' -> NOT exempt (not strict-shaped)", CA("GBP 9 32632.76", "932,632.76", "total", "currency", FP_CUR) is False)
check("non-currency key -> NOT exempt (ref-family untouched)", CA("GBP 11,066.95", "11,066.95", "po_ref", "text", {}) is False)
check("currency by field_patterns validation (no val_type) -> EXEMPT", CA("GBP 11,066.95", "11,066.95", "total", None, FP_CUR) is True)
check("challenger not an amount -> NOT exempt", CA("GBP 11,066.95", "The", "total", "currency", FP_CUR) is False)
os.environ["TEMPLATE_FORMAT_FAIL_CODE_AGREE"] = "0"
check("env kill '0' -> NOT exempt (byte-identical legacy verdict)", CA("GBP 11,066.95", "11,066.95", "total", "currency", FP_CUR) is False)
os.environ.pop("TEMPLATE_FORMAT_FAIL_CODE_AGREE", None)
check("(d) the PURE helper is untouched: 'GBP 922.14' still fails the legacy leg (as the challenger it stays rejected)", FF("GBP 922.14", "total", "currency", {}, {}) is True)
check("(d') the PURE helper is untouched: 'GBP 11,066.95' still fails the legacy leg (the exemption is the call site's)", FF("GBP 11,066.95", "total", "currency", {}, {}) is True)
# mechanical guard: the call site consults the exemption BEFORE the challenger re-check
_src = Path(E.__file__).read_text(encoding="utf-8")
_i = _src.find("_ff_ex_fails = _stage05_format_fails(existing.get(\"value\")")
_j = _src.find("and not _stage05_format_fails(data.get(\"value\")", _i)
check("call site: existing-side verdict computed, exemption consulted, THEN the challenger check", _i > 0 and _j > _i and "_format_fail_code_agree(existing.get(\"value\"), data.get(\"value\")" in _src[_i:_j] and "self._t(\"format_fail_code_agree\"" in _src[_i:_j])

print()
print(f"{fails} FAILED" if fails else "All TEMPLATE_FORMAT_FAIL_YIELD helper pins passed")
sys.exit(1 if fails else 0)
