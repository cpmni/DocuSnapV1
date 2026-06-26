#!/usr/bin/env python3
"""
tests/test_inline_column_bleed.py
---------------------------------
Guards template_mapper.cluster_value_words — the inline-harvest column-boundary
fix. The harvest reads a whole Tesseract line (full page width) and used to take
EVERY word after the matched label, so a far heading/column on the same row leaked
into the value ("ABC12345" -> "ABC12345 DOCUSYS MODEL NAME"). cluster_value_words
splits the post-label words into horizontal-gap columns and returns the value's own
column (nearest/after the label's right edge), while leaving a single-column /
legitimately-multi-word value byte-identical.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.template_mapper import cluster_value_words

H = 0.02   # word height (normalised)


def w(text, x, width):
    return {"text": text, "x_norm": x, "w_norm": width, "h_norm": H}


def text_of(words):
    return " ".join(x["text"] for x in words)


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return 0 if cond else 1


def main():
    f = 0

    # 1. Trailing leak: value, WIDE gap, heading -> keep the value column.
    rest = [w("ABC12345", 0.30, 0.08),
            w("DOCUSYS", 0.60, 0.07), w("MODEL", 0.68, 0.05), w("NAME", 0.74, 0.05)]
    f += check("trailing heading dropped",
               text_of(cluster_value_words(rest, expect_x=0.28)) == "ABC12345")

    # 2. Far value column: label, WIDE gap, value, WIDE gap, heading -> value only.
    rest = [w("VALUE", 0.55, 0.08), w("HEADING", 0.80, 0.07)]
    f += check("far value column kept, far heading dropped",
               text_of(cluster_value_words(rest, expect_x=0.10)) == "VALUE")

    # 3. Legitimate multi-word value (normal spaces) stays WHOLE — not fragmented.
    rest = [w("Beaumont", 0.30, 0.10), w("Care", 0.41, 0.05),
            w("Homes", 0.47, 0.07), w("Ltd", 0.55, 0.04)]
    f += check("multi-word value not fragmented",
               text_of(cluster_value_words(rest, expect_x=0.28)) == "Beaumont Care Homes Ltd")

    # 4. Single-column value with no wide gap -> byte-identical (whole list).
    rest = [w("INV", 0.30, 0.05), w("0042", 0.36, 0.06)]
    out = cluster_value_words(rest, expect_x=0.28)
    f += check("single column unchanged", text_of(out) == "INV 0042")

    # 5. Single word -> returned as-is.
    f += check("single word returned",
               text_of(cluster_value_words([w("ABC12345", 0.3, 0.08)], expect_x=0.1)) == "ABC12345")

    # 6. Empty -> empty (no crash).
    f += check("empty -> empty", cluster_value_words([], expect_x=0.1) == [])

    # 7. Missing geometry -> fallback to whole list (born-digital line w/o per-word boxes).
    nogeo = [{"text": "ABC12345"}, {"text": "DOCUSYS"}, {"text": "MODEL"}]
    f += check("missing geometry -> whole list",
               text_of(cluster_value_words(nogeo, expect_x=0.1)) == "ABC12345 DOCUSYS MODEL")

    # 8. expect_x=None -> first (leftmost) cluster.
    rest = [w("ABC12345", 0.30, 0.08), w("DOCUSYS", 0.60, 0.07)]
    f += check("expect_x None -> first cluster",
               text_of(cluster_value_words(rest, expect_x=None)) == "ABC12345")

    print("\nAll inline-column-bleed checks passed" if not f else f"\n{f} check(s) FAILED")
    sys.exit(1 if f else 0)


if __name__ == "__main__":
    main()
