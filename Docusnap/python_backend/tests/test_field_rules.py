#!/usr/bin/env python3
"""
tests/test_field_rules.py
-------------------------
Guards the operator-taught field-cleanup helpers (extraction/field_rules.py):
remove_text (precision-first caption removal, both sides, with guards) and
keep_block (single pattern-matching token). Pure functions; a rule that doesn't
apply leaves the value byte-identical.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.field_rules import normalize_token, apply_remove_text, apply_keep_block


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return 0 if cond else 1


def main():
    f = 0

    # ── normalize_token ──
    f += check("normalize: case+space", normalize_token("  DOCUSYS   Model  Name ") == "docusys model name")
    f += check("normalize: empty", normalize_token("") == "")
    f += check("normalize: cap", len(normalize_token("x" * 80)) == 40)

    tok = normalize_token("DOCUSYS MODEL NAME")

    # ── remove_text TRAILING ──
    f += check("trailing leak removed",
               apply_remove_text("ABC12345 DOCUSYS MODEL NAME", tok) == ("ABC12345", True))
    f += check("trailing: OCR double-space + case",
               apply_remove_text("ABC12345  Docusys  Model  Name", tok) == ("ABC12345", True))
    f += check("trailing: extra trailing text eaten",
               apply_remove_text("Some Co Ltd DOCUSYS MODEL NAME extra", tok) == ("Some Co Ltd", True))
    f += check("trailing: no token -> unchanged",
               apply_remove_text("ABC12345", tok) == ("ABC12345", False))

    # Guards (refuse, unchanged)
    f += check("guard: glued (no separator) -> unchanged",
               apply_remove_text("ABCDOCUSYS MODEL NAME", tok) == ("ABCDOCUSYS MODEL NAME", False))
    f += check("guard: token at pos 0 -> unchanged",
               apply_remove_text("DOCUSYS MODEL NAME", tok) == ("DOCUSYS MODEL NAME", False))
    f += check("guard: surviving < min_prefix -> unchanged",
               apply_remove_text("DO DOCUSYS MODEL NAME", tok) == ("DO DOCUSYS MODEL NAME", False))

    # Word-boundary right edge: token "tk-5" must NOT clip "TK-5370Y".
    tk = normalize_token("TK-5")
    f += check("word-boundary: 'TK-5' does not clip 'TK-5370Y'",
               apply_remove_text("MODEL TK-5370Y", tk) == ("MODEL TK-5370Y", False))
    f += check("word-boundary: 'TK-5' ending a value IS removed",
               apply_remove_text("Printer A1 TK-5", tk) == ("Printer A1", True))

    # ── remove_text LEADING ──
    jl = normalize_token("JL")
    f += check("leading leak removed",
               apply_remove_text("JL ABC12345", jl, side="leading") == ("ABC12345", True))
    f += check("leading: surviving < min_prefix -> unchanged",
               apply_remove_text("JL XY", jl, side="leading") == ("JL XY", False))
    f += check("leading: no match -> unchanged",
               apply_remove_text("ABC12345 JL", jl, side="leading") == ("ABC12345 JL", False))

    # ── keep_block ──
    code = r"[A-Z]{3}\d{5}"
    f += check("keep_block: trailing neighbour dropped",
               apply_keep_block("ABC12345 DOCUSYS MODEL NAME", code) == ("ABC12345", True))
    f += check("keep_block: leading neighbour dropped",
               apply_keep_block("JL ABC12345", code) == ("ABC12345", True))
    f += check("keep_block: single token unchanged",
               apply_keep_block("ABC12345", code) == ("ABC12345", False))
    f += check("keep_block: no pattern -> unchanged",
               apply_keep_block("JL ABC12345", None) == ("JL ABC12345", False))
    f += check("keep_block: ambiguous (2 matches) -> unchanged",
               apply_keep_block("ABC12345 XYZ99999", code) == ("ABC12345 XYZ99999", False))
    f += check("keep_block: no match -> unchanged",
               apply_keep_block("Beaumont Care Homes", code) == ("Beaumont Care Homes", False))

    # Digit tie-break with the BROAD 'alphanumeric' type pattern (the real shipped one):
    # heading words also match the pattern, so the single digit-bearing token is kept.
    alnum = r"[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,20}"
    f += check("keep_block (broad alnum): trailing heading dropped via digit tie-break",
               apply_keep_block("ABC12345 DOCUSYS MODEL NAME", alnum) == ("ABC12345", True))
    f += check("keep_block (broad alnum): leading 2-char junk dropped",
               apply_keep_block("JL ABC12345", alnum) == ("ABC12345", True))
    f += check("keep_block (broad alnum): two codes (both digits) -> ambiguous, unchanged",
               apply_keep_block("ABC12345 XYZ99999", alnum) == ("ABC12345 XYZ99999", False))

    print("\nAll field-rules checks passed" if not f else f"\n{f} check(s) FAILED")
    sys.exit(1 if f else 0)


if __name__ == "__main__":
    main()
