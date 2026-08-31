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
check("…and names its branch 'fragment_agreement' (distinct from the debris 'fragment'; the garble arm labels its own)",
      "_fixed_decline = ('fragment_agreement'" in src and "else 'fragment_agreement_garble')" in src)
check("the flag reads TEMPLATE_FIXED_SEED_FRAGMENT_KEEP, default OFF",
      "os.environ.get('TEMPLATE_FIXED_SEED_FRAGMENT_KEEP', '0') != '0'" in src)

# ── GARBLE ARM (slice 1 of the garbled-issuer arc, 2026-08-22 evening; Oracle C1.1–C1.3) ──────────
# The owner's live run: the same one-line box read `NOCUMENT` @78 on two scans (one glyph wrong in
# ONE token) — P4's exact leg missed it, the garble won on authority and minted a "NOCUMENT" sender.
print("\n-- garble arm: OFF (byte-identical to P4) --")
E._FIXED_SEED_FRAGMENT_GARBLE_ON = False
check("(f) OFF: 'NOCUMENT' against the exhibit band → NOT kept (P4 exact, unchanged)",
      keep("supplier_name", FIXED, "NOCUMENT", BAND) is False)
check("(f) OFF: '_fragment_tokens_agree' is plain equality", E._fragment_tokens_agree(["nocument"], ["document"]) is False
      and E._fragment_tokens_agree(["document"], ["document"]) is True)

print("\n-- garble arm: ON --")
E._FIXED_SEED_FRAGMENT_GARBLE_ON = True
check("(a) 'NOCUMENT' (one edit of DOCUMENT) with the band printing DOCUMENT / SOLUTIONS → KEPT",
      keep("supplier_name", FIXED, "NOCUMENT", BAND) is True)
check("(a) 'SOLUTIGNS' (one edit of SOLUTIONS) → KEPT", keep("supplier_name", FIXED, "SOLUTIGNS", BAND) is True)
check("(b) 'Nocument Ltd' — two tokens = the whole fixed length → NOT kept (proper sub-run leg pinned)",
      keep("supplier_name", {"value": "Nocument Ltd", "method": "template_fixed", "confidence": 95}, "Nocument Ltd", BAND) is False
      and keep("supplier_name", FIXED, "NOCUMENT SOLUTIONS", BAND) is False)
check("(c) 'NOCUMENT' with the band NOT printing the stack → NOT kept (band leg is the proof)",
      keep("supplier_name", FIXED, "NOCUMENT", "SERVICE WORKSHEET\nDOCUMENT\nTicket\n") is False)
check("(c) band itself garbled ('NOCUMENT' / 'SOLUTIONS') → NOT kept (the band leg is never fuzzed — 1b refused)",
      keep("supplier_name", FIXED, "DOCUMENT", "SERVICE WORKSHEET\nNOCUMENT\nSOLUTIONS\nTicket\n") is False)
check("(d) 'MENT' / 'TIONS' (stamp-occluded scraps, length delta > 1) → NOT kept",
      keep("supplier_name", FIXED, "MENT", BAND) is False and keep("supplier_name", FIXED, "TIONS", BAND) is False)
check("(d) two edits ('NOCUMEMT') → NOT kept (budget is ONE)", keep("supplier_name", FIXED, "NOCUMEMT", BAND) is False)
check("(e) C1.2 sister exclusion: a fuzzed token that EXACTLY spells another template's identity token → NOT kept",
      E._fragment_agreement_keeps_seed("supplier_name", FIXED, {"value": "NOCUMENT"}, BAND, other_tokens={"nocument"}) is False)
check("(e) …positive control: other templates that do NOT carry the token leave the keep standing",
      E._fragment_agreement_keeps_seed("supplier_name", FIXED, {"value": "NOCUMENT"}, BAND, other_tokens={"castellan", "security"}) is True)
check("(e) _other_identity_tokens skips the matched template and reads dominant/name/fixed_value",
      E._other_identity_tokens([{"id": 1, "name": "DOCUMENT SOLUTIONS"},
                                {"id": 2, "name": "Nocument Ltd", "dominant_supplier": "Nocument Holdings",
                                 "fields": [{"field_key": "supplier_name", "is_variable": 0, "fixed_value": "Nocument Group"}]}],
                               {"id": 1}) == {"nocument", "ltd", "holdings", "group"})
check("(g) short-token seed stays EXACT: 'Lid' against fixed 'ACME Ltd' (band 'ACME / Ltd') → NOT kept; 'Ltd' → KEPT",
      keep("supplier_name", ACME, "Lid", "ACME\nLtd\n1 High Street\n") is False
      and keep("supplier_name", ACME, "Ltd", "ACME\nLtd\n1 High Street\n") is True)
check("(g) 'ACMF' against 'ACME Ltd' → NOT kept (4-char token, budget 0)",
      keep("supplier_name", ACME, "ACMF", "ACME\nLtd\n1 High Street\n") is False)
check("TRADE-OFF PIN (the named misfile path, accepted by the Oracle): a one-token read one edit from a "
      ">=6-char seed token on a page that prints the FULL seed as a stack keeps the seed — 'Nocument' alone",
      keep("supplier_name", FIXED, "Nocument", BAND) is True)
check("customer_name untouched by the garble arm",
      keep("customer_name", {"value": "DOCUMENT SOLUTIONS", "method": "template_fixed"}, "NOCUMENT", BAND) is False)
check("the branch label helper: exact sub-run vs garble", E._is_exact_token_subrun("DOCUMENT", "DOCUMENT SOLUTIONS") is True
      and E._is_exact_token_subrun("NOCUMENT", "DOCUMENT SOLUTIONS") is False)
check("the flag reads TEMPLATE_FIXED_SEED_FRAGMENT_GARBLE, default OFF",
      "os.environ.get('TEMPLATE_FIXED_SEED_FRAGMENT_GARBLE', '0') != '0'" in src)
check("the call site threads the other templates' tokens only when the garble arm is armed",
      "_other_identity_tokens(templates, matched_tmpl)" in src and "if _FIXED_SEED_FRAGMENT_GARBLE_ON else None" in src)
E._FIXED_SEED_FRAGMENT_GARBLE_ON = False

print()
if fails:
    print("FAILED: %d check(s)" % fails)
    sys.exit(1)
print("ALL PASS")
