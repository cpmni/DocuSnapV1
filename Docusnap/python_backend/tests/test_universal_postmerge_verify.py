"""test_universal_postmerge_verify.py — Slice-2 universal post-merge verify pins
(gary+reggie+007 consensus → Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-03; docs/oracle_log.md).

Run: py -3.12 python_backend/tests/test_universal_postmerge_verify.py

WHAT THIS PINS. ONE post-merge pass beside Slice-1 (after it, before G1) over EVERY eligible field
winner: when the winner is tier-UNcorroborated and a DISAGREEING alternative is agreed by >=2
independent witness families (RESTORE tiers: >=1 crop leg) AND tier-present on the page, it acts.
RESTORE tiers = ref/code, date, whole-number numeric, percentage (re-based anchor_inline@90 —
Oracle D-1: never the witness's real method, that would mint Stage-0.5 authority). FLAG tiers =
text (minus supplier_name) + structured (email/website/postcode/vat/iban) — note-only, the note
NAMES the disagreeing value. EXCLUDED: currency (totals pass owns amounts) + supplier_name.

THE ANTI-LOOSEN CONTRACT (a future dev must NOT "fix" any of these):
  • A text field is NEVER value-changed — even a 3-family page-present alternative only flags
    (007: text divergence is bimodal; the tolerance that admits OCR jitter admits real-name pairs).
  • Numeric restores are WHOLE-NUMBER only (Oracle D-2); an alternative with a live decimal tail
    demotes to a flag. Sub-4-digit numerics are never restore targets (page presence is a hard AND
    and unavailable below 4 digits) — but a correct short WINNER ('42') is still DEFENSIBLE
    (floor-free winner-defence: gary's symmetry trap).
  • An identical-skeleton 1-2 digit-substitution alternative NEVER restores (D1's shared
    comparator; correlated glyph misreads are not independent evidence) — flag only.
  • '+corrected'/'+snapped' winners are untouchable (Oracle S-1: Stage-2.5b sets neither
    was_corrected nor a note; the corrected value is page-ABSENT by construction — the pass would
    otherwise un-fix the correction).
  • Slice-2 NEVER drops or composes an existing validation_note.
  • Lone absence never acts — only a corroborated disagreeing alternative can.
"""
import os, sys, inspect
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
os.environ['UNIVERSAL_VERIFY_RESTORE'] = '1'
os.environ['UNIVERSAL_VERIFY_FLAG'] = '1'
os.environ['UNIVERSAL_VERIFY_NUMERIC'] = '1'
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))   # embeddable-python: seat backend dir
from extraction import engine as E                                # noqa: E402

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

def mkengine(cands=None, patterns=None):
    e = E.ExtractionEngine.__new__(E.ExtractionEngine)
    e.patterns = patterns or {}
    e._field_candidates = cands or {}
    e.prefix_index = None
    e.length_index = None
    e.log = lambda *a, **k: None
    e._t = lambda *a, **k: None
    return e

def cand(v, stage, method): return {"value": v, "stage": stage, "method": method}
def kw(v):    return cand(v, "1_keyword", "keyword")
def mp(v):    return cand(v, "0.5_mapping", "template_mapping")
def acrop(v): return cand(v, "2_anchor", "anchor_crop")
def hint(v):  return cand(v, "2.5_hint", "hint")

FD = [
    {"key": "invoice_number", "type": "reference"},
    {"key": "booking_ref",    "type": "reference"},
    {"key": "account_code",   "type": "reference_code"},
    {"key": "invoice_date",   "type": "date"},
    {"key": "qty",            "type": "number"},
    {"key": "vat_rate",       "type": "percentage"},
    {"key": "site_name",      "type": "text"},
    {"key": "supplier_name",  "type": "text"},
    {"key": "total_amount",   "type": "currency"},
    {"key": "contact_email",  "type": "email"},
]

def run(results, cands, page, patterns=None):
    e = mkengine(cands, patterns)
    e._universal_postmerge_verify(results, FD, "invoice_number", ("invoice_date",),
                                  page, "Bramblewood", "invoice")
    return results

# ── Tier dispatch boundary ────────────────────────────────────────────────────
print("Tier dispatch (type-keyed, exclusions pinned):")
check("currency EXCLUDED", E._uv_tier("total_amount", "currency", None, ()) is None)
check("supplier_name EXCLUDED", E._uv_tier("supplier_name", "text", None, ()) is None)
check("booking_ref (Slice-1's named gap) -> ref tier", E._uv_tier("booking_ref", "reference", None, ()) == "ref")
check("account_code -> ref tier", E._uv_tier("account_code", "reference_code", None, ()) == "ref")
check("number -> numeric · percentage -> percentage",
      E._uv_tier("qty", "number", None, ()) == "numeric" and E._uv_tier("vat_rate", "percentage", None, ()) == "percentage")
check("text -> text (flag tier) · email -> structured",
      E._uv_tier("site_name", "text", None, ()) == "text" and E._uv_tier("contact_email", "email", None, ()) == "structured")

# ── RESTORE direction — a custom ref outside Slice-1's fire-gate heals ────────
print("\nRestore — custom ref (booking_ref: crop garble vs mapping+keyword agreed, page-present):")
PAGE_BR = "Booking Confirmation\nBooking Ref BK-7401\nDate 21/07/2026\nQty 7,400\n"
r = run({"booking_ref": {"value": "BK-74O1", "method": "anchor_crop", "confidence": 85}},
        {"booking_ref": [mp("BK-7401"), kw("BK-7401"), acrop("BK-74O1")]}, PAGE_BR)
d = r["booking_ref"]
check("restored to BK-7401", d["value"] == "BK-7401")
check("re-based anchor_inline (Oracle D-1 — never the witness's real method)", d["method"] == "anchor_inline")
check("confidence >= 90", d["confidence"] >= 90)

print("\nRestore bars (each leg load-bearing — fail-toward-review):")
r = run({"booking_ref": {"value": "BK-74O1", "method": "anchor_crop", "confidence": 85}},
        {"booking_ref": [kw("BK-7401"), hint("BK-7401")]}, PAGE_BR)
check("no crop-family leg -> untouched", r["booking_ref"]["value"] == "BK-74O1")
r = run({"booking_ref": {"value": "BK-74O1", "method": "anchor_crop", "confidence": 85}},
        {"booking_ref": [mp("BK-9999"), kw("BK-9999")]}, PAGE_BR)
check("alternative NOT page-present -> untouched", r["booking_ref"]["value"] == "BK-74O1")
r = run({"booking_ref": {"value": "BK-7401", "method": "anchor_crop", "confidence": 85}},
        {"booking_ref": [mp("BK-9999"), kw("BK-9999")]},
        "Booking Ref BK-7401\nAlt BK-9999\n")
check("winner page-present (corroborated) -> untouched even vs a corroborated alternative",
      r["booking_ref"]["value"] == "BK-7401")
r = run({"booking_ref": {"value": "BK-74O1", "method": "anchor_crop", "confidence": 85}},
        {"booking_ref": [mp("BK-7401")]}, PAGE_BR)
check("ONE family only -> untouched (lone witness never restores)", r["booking_ref"]["value"] == "BK-74O1")

# ── Date tier ─────────────────────────────────────────────────────────────────
print("\nDate tier (parse-gated, locate-and-parse presence):")
PAGE_DT = "Invoice\nDate 21 / 07 / 2026\nRef INV-9\n"
r = run({"invoice_date": {"value": "24/O7/2026", "method": "anchor_crop", "confidence": 85}},
        {"invoice_date": [mp("21/07/2026"), kw("21-07-2026")]}, PAGE_DT)
check("garbled (letter-glyph) date restored to calendar-agreed page-present 21/07",
      E._uv_date_agree(r["invoice_date"]["value"], "21/07/2026"))
r = run({"invoice_date": {"value": "24/07/2026", "method": "anchor_crop", "confidence": 85}},
        {"invoice_date": [mp("21/07/2026"), kw("21-07-2026")]}, PAGE_DT)
check("PURE-digit-substitution date (24/07 vs 21/07) DEMOTED to flag — never restored (S-2 pin)",
      r["invoice_date"]["value"] == "24/07/2026"
      and "21/07/2026" in str(r["invoice_date"].get("validation_note") or ""))
check("unparseable date witness is never a witness (parse-gate pin)",
      E._uv_corroborated_alternative({"value": "24/07/2026", "method": "anchor_crop"},
                                     [mp("zz/xx"), kw("zz/xx")], PAGE_DT, "date", "date", True) is None)
check("page ref '41026' never corroborates a date (locator needs separators)",
      not E._uv_date_page_present("04-10-2026", "ref 41026"))
check("page '14/10/2026' never corroborates '4/10/2026' (greedy leftmost)",
      not E._uv_date_page_present("04-10-2026", "Date 14/10/2026"))

# ── Numeric tier ──────────────────────────────────────────────────────────────
print("\nNumeric tier (whole-number boundary + symmetry pins):")
check("'1,600' == '1600' == '1600.00' agree",
      E._uv_numeric_agree("1600", "1,600") and E._uv_numeric_agree("1600", "1600.00"))
check("'1600' != '1600.50' != '116000'",
      not E._uv_numeric_agree("1600", "1600.50") and not E._uv_numeric_agree("1600", "116000"))
check("page '116000' never corroborates 1600", not E._uv_numeric_page_present("1600", "big 116000 end"))
check("page '1,250,000' never corroborates 250000 (grouped-tail steal closed)",
      not E._uv_numeric_page_present("250000", "Group 1,250,000"))
check("page '1,250.75' never corroborates 1250 (decimal interior)",
      not E._uv_numeric_page_present("1250", "Amt 1,250.75"))
check("page '16.00' never corroborates 1600", not E._uv_numeric_page_present("1600", "x 16.00 y"))
check("space grouping rejected as a witness ('1 600' fails the grammar)",
      E._uv_numeric_canon("1 600") is None)
r = run({"qty": {"value": "74001", "method": "anchor_crop", "confidence": 85}},
        {"qty": [mp("7400"), kw("7400")]}, PAGE_BR)
check("numeric whole-number restore: 74001 -> 7400 (page prints '7,400')", r["qty"]["value"] == "7400")
r = run({"qty": {"value": "412", "method": "anchor_crop", "confidence": 85}},
        {"qty": [mp("42"), kw("42")]}, "Qty 42\n")
check("sub-4-digit alternative NEVER restored (presence floor is a hard AND)", r["qty"]["value"] == "412")
r = run({"qty": {"value": "42", "method": "anchor_crop", "confidence": 85}},
        {"qty": [mp("412"), kw("412")]}, "Qty 42\nAlt 412\n")
check("SYMMETRY: correct short winner '42' page-defended (floor-free) -> untouched",
      r["qty"]["value"] == "42")
r = run({"qty": {"value": "5230", "method": "anchor_crop", "confidence": 85}},
        {"qty": [mp("5280"), kw("5280")]}, "Qty 5,280\n")
check("1-digit-substitution alternative DEMOTED to flag (D1 comparator pin) — value kept",
      r["qty"]["value"] == "5230" and "5280" in str(r["qty"].get("validation_note") or ""))
r = run({"qty": {"value": "74001", "method": "anchor_crop", "confidence": 85}},
        {"qty": [mp("7400.50"), kw("7400.50")]}, "Amt 7,400.50\n")
check("decimal-tailed alternative NEVER restores (whole-number-only, Oracle D-2) — flags",
      r["qty"]["value"] == "74001" and "7400.50" in str(r["qty"].get("validation_note") or ""))

# ── Text tier — FLAG ONLY, never a value change ──────────────────────────────
print("\nText tier (the tier-boundary pin — NEVER value-changed):")
PAGE_TX = "From Bramblewood Joinery Ltd\nUnit 4 Mill Lane\n"
# TRADE-OFF PIN (007 §1.1): a TRUNCATED winner is a cleaned SUBSTRING of the page print — its own
# tokens are all page-present, so it is self-corroborated and NOT flagged. The flag tier targets
# whole-token GARBLE (a page-absent read), not croppings of the true value. Do not "fix" this by
# removing the text winner-defence: that would flag a large share of correct crop reads.
res = {"site_name": {"value": "Bramblewood Joi", "method": "anchor_crop", "confidence": 80}}
r = run(res, {"site_name": [mp("Bramblewood Joinery Ltd"), kw("Bramblewood Joinery Ltd"),
                            hint("Bramblewood Joinery Ltd")]}, PAGE_TX)
check("truncated (substring-of-page) winner: NOT flagged (self-corroborated trade-off pin)",
      r["site_name"]["value"] == "Bramblewood Joi"
      and not str(r["site_name"].get("validation_note") or ""))
res = {"site_name": {"value": "nara Joic", "method": "anchor_crop", "confidence": 80}}
r = run(res, {"site_name": [mp("Bramblewood Joinery Ltd"), kw("Bramblewood Joinery Ltd"),
                            hint("Bramblewood Joinery Ltd")]}, PAGE_TX)
d = r["site_name"]
check("GARBLED (page-absent) winner vs 3-family alternative: value UNCHANGED (never restored)",
      d["value"] == "nara Joic")
check("...but FLAGGED, note NAMES the disagreeing value",
      "Bramblewood Joinery Ltd" in str(d.get("validation_note") or ""))
check("...confidence capped <= 69", d["confidence"] <= 69)
check("...doc held for review", r.get("_needs_review") is True)
check("tolerant AGREE: 'NORTHGATE TEXTILES LTD.' ~ 'Northgate Textiles Ltd'",
      E._uv_text_tokens_agree("NORTHGATE TEXTILES LTD.", "Northgate Textiles Ltd"))
check("northgate/northdale NEVER agree (budget-1, not name_match._close)",
      not E._uv_text_tokens_agree("Northgate Textiles", "Northdale Textiles"))
r = run({"site_name": {"value": "BRAMBLEWOOD JOINERY LTD.", "method": "anchor_crop", "confidence": 80}},
        {"site_name": [kw("Bramblewood Joinery Ltd"), hint("Somewhere Else Entirely")]}, PAGE_TX)
check("winner tolerant-agreed by a different family -> untouched (no false flag)",
      not str(r["site_name"].get("validation_note") or ""))

# ── Structured tier ───────────────────────────────────────────────────────────
print("\nStructured tier (flag-only; structural presence):")
check("letterhead 'John Doe, Acme Co' never 'contains' john.doe@acme.co",
      not E._uv_structured_page_present("email", "john.doe@acme.co", "John Doe, Acme Co"))
res = {"contact_email": {"value": "jhon.doe@acme.co", "method": "anchor_crop", "confidence": 80}}
r = run(res, {"contact_email": [kw("john.doe@acme.co"), hint("john.doe@acme.co")]},
        "Contact john.doe@acme.co\n")
check("email flag fires (note names alternative), value unchanged",
      r["contact_email"]["value"] == "jhon.doe@acme.co"
      and "john.doe@acme.co" in str(r["contact_email"].get("validation_note") or ""))

# ── Eligibility exclusions (each asserted) ────────────────────────────────────
print("\nEligibility exclusions (untouchable winners):")
PAGE_EL = "Booking Ref BK-7401\n"
CANDS_EL = {"booking_ref": [mp("BK-7401"), kw("BK-7401")]}
for label, winner in [
    ("authoritative", {"value": "BK-9999", "method": "anchor_crop", "confidence": 85, "authoritative": True}),
    ("Stage-0.5 located (template_mapping)", {"value": "BK-9999", "method": "template_mapping", "confidence": 85}),
    ("keyword_override", {"value": "BK-9999", "method": "keyword_override", "confidence": 85}),
    ("anchor_crop_crosscheck (Slice-1 territory)", {"value": "BK-9999", "method": "anchor_crop_crosscheck", "confidence": 70}),
    ("'+corrected' (Oracle S-1 — never un-fix Stage 2.5b)", {"value": "BK-9999", "method": "anchor_crop+corrected", "confidence": 85}),
    ("'+snapped'", {"value": "BK-9999", "method": "anchor_crop+snapped", "confidence": 85}),
    ("was_corrected", {"value": "BK-9999", "method": "anchor_crop", "confidence": 85, "was_corrected": True}),
    ("template_fixed literal", {"value": "BK-9999", "method": "template_fixed", "confidence": 85}),
]:
    r = run({"booking_ref": dict(winner)}, CANDS_EL, PAGE_EL)
    check(f"{label} -> untouched", r["booking_ref"]["value"] == "BK-9999"
          and not str(r["booking_ref"].get("validation_note") or ""))

r = run({"booking_ref": {"value": "BK-9999", "method": "anchor_crop", "confidence": 60,
                         "validation_note": "existing hold"}}, CANDS_EL, PAGE_EL)
check("existing validation_note -> untouched AND note preserved verbatim (never drop/compose)",
      r["booking_ref"]["value"] == "BK-9999" and r["booking_ref"]["validation_note"] == "existing hold")

print("\nExcluded fields (both tiers):")
r = run({"total_amount": {"value": "84.40", "method": "anchor_crop", "confidence": 85},
         "supplier_name": {"value": "Bramblewood Joi", "method": "anchor_crop", "confidence": 80}},
        {"total_amount": [mp("101.28"), kw("101.28")],
         "supplier_name": [mp("Bramblewood Joinery Ltd"), kw("Bramblewood Joinery Ltd")]},
        "Total 101.28\nBramblewood Joinery Ltd\n")
check("currency untouched (totals pass owns amounts)",
      r["total_amount"]["value"] == "84.40" and not str(r["total_amount"].get("validation_note") or ""))
check("supplier_name untouched (identity lane owns it)",
      r["supplier_name"]["value"] == "Bramblewood Joi" and not str(r["supplier_name"].get("validation_note") or ""))

# ── Switch semantics ─────────────────────────────────────────────────────────
print("\nSwitch semantics (OFF = byte-identical; census never mutates):")
_R, _F, _C = E.UNIVERSAL_VERIFY_RESTORE, E.UNIVERSAL_VERIFY_FLAG, E.UNIVERSAL_VERIFY_CENSUS
try:
    E.UNIVERSAL_VERIFY_RESTORE = E.UNIVERSAL_VERIFY_FLAG = E.UNIVERSAL_VERIFY_CENSUS = False
    res = {"booking_ref": {"value": "BK-74O1", "method": "anchor_crop", "confidence": 85}}
    snap = {k: dict(v) for k, v in res.items()}
    r = run(res, {"booking_ref": [mp("BK-7401"), kw("BK-7401")]}, PAGE_BR)
    check("all OFF -> results byte-identical", r == snap)
    E.UNIVERSAL_VERIFY_CENSUS = True
    logs = []
    e = mkengine({"booking_ref": [mp("BK-7401"), kw("BK-7401"), acrop("BK-74O1")]})
    e.log = lambda msg, *a, **k: logs.append(str(msg))
    res = {"booking_ref": {"value": "BK-74O1", "method": "anchor_crop", "confidence": 85}}
    import tempfile, json as _json
    _cf = os.path.join(tempfile.gettempdir(), "uv_census_pin_test.jsonl")
    try: os.remove(_cf)
    except OSError: pass
    os.environ['UNIVERSAL_VERIFY_CENSUS_FILE'] = _cf
    try:
        e._universal_postmerge_verify(res, FD, "invoice_number", ("invoice_date",), PAGE_BR, "S", "invoice")
    finally:
        os.environ.pop('UNIVERSAL_VERIFY_CENSUS_FILE', None)
    check("census-only: logged would-restore, value NOT mutated",
          res["booking_ref"]["value"] == "BK-74O1" and any("UV census" in x for x in logs))
    try:
        _row = _json.loads(open(_cf, encoding='utf-8').read().strip())
    except Exception:
        _row = {}
    check("census FILE sink written (harness record — the realdoc harness drops log lines)",
          _row.get("field") == "booking_ref" and _row.get("action") == "would-restore")
    E.UNIVERSAL_VERIFY_RESTORE = True
    E.UNIVERSAL_VERIFY_FLAG = False
    res = {"site_name": {"value": "Bramblewood Joi", "method": "anchor_crop", "confidence": 80}}
    r = run(res, {"site_name": [kw("Bramblewood Joinery Ltd"), hint("Bramblewood Joinery Ltd")]}, PAGE_TX)
    check("R-only: text flag tier stays dark", not str(r["site_name"].get("validation_note") or ""))
    E.UNIVERSAL_VERIFY_RESTORE = False
    E.UNIVERSAL_VERIFY_FLAG = True
    res = {"booking_ref": {"value": "BK-74O1", "method": "anchor_crop", "confidence": 85}}
    r = run(res, {"booking_ref": [mp("BK-7401"), kw("BK-7401"), acrop("BK-74O1")]}, PAGE_BR)
    check("F-only: restore tier stays dark (no restore, no demotion flag)",
          r["booking_ref"]["value"] == "BK-74O1" and not str(r["booking_ref"].get("validation_note") or ""))
    E.UNIVERSAL_VERIFY_RESTORE = True
    E.UNIVERSAL_VERIFY_FLAG = True
    E.UNIVERSAL_VERIFY_NUMERIC = False
    res = {"qty": {"value": "74001", "method": "anchor_crop", "confidence": 85}}
    r = run(res, {"qty": [mp("7400"), kw("7400")]}, PAGE_BR)
    check("stage-2b sub-gate (Oracle C6): numeric dark without UNIVERSAL_VERIFY_NUMERIC",
          r["qty"]["value"] == "74001" and not str(r["qty"].get("validation_note") or ""))
    E.UNIVERSAL_VERIFY_NUMERIC = True
finally:
    E.UNIVERSAL_VERIFY_RESTORE, E.UNIVERSAL_VERIFY_FLAG, E.UNIVERSAL_VERIFY_CENSUS = _R, _F, _C

# ── Wiring / ordering pins (source scans) ────────────────────────────────────
print("\nWiring (source) — placement + gating:")
src = inspect.getsource(E.ExtractionEngine.extract)
i_s1 = src.find("Crosscheck-outlier reconcile")
i_uv = src.find("self._universal_postmerge_verify(")
i_g1 = src.find("G1 (VETO-FALLTHROUGH")
check("pass runs AFTER Slice-1, BEFORE G1", 0 < i_s1 < i_uv < i_g1)
psrc = inspect.getsource(E.ExtractionEngine._universal_postmerge_verify)
check("gated on the switches (OFF returns immediately)",
      "UNIVERSAL_VERIFY_RESTORE or UNIVERSAL_VERIFY_FLAG or UNIVERSAL_VERIFY_CENSUS" in psrc)
check("restore re-bases anchor_inline (D-1)", "'method':     'anchor_inline'" in psrc)
dsrc = inspect.getsource(E.ExtractionEngine._uv_restore_demotion)
check("demotion uses D1's SHARED comparator", "digit_substitution_diff" in dsrc)

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILURES'}")
sys.exit(1 if fails else 0)
