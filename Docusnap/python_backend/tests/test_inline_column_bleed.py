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
from extraction.template_mapper import cluster_value_words, _match_label_run

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

    # ── _match_label_run: tight label run + end index (the merged-row label_box fix) ──
    # Shared by the OCR (_locate_anchor) AND born-digital (_locate_in_text_lines) label
    # localizers, so testing it here covers both paths.

    # 9. MERGED two-column row: a left-hand customer block shares the OCR row's y-band
    #    with the right-hand "Invoice Date" caption + value. The label run must be JUST
    #    [Invoice, Date] — NOT the whole prefix from the left column (the old prefix-only
    #    scan returned [Mcgee, Solicitors, Invoice, Date], so label_box spanned the row).
    row = [w("Mcgee", 0.06, 0.06), w("Solicitors", 0.13, 0.10),
           w("Invoice", 0.60, 0.07), w("Date", 0.68, 0.05),
           w("29/05/2026", 0.80, 0.10)]
    m = _match_label_run(row, "invoice date")
    f += check("merged-row label run is tight [Invoice Date]",
               m is not None and text_of(m[0]) == "Invoice Date")
    # 10. end index points AT the value, so value = words[end:] drops BOTH the left
    #     column and the label (len(run) would be 2 here → wrong slice start).
    f += check("merged-row end index points at the value (words[end:])",
               m is not None and m[1] == 4 and
               text_of(cluster_value_words(row[m[1]:],
                       expect_x=row[3]["x_norm"] + row[3]["w_norm"])) == "29/05/2026")

    # 11. Regression — single-column "label value" row is byte-identical to the old
    #     prefix behaviour: run is the leading label, value follows at end index.
    row2 = [w("Ticket", 0.10, 0.06), w("No.", 0.17, 0.04), w("2605-0769-1", 0.30, 0.12)]
    m2 = _match_label_run(row2, "ticket no")
    f += check("single-column label run [Ticket No.] at end=2",
               m2 is not None and text_of(m2[0]) == "Ticket No." and m2[1] == 2)

    # 12. Below threshold / no needle / empty -> None (caller falls back to whole-line box).
    f += check("no label match -> None",
               _match_label_run([w("Alpha", 0.1, 0.05), w("Beta", 0.2, 0.05)], "invoice date") is None)
    f += check("empty words -> None", _match_label_run([], "invoice date") is None)
    f += check("no needle -> None", _match_label_run(row, "") is None)

    print("\nAll inline-column-bleed checks passed" if not f else f"\n{f} check(s) FAILED")
    sys.exit(1 if f else 0)


if __name__ == "__main__":
    main()
