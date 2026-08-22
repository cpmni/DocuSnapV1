"""P4 of the two-line wordmark slice — FRAGMENT AGREEMENT KEEPS THE CURATED SEED (2026-08-22, gary →
Oracle SIGN-OFF-W/COND C4.1–C4.4; DARK behind TEMPLATE_FIXED_SEED_FRAGMENT_KEEP /
`template_fixed_seed_fragment_keep`).

THE EXHIBIT (owner's scans, traced on the real pipeline): the taught issuer box reads ONE line of the
stacked wordmark ("DOCUMENT"); that Stage-0.5 read displaced the `template_fixed` seed
("supplier identity changed during extraction … using field value"); identity_fusion then repaired
it to the canonical at ≤70 with a "please confirm" note that survived 3 human confirms and every
re-read. With the keep armed the same re-read logs
  `Stage 0.5: kept curated supplier 'DOCUMENT SOLUTIONS' — declined mapping read 'DOCUMENT' (fragment_agreement)`
and the row lands `template_fixed` @95 with no note (overall 100, eligible).

Pins (one per Oracle control):
  exhibit kept · 'TIONS' (mid-word) not · SOLUTIONS absent from the band not · non-adjacent lines
  not · the C4.2 control (fixed "DOCUMENT SOLUTIONS Ticket", Ticket elsewhere) not · column-break
  junk on the band line still reads as the issuer column · exact equality path untouched ·
  customer_name untouched · no generic-token filter on the read ('Ltd' against 'ACME / Ltd' keeps) ·
  a read that is NOT a sub-run not · switch semantics (OFF byte-identical at the call site).

Run:  py -3.12 tests/test_fixed_seed_fragment_keep.py   (from python_backend/)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import engine as E

fails = 0


def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


FIXED = {"value": "DOCUMENT SOLUTIONS", "method": "template_fixed", "confidence": 95}
BAND = "SERVICE WORKSHEET\nDOCUMENT\nSOLUTIONS    TS) iL\nTicket    Location\nTicket No.    2601-0371-1    Work Address    Beaumont Care Homes Ltd - Croagh\n"
keep = lambda key, ex, read, text: E._fragment_agreement_keeps_seed(key, ex, {"value": read}, text)

print("-- the exhibit --")
check("read 'DOCUMENT' against fixed 'DOCUMENT SOLUTIONS' with the band printing DOCUMENT / SOLUTIONS → KEPT",
      keep("supplier_name", FIXED, "DOCUMENT", BAND) is True)
check("…column-break junk after SOLUTIONS ('SOLUTIONS    TS) iL') still reads as the issuer column", "TS) iL" in BAND)
check("read 'SOLUTIONS' (the other line of the stack) → KEPT", keep("supplier_name", FIXED, "SOLUTIONS", BAND) is True)
check("lower-case / junk-suffixed band lines ('DocuMENT    ~' / 'SOLUTIONS    cc ool') → KEPT",
      keep("supplier_name", FIXED, "DOCUMENT", "SERVICE WORKSHEET\nDocuMENT    ~\nSOLUTIONS    cc ool\nTicket\n") is True)

print("\n-- the controls (each leg) --")
check("'TIONS' — a mid-word scrap, not a whole token of the name → NOT kept", keep("supplier_name", FIXED, "TIONS", BAND) is False)
check("'DOCUMENT' with SOLUTIONS absent from the band → NOT kept (the existing path; the note stays)",
      keep("supplier_name", FIXED, "DOCUMENT", "SERVICE WORKSHEET\nDOCUMENT\nTicket\n") is False)
check("DOCUMENT and SOLUTIONS on NON-adjacent band lines → NOT kept (structural run, not bag-of-words)",
      keep("supplier_name", FIXED, "DOCUMENT", "SERVICE WORKSHEET\nDOCUMENT\nTicket\nSOLUTIONS\n") is False)
FIXED_BAD = {"value": "DOCUMENT SOLUTIONS Ticket", "method": "template_fixed", "confidence": 95}
check("C4.2: fixed 'DOCUMENT SOLUTIONS Ticket' with 'Ticket' ELSEWHERE in the band → NOT kept",
      keep("supplier_name", FIXED_BAD, "DOCUMENT", "SERVICE WORKSHEET\nDOCUMENT\nSOLUTIONS\nRef 1234\nTicket\n") is False)
check("a read that is not a sub-run ('SOLUTIONS DOCUMENT', reversed) → NOT kept",
      keep("supplier_name", FIXED, "SOLUTIONS DOCUMENT", BAND) is False)
check("a genuinely different company ('Bramblewood Joinery') → NOT kept",
      keep("supplier_name", FIXED, "Bramblewood Joinery", BAND) is False)
check("the exact-equality path is untouched (returns False here; the agreement keep owns it)",
      keep("supplier_name", FIXED, "DOCUMENT SOLUTIONS", BAND) is False)
check("customer_name is never judged", keep("customer_name", FIXED, "DOCUMENT", BAND) is False)
check("a non-seed method is never judged", keep("supplier_name", {"value": "DOCUMENT SOLUTIONS", "method": "template_mapping"}, "DOCUMENT", BAND) is False)
check("a recipient BELOW a marker never forms the run (band truncates at 'Bill To')",
      keep("supplier_name", {"value": "Beaumont Care Homes", "method": "template_fixed"}, "Beaumont",
           "SERVICE WORKSHEET\nDOCUMENT\nSOLUTIONS\nBill To:\nBeaumont\nCare Homes\n") is False)

print("\n-- no generic-token filter on the read (Oracle C4.3) --")
ACME = {"value": "ACME Ltd", "method": "template_fixed", "confidence": 95}
check("'Ltd' read against band 'ACME / Ltd' → KEPT (the run-equality leg is the discriminator)",
      keep("supplier_name", ACME, "Ltd", "ACME\nLtd\n1 High Street\n") is True)
check("'ACME' read against the same band → KEPT", keep("supplier_name", ACME, "ACME", "ACME\nLtd\n1 High Street\n") is True)

print("\n-- switch semantics --")
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extraction", "engine.py"), encoding="utf-8").read()
check("the call site asks only when no other keep fired AND the flag is on",
      "if not _fixed_decline and _FIXED_SEED_FRAGMENT_KEEP_ON:" in src)
check("…and names its branch 'fragment_agreement' (distinct from the debris 'fragment')",
      "_fixed_decline = 'fragment_agreement'" in src)
check("the flag reads TEMPLATE_FIXED_SEED_FRAGMENT_KEEP, default OFF",
      "os.environ.get('TEMPLATE_FIXED_SEED_FRAGMENT_KEEP', '0') != '0'" in src)

print()
if fails:
    print("FAILED: %d check(s)" % fails)
    sys.exit(1)
print("ALL PASS")
