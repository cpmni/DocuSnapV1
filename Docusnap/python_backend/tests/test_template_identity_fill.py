"""
test_template_identity_fill.py — corroboration-gated template-identity supplier FILL (2026-07-14 night;
gary-designed, Oracle-signed). When a template matched but the logo missed (supplier NULL), fill the
supplier from the template's DOMINANT CONFIRMED issuer so its taught anchors admit — but ONLY when the
template's DISTINCTIVE fingerprint words are ON THE PAGE (corroboration), and ALWAYS review-bound.

Load-bearing pins:
  - _template_identity_for_fill: majority (>=2, strict) / single (1/1) / None (ambiguous, thin, no tmpl);
    BOTH tiers carry a non-empty note (review-bound — Oracle blocking condition).
  - _template_identity_corroborated: TRUE only when >=3 distinctive fingerprint words are >=50% present.
    This is what stops a colliding-logo template (Cascade<->Northgate) imposing the WRONG supplier — a
    Cascade docket carries NONE of Northgate's distinctive words, so a Northgate template can't corroborate.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_template_identity_fill.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import (_template_identity_for_fill, _template_identity_corroborated,
                               _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE, _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY)

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond:
        fails += 1

def tmpl(dominant=None, count=None, total=None, name=None, fp=None):
    d = {}
    if dominant is not None: d["dominant_supplier"] = dominant
    if count is not None:    d["dominant_supplier_count"] = count
    if total is not None:    d["dominant_supplier_total"] = total
    if name is not None:     d["name"] = name
    if fp is not None:       d["keyword_fingerprint"] = fp
    return d

DOCSOL_TEXT = "SERVICE WORKSHEET  DOCUMENT SOLUTIONS  Ticket  Location  Work Address  Beaumont Care Homes Ltd"
CASCADE_TEXT = "CASCADE WATER SYSTEMS  DELIVERY DOCKET  Reading Reservoir  Springfield Works"
NORTHGATE_TEXT = "NORTHGATE TEXTILES  Weavers Mill  Preston Way  Delivery Docket"

def main():
    # ── _template_identity_for_fill: tiers ───────────────────────────────────
    r = _template_identity_for_fill(tmpl("Acme Ltd", 3, 4))
    check("majority tier", r and r["tier"] == "majority" and r["note"] == _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY)
    s = _template_identity_for_fill(tmpl("Acme Ltd", 1, 1))
    check("single tier", s and s["tier"] == "single" and s["note"] == _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE)
    check("BLOCKING: both tiers carry a review-bound note",
          bool(_TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY.strip()) and bool(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE.strip()))
    check("ambiguous 1/2 -> None", _template_identity_for_fill(tmpl("Acme Ltd", 1, 2)) is None)
    check("2/4 tie (not strict majority) -> None", _template_identity_for_fill(tmpl("Acme Ltd", 2, 4)) is None)
    check("implausible identity -> None", _template_identity_for_fill(tmpl("IN", 3, 3)) is None)
    check("None template -> None", _template_identity_for_fill(None) is None)
    check("never uses name (empty dominant + plausible name) -> None",
          _template_identity_for_fill(tmpl("", 1, 1, name="Northgate Textiles")) is None)

    # ── _template_identity_corroborated: validates the IDENTITY (the fill VALUE), not the layout.
    #    THIS is the poison-catcher — templates 4/5/7 are named 'Cascade' but dominant='Northgate'. ──
    check("fill 'DOCUMENT SOLUTIONS' corroborates on a DocSol page (name present)",
          _template_identity_corroborated("DOCUMENT SOLUTIONS", DOCSOL_TEXT) is True)
    check("POISON CATCH: fill 'Northgate Textiles' does NOT corroborate on a Cascade page (name absent)",
          _template_identity_corroborated("Northgate Textiles", CASCADE_TEXT) is False)
    check("fill 'Cascade Water Systems' corroborates on a Cascade page (own name present)",
          _template_identity_corroborated("Cascade Water Systems", CASCADE_TEXT) is True)
    check("fill 'Northgate Textiles' corroborates on a Northgate page (sanity)",
          _template_identity_corroborated("Northgate Textiles", NORTHGATE_TEXT) is True)
    check("value not on page (logo-only) -> False (fail-safe)",
          _template_identity_corroborated("Polychemtex Inc", CASCADE_TEXT) is False)
    check("empty value -> False", _template_identity_corroborated("", DOCSOL_TEXT) is False)
    check("empty ocr -> False", _template_identity_corroborated("DOCUMENT SOLUTIONS", "") is False)
    check("generic-only value ('The Company Ltd') -> False (no distinctive tokens)",
          _template_identity_corroborated("The Company Ltd", "The Company Ltd invoice") is False)

    # ── C3 (Oracle non-blocking): corroboration is WHOLE-PAGE, so a poisoned value present only as a
    #    RECIPIENT would corroborate — the review-bound NOTE (pinned above) is the safety; scoping to the
    #    issuer band is a future refinement. Pin the whole-page behaviour so it stays a conscious choice.
    check("C3: whole-page — a value present as a recipient DOES corroborate (note is the safety)",
          _template_identity_corroborated("Northgate Textiles", "Cascade Water Systems  Ship To: Northgate Textiles Mill") is True)
    # C4 (Oracle): the fill/override review-lock rests on the validation_note (trust.isAutoFileEligible
    # 'flagged'), NOT confidence 70. Both fill tiers carry a note (pinned at top). trust.js gate is pinned
    # in database/modules/test_scope_trust.js. Shared by the override poison-guard (TEMPLATE_PRECEDENCE_CORROBORATE).

    print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
