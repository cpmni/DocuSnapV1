"""INVERSE of census_separator_loss.py: what does the structure guard WRONGLY KEEP? (Oracle C2)

WHY THIS EXISTS. `CODE_SEPARATOR_STRUCTURE_GUARD` stops `_repair_single_token` deleting a PRINTED
separator from a structured code. Its cost is the mirror image: a genuine OCR artefact — a spurious
'/' wedged into a spaceless code — that happens to leave groups of >=2 alphanumerics on both sides
now looks structured, so the guard keeps the junk instead of repairing it. `AB12/34567` is the
shape. Nobody had counted that class; the corpus arm cannot see it (its eight byte-identical lanes
are consistent with the class simply not occurring), so this looks for its ON-DISK signature in the
live install instead.

THE SIGNATURE. A committed value that CARRIES an interior separator, where the page's own text
prints the SAME alphanumeric core WITHOUT one. That is the inverse of the loss census's match:
there, committed had no separator and the page did.

WHAT A ZERO MEANS, and this is the whole point of running it: it does NOT mean the artefact class
is impossible. It means this install has no instance of it, so the guard's measured cost here is
zero and any claim about its cost elsewhere is extrapolation. Say that rather than "no cost".

  py -3.12 stress_test/census_separator_kept.py [--db <path>]

Read-only. mode=ro, never ?immutable=1 (that ignores the -wal).
"""
import argparse
import os
import re
import sqlite3
from collections import Counter

STRUCTURED = re.compile(r"^[0-9A-Za-z]{2,}(?:[/.\-][0-9A-Za-z]{2,})+$")


def core(s):
    return re.sub(r"[^0-9A-Za-z]", "", s or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(os.environ.get("APPDATA", ""), "ScanFinder", "docusnap.db"))
    a = ap.parse_args()
    con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    rows = con.execute(
        """SELECT d.id, d.ocr_text, e.field_key, e.display_value, e.extraction_method
           FROM documents d JOIN extractions e ON e.document_id = d.id
           WHERE d.ocr_text IS NOT NULL AND d.ocr_text <> ''
             AND e.display_value IS NOT NULL AND e.display_value <> ''""").fetchall()

    kept, by_field, by_method, seen = [], Counter(), Counter(), set()
    structured_total = 0
    for r in rows:
        val = str(r["display_value"]).strip()
        if " " in val or len(val) < 5:
            continue
        if not re.search(r"[/\-.]", val):     # carries no separator — not this class
            continue
        c = core(val)
        if len(c) < 5 or not c.isalnum():
            continue
        if STRUCTURED.fullmatch(val) and not re.search(r"[\\|]", val):
            structured_total += 1
        # The page prints the same core as an UNBROKEN run: the committed separator is not on the
        # page, so it is an artefact — and one the guard would now protect if it looks structured.
        hit = None
        for m in re.finditer(r"[0-9A-Za-z]{5,}", r["ocr_text"]):
            if m.group(0) == c:
                hit = m.group(0)
                break
        if not hit:
            continue
        key = (r["id"], r["field_key"])
        if key in seen:
            continue
        seen.add(key)
        would_keep = bool(STRUCTURED.fullmatch(val)) and not re.search(r"[\\|]", val)
        kept.append((r["id"], r["field_key"], val, hit, r["extraction_method"], would_keep))
        by_field[r["field_key"]] += 1
        by_method[r["extraction_method"]] += 1

    print(f"rows scanned: {len(rows)}")
    print(f"committed values carrying a structured separator at all: {structured_total}")
    print(f"\n=== committed WITH a separator the page prints WITHOUT one: {len(kept)} ===")
    for did, fk, val, hit, meth, wk in kept:
        flag = "GUARD WOULD KEEP THE ARTEFACT" if wk else "guard would still repair"
        print(f"  #{did:5} {fk:20} {val!r:24} page={hit!r:22} {meth or '-':22} {flag}")
    if kept:
        print("\nby field:  ", dict(by_field))
        print("by method: ", dict(by_method))
        n = sum(1 for k in kept if k[5])
        print(f"\nOF THESE, THE GUARD WOULD WRONGLY KEEP {n} of {len(kept)}.")
    else:
        print("\nNONE on this install. The artefact class the guard disables has ZERO instances")
        print("here, so its measured cost is zero AND this corpus cannot speak to its cost")
        print("elsewhere. Do not report this as 'the guard has no cost'.")
    con.close()


if __name__ == "__main__":
    main()
