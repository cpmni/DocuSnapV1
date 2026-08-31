"""Census: how often did a committed value lose an INTERIOR separator that the page itself prints?

WHY THIS EXISTS. `anchor._repair_single_token` fixes a real PSM-7 artefact — a spurious '/' '\\' or
'|' wedged into a spaceless serial ('H7R5326676' -> 'H/7R5326676') — by re-reading the crop with a
`tessedit_char_whitelist` that cannot emit those characters, and accepting the result when its
alphanumerics are identical. That acceptance test is satisfied by ANY token whose only difference is
a separator, including a reference whose separators are PRINTED. This measures how often that
happens on real data, and what a proposed shape guard would do about it.

It produced the figure quoted in `1ad36de`: 36 committed invoice_numbers had lost a separator their
own page text still prints, all 36 through the template_mapping rung, and the guard keeps the
separator on 36 of 36.

METHOD, deliberately conservative. For every committed value with NO separator in it, look in that
document's own stored page text for a token whose alphanumeric core is IDENTICAL but which carries an
interior '/', '-' or '.'. Identical alphanumerics means this is the same read with a separator
dropped, not a different value being matched by luck.

LIMITS, so the number is not over-read:
  * Only documents whose `ocr_text` is stored can be measured. Older documents have none, and they
    are simply absent from the count rather than counted as clean.
  * It measures values that LOOK like a separator was lost. A value that was always printed without
    one is indistinguishable and is (correctly) never counted, but so is a genuine artefact repair
    that happened to produce a clean value — this is a lower bound on the harm, not a census of the
    repair's total activity.

  py -3.12 stress_test/census_separator_loss.py [--db <path>]

Read-only. Opens with mode=ro, NEVER ?immutable=1 — that ignores the -wal, which on the live DB
holds hundreds of KB of the most recent writes.
"""
import argparse
import os
import re
import sqlite3
from collections import Counter

DEFAULT_DB = os.path.join(os.environ.get("APPDATA", ""), "ScanFinder", "docusnap.db")

# The guard under consideration (anchor._STRUCTURED_CODE_SEP): a token that splits into >=2 groups of
# >=2 alphanumerics is a structured code and keeps its separators. An artefact separator is wedged
# into an unbroken run and leaves a one-character group, which this refuses to protect.
STRUCTURED = re.compile(r"^[0-9A-Za-z]{2,}(?:[/\-.][0-9A-Za-z]{2,})+$")

core = lambda s: re.sub(r"[^0-9A-Za-z]", "", str(s or ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB, help="DB to census (default: the live install)")
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """SELECT d.id, d.ocr_text, e.field_key, e.display_value, e.extraction_method
           FROM documents d JOIN extractions e ON e.document_id = d.id
           WHERE d.ocr_text IS NOT NULL AND d.ocr_text <> ''
             AND e.display_value IS NOT NULL AND e.display_value <> ''""").fetchall()

    stripped, by_field, by_method, seen = [], Counter(), Counter(), set()
    guard_would_keep = 0
    for r in rows:
        val = str(r["display_value"]).strip()
        if " " in val or len(val) < 5:
            continue
        if re.search(r"[/\-.]", val):        # already carries a separator — nothing was lost
            continue
        c = core(val)
        if len(c) < 5 or not c.isalnum():
            continue
        hit = None
        for m in re.finditer(r"[0-9A-Za-z]+(?:[/\-.][0-9A-Za-z]+)+", r["ocr_text"]):
            if core(m.group(0)) == c:
                hit = m.group(0)
                break
        if not hit:
            continue
        key = (r["id"], r["field_key"])
        if key in seen:
            continue
        seen.add(key)
        stripped.append((r["id"], r["field_key"], val, hit, r["extraction_method"]))
        by_field[r["field_key"]] += 1
        by_method[r["extraction_method"]] += 1
        if STRUCTURED.match(hit):
            guard_would_keep += 1

    print(f"=== committed WITHOUT a separator the page prints WITH one: {len(stripped)} ===")
    for did, fk, val, hit, meth in stripped:
        flag = "KEEP" if STRUCTURED.match(hit) else "repair"
        print(f"  #{did:<5} {fk:<16} committed={val!r:<16} page={hit!r:<16} {meth:<26} guard={flag}")
    print(f"\n  by field : {dict(by_field)}")
    print(f"  by rung  : {dict(by_method)}")
    print(f"\n  the shape guard would KEEP the separator on {guard_would_keep} of {len(stripped)}")

    print("\n=== the other side: values that KEPT an interior separator (must not be disturbed) ===")
    kept = Counter()
    shown = 0
    for r in rows:
        val = str(r["display_value"]).strip()
        if " " in val or not re.search(r"[0-9A-Za-z][/\\|][0-9A-Za-z]", val):
            continue
        kept[r["field_key"]] += 1
        if shown < 20:
            print(f"  #{r['id']:<5} {r['field_key']:<16} {val!r:<20} "
                  f"structured={STRUCTURED.match(val) is not None}")
            shown += 1
    print(f"  by field: {dict(kept)}")
    con.close()


if __name__ == "__main__":
    main()
