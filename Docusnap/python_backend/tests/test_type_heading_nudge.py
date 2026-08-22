#!/usr/bin/env python3
"""
tests/test_type_heading_nudge.py
--------------------------------
Q4a of the Chris round-14 queue (card 5: the "Add <type>" nudge offered the ISSUER read — "Document
Olutions", siblings "Document" — as a document TYPE). gary → Oracle SIGN-OFF-W/COND C4a.1–C4a.5,
2026-08-22. Two arms on keyword._harvest_top_band_heading:

  TYPE_NUDGE_ISSUER_EXCLUDE (default ON)  — subtractive: issuer-READ token subset/superset + every-
                                            word generic company token → skipped, scan continues
  TYPE_NUDGE_L0             (default ON after its census: +16 correct / 0 new wrong over 221 docs;
                                            =0 reverts) — additive: line 0 admissible only with a
                                            non-empty issuer read that line 0 is not

THE EXHIBIT (real ocr_text shape of the owner's scans): "SERVICE WORKSHEET" is line 0, the stacked
wordmark "DOCUMENT" / "SOLUTIONS" (or one garbled line "DOCUMENT OLUTIONS") follows.

    py -3.12 python_backend/tests/test_type_heading_nudge.py
"""
import io
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.keyword import _harvest_top_band_heading as H

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

INSTALLED = ["Invoice", "Purchase Order", "Sales Order"]
STACKED = ["SERVICE WORKSHEET", "DOCUMENT", "SOLUTIONS", "Ticket    Location", "Ticket No.    2601-0371-1"]
GARBLED = ["SERVICE WORKSHEET", "DOCUMENT OLUTIONS", "Ticket    Location", "Ticket No.    2601-0371-1"]
DEEP    = ["Lol O02)", "DOCUMENT OLUTIONS", "Ticket", "SERVICE WORKSHEET", "Ticket No. 1"]   # title below the band

fails = 0


def check(label, got, expected):
    global fails
    ok = got == expected
    print(f"  {'OK ' if ok else 'BAD'} {label} -> {got!r}" + ("" if ok else f"   (expected {expected!r})"))
    if not ok:
        fails += 1


def arm(excl="1", l0="0"):
    os.environ["TYPE_NUDGE_ISSUER_EXCLUDE"] = excl
    os.environ["TYPE_NUDGE_L0"] = l0


print("-- the subtractive arm (default ON) --")
arm("1", "0")
check("garbled wordmark + issuer read 'DOCUMENT OLUTIONS' → NOT offered (None: L0 skipped, nothing else qualifies)",
      H(GARBLED, INSTALLED, exclude_texts=["DOCUMENT OLUTIONS"]), None)
check("sibling lone 'DOCUMENT' line + issuer read 'DOCUMENT SOLUTIONS' → NOT offered (token subset)",
      H(STACKED, INSTALLED, exclude_texts=["DOCUMENT SOLUTIONS"]), None)
check("lone 'DOCUMENT' with NO issuer read → still NOT offered (every word is a generic company token)",
      H(STACKED, INSTALLED, exclude_texts=[None]), None)
check("title deeper in the band survives the exclusions; the GARBLED wordmark line ('DOCUMENT OLUTIONS' vs the read "
      "'DOCUMENT SOLUTIONS') is recognised as the issuer by the garble-tolerant token match and skipped",
      H(DEEP, INSTALLED, exclude_texts=["DOCUMENT SOLUTIONS"]), "Service Worksheet")
check("…but a genuinely different two-word banner is NOT swallowed by the garble tolerance ('DELIVERY DOCKET' vs 'Delivery Solutions Ltd')",
      H(["x", "DELIVERY DOCKET", "Ref"], INSTALLED, exclude_texts=["Delivery Solutions Ltd"]), "Delivery Docket")
check("'SERVICE WORKSHEET' is NOT killed by the generic rule ('service' generic, 'worksheet' not)",
      H(["Acme", "SERVICE WORKSHEET", "Ref 1"], INSTALLED, exclude_texts=["Acme Ltd"]), "Service Worksheet")
check("issuer superset: 'ACME' line vs issuer 'ACME Ltd' → NOT offered",
      H(["Letterhead", "ACME", "Ref 1"], INSTALLED, exclude_texts=["ACME Ltd"]), None)
check("an unrelated banner is untouched by an issuer read (positive control)",
      H(["Acme Ltd", "DELIVERY DOCKET"], INSTALLED, exclude_texts=["Acme Ltd"]), "Delivery Docket")
check("the raw band lines are NOT an exclude set: the classic control ['LOGO','WORKSHEET'] still yields 'Worksheet' "
      "with a full chrome band in play (Oracle C4a.2 — the dead-guard class)",
      H(["LOGO", "WORKSHEET", "Date 1/1/2026"], INSTALLED, exclude_texts=["Logo Co"]), "Worksheet")
check("a 3-letter token inside a longer issuer word is NOT a match (token-level, not substring): 'TAX' vs 'Syntax Ltd'",
      H(["Syntax Ltd", "TAX", "Ref"], INSTALLED, exclude_texts=["Syntax Ltd"]), "Tax")

print("\n-- the subtractive arm OFF (=0 restores today — the negative control proves the guard is live) --")
arm("0", "0")
check("OFF: the garbled wordmark IS offered again ('Document Olutions')",
      H(GARBLED, INSTALLED, exclude_texts=["DOCUMENT OLUTIONS"]), "Document Olutions")
check("OFF: the sibling lone 'DOCUMENT' IS offered again", H(STACKED, INSTALLED, exclude_texts=["DOCUMENT SOLUTIONS"]), "Document")

print("\n-- the L0 arm (default OFF) --")
arm("1", "0")
check("L0 =0: the stacked page with issuer known → None (line 0 skipped — the pre-census behaviour)",
      H(STACKED, INSTALLED, exclude_texts=["DOCUMENT SOLUTIONS"]), None)
arm("1", "1")
check("L0 ON + issuer 'DOCUMENT SOLUTIONS' → 'Service Worksheet' (the exhibit's true title, line 0)",
      H(STACKED, INSTALLED, exclude_texts=["DOCUMENT SOLUTIONS"]), "Service Worksheet")
check("L0 ON + issuer 'DOCUMENT OLUTIONS' (the garble) → 'Service Worksheet'",
      H(GARBLED, INSTALLED, exclude_texts=["DOCUMENT OLUTIONS"]), "Service Worksheet")
check("L0 ON + issuer None → line 0 stays skipped (a letterhead and a title are indistinguishable): 'ACME' at L0 → None",
      H(["ACME", "Ref 1", "Date"], INSTALLED, exclude_texts=[None]), None)
check("L0 ON + issuer None + 'SERVICE WORKSHEET' at L0 → None (documented cost, Oracle C4a.3)",
      H(STACKED, INSTALLED, exclude_texts=[]), None)
check("L0 ON + issuer 'ACME Ltd' + 'ACME' at L0 → None (line 0 IS the issuer)",
      H(["ACME", "Ref 1", "Date"], INSTALLED, exclude_texts=["ACME Ltd"]), None)
check("L0 ON + issuer known + a real title at L0 ('DELIVERY DOCKET' over 'Acme Ltd') → offered",
      H(["DELIVERY DOCKET", "Acme Ltd", "Ref"], INSTALLED, exclude_texts=["Acme Ltd"]), "Delivery Docket")
arm("1", "0")

print("\n-- call-site contract --")
src = open(Path(__file__).parent.parent / "process_docs.py", encoding="utf-8").read()
check("process_docs hands the issuer READ(S) to the harvest as exclude_texts",
      "_harvest_top_band_heading(ocr_text.split(\"\\n\"), known_type_names, exclude_texts=_issuer_reads)" in src, True)
ksrc = open(Path(__file__).parent.parent / "extraction" / "keyword.py", encoding="utf-8").read()
check("both switches read with the ruled defaults (exclude ON; L0 ON after the census, =0 reverts)",
      'os.environ.get("TYPE_NUDGE_ISSUER_EXCLUDE", "1") != "0"' in ksrc and 'os.environ.get("TYPE_NUDGE_L0", "1") != "0"' in ksrc, True)

print()
if fails:
    print(f"FAILED: {fails}")
    sys.exit(1)
print("ALL PASS")
