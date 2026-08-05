"""Pins for HEADING_TITLE_GAP_COLLAPSE (herald 2026-08-07, DARK). A wide-tracked multi-word title
('CREDIT    NOTE', 'DELIVERY    NOTE') reconstructs with a >=COLUMN_BREAK_MIN intra-title gap, so the
column-aware heading test splits it into two columns and the title scores as a mere mention -> the doc
mis-types. FIX: collapse whitespace ONLY inside the matched type-phrase span before the column split
(span-bounded — genuine columns outside the phrase are preserved). Byte-identical OFF.

Run: py -3.12 python_backend/tests/test_heading_title_gap.py
"""
import importlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
CFG = json.loads((Path(__file__).resolve().parents[1] / ".." / "config" / "keyword_patterns.json").read_text(encoding="utf-8"))
NAMES = ["Invoice", "Sales Order", "Purchase Order", "Credit Note", "Delivery Note"]
AL = {"credit_note": ["Credit Note"], "delivery_note": ["Delivery Note"]}

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


def detect(text, on):
    os.environ["HEADING_TITLE_GAP_COLLAPSE"] = "1" if on else "0"
    import extraction.keyword as K
    importlib.reload(K)
    return K.detect_document_type(text, CFG, NAMES, AL)


# A realistic credit-note top band: wide-tracked title + a caption row + invoice-like body structure.
CN = ("Castellan Security Systems\n"
      "CREDIT    NOTE\n"
      "CREDIT NOTE NO CCN9782    CREDIT DATE 22-05-2025    Account No CSS-1108\n"
      "Net Total 514.00\nVAT @ 20% 102.80\nTOTAL 616.80\n"
      "Credit against invoice CAS637771 - goods returned.\n")

off = detect(CN, False)
on = detect(CN, True)
check("OFF: wide-tracked title is NOT recognised as a heading (the bug)", off and off.get("heading") is False)
check("ON: wide-tracked 'CREDIT    NOTE' now scores as a heading", on and on.get("heading") is True)
check("ON: still types Credit Note", on and on["type"] == "Credit Note")
check("ON: the title's heading weight ~doubles the Credit Note score",
      on and off and on["all_scores"]["Credit Note"] >= off["all_scores"]["Credit Note"] + 3.0)

# herald's live sibling: DELIVERY NOTE wide-tracked.
dn = detect("Some Supplier Ltd\nDELIVERY    NOTE\nDelivery No DN-4402   Date 01-02-2026\n", True)
check("ON: 'DELIVERY    NOTE' recovers (system-wide, not credit-note-specific)",
      dn and dn["type"] == "Delivery Note")

# Column-fusion guard: a genuine extra word beside the title must NOT let the title score as a
# strong heading (the whitespace collapse is span-bounded + the extra-word rejection stands).
fus = detect("CREDIT    NOTE TOTAL\n", True)
check("ON: 'CREDIT    NOTE TOTAL' does not score as a strong Credit-Note heading",
      not (fus and fus["type"] == "Credit Note" and fus.get("heading")))

# Single-spaced titles are unaffected (already worked) — and Purchase Order (single-spaced here) stays.
po = detect("Acme Ltd\nPURCHASE ORDER\nOrder No PO-1234\n", True)
check("ON: single-spaced 'PURCHASE ORDER' still types Purchase Order (unchanged)",
      po and po["type"] == "Purchase Order")

# OFF byte-identical: a single-spaced title behaves the same ON and OFF (the flag only changes a line
# with a >=2-space internal gap in a name/alias phrase).
clean = "Acme Ltd\nINVOICE\nInvoice No INV-5\n"
check("OFF==ON for a clean single-spaced doc (no wide gap -> no change)",
      json.dumps(detect(clean, False), sort_keys=True) == json.dumps(detect(clean, True), sort_keys=True))

os.environ.pop("HEADING_TITLE_GAP_COLLAPSE", None)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All HEADING_TITLE_GAP_COLLAPSE checks passed.")
