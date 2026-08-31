"""
test_field_candidates.py — the disambiguation-picker BACKEND (v1): the candidate ledger box copy +
`engine._build_candidate_emit` + `_candidate_source_label` + the anchor `_norm_box_dict`.

Pins (Oracle conditions): emit ONLY for name-like non-supplier fields with a note AND >=2 distinct
candidates; dedup by _cmp_norm keeping a BOXED rep; chosen value first; cap 3; box copied into the
ledger; the CHOSEN value always an option; kill switch FIELD_CANDIDATES_EMIT; box is TOP-LEFT.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_field_candidates.py
"""
import os, sys, types
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import ExtractionEngine, _candidate_source_label, _cmp_norm
from extraction.anchor import _norm_box_dict

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

BOX = {"x_norm": 0.1, "y_norm": 0.2, "w_norm": 0.3, "h_norm": 0.05}

def emit(results, ledger):
    fake = types.SimpleNamespace(_field_candidates=ledger)
    return ExtractionEngine._build_candidate_emit(fake, results)

def cand(v, method="anchor_crop_relocated", conf=85, box=None):
    return {"value": v, "method": method, "confidence": conf, "box": box}

def noted(v, method="keyword", conf=69):
    return {"value": v, "method": method, "confidence": conf,
            "validation_note": "Two different names were read here — please verify."}

def main():
    os.environ.pop("FIELD_CANDIDATES_EMIT", None)

    # ── TRIGGER ──────────────────────────────────────────────────────────────
    results = {"customer_name": noted("Fernbank Veterinary Clinic")}
    ledger  = {"customer_name": [cand("Fernbank Veterinary Clinic", "keyword", 78),
                                 cand("Customer Site tee", "anchor_crop_relocated", 82, BOX)]}
    out = emit(results, ledger)
    check("emitted for a name field with note + 2 distinct candidates", "customer_name" in out)
    check("emit carries value+box+source_label+method+confidence",
          all(k in out["customer_name"][0] for k in ("value", "box", "source_label", "method", "confidence")))

    check("NO note → not emitted",
          "customer_name" not in emit({"customer_name": {"value": "X", "method": "keyword"}}, ledger))
    check("note but <2 distinct → not emitted",
          "customer_name" not in emit({"customer_name": noted("Only One")},
                                      {"customer_name": [cand("Only One", "keyword", 78)]}))
    check("supplier_name EXCLUDED (v1 scope)",
          "supplier_name" not in emit({"supplier_name": noted("Acme")},
                                      {"supplier_name": [cand("Acme", "logo", 90),
                                                         cand("Acme Ltd", "keyword", 70)]}))
    check("non-name field (invoice_number) → not emitted",
          "invoice_number" not in emit({"invoice_number": noted("INV-1")},
                                       {"invoice_number": [cand("INV-1", "keyword", 90),
                                                           cand("INV-2", "anchor_inline", 80, BOX)]}))

    # ── DEDUP / RANK ─────────────────────────────────────────────────────────
    dl = {"customer_name": [cand("Fernbank Veterinary Clinic", "keyword", 78),
                            cand("FERNBANK  VETERINARY CLINIC", "anchor_inline", 60, BOX),  # dup by _cmp_norm
                            cand("Customer Site tee", "anchor_crop_relocated", 82, BOX)]}
    reps = emit({"customer_name": noted("Fernbank Veterinary Clinic")}, dl)["customer_name"]
    check("dedup by _cmp_norm collapses the case/space duplicate (2 reps not 3)", len(reps) == 2)
    check("CHOSEN value ranked first (①)", _cmp_norm(reps[0]["value"]) == _cmp_norm("Fernbank Veterinary Clinic"))
    check("dedup keeps a BOXED representative for the chosen value",
          reps[0]["box"] is not None)   # the boxed anchor_inline dup is preferred over the box-less keyword

    # cap at 3
    big = {"customer_name": [cand(f"Name {i}", "anchor_inline", 90 - i, BOX) for i in range(5)]}
    big["customer_name"].insert(0, cand("Chosen", "keyword", 50))
    capped = emit({"customer_name": noted("Chosen")}, big)["customer_name"]
    check("capped at 3 candidates", len(capped) == 3)

    # the CHOSEN value is always present even if absent from the ledger
    miss = emit({"customer_name": noted("Late Value", conf=69)},
                {"customer_name": [cand("Alt A", "anchor_crop_relocated", 82, BOX),
                                   cand("Alt B", "anchor_inline", 70, BOX)]})["customer_name"]
    check("chosen value injected when missing from the ledger",
          any(_cmp_norm(c["value"]) == _cmp_norm("Late Value") for c in miss))

    # ── source_label mapping ─────────────────────────────────────────────────
    check("source_label: keyword → 'beside the label'", _candidate_source_label("keyword") == "beside the label")
    check("source_label: relocate → 'from the taught box'", _candidate_source_label("anchor_crop_relocated") == "from the taught box")
    check("source_label: logo → letterhead", _candidate_source_label("logo") == "from the logo/letterhead")

    # ── box normaliser (TOP-LEFT contract) ───────────────────────────────────
    check("_norm_box_dict centre→top-left (0.5,0.5,0.2,0.1)→(0.4,0.45)",
          _norm_box_dict((0.5, 0.5, 0.2, 0.1), True) == {"x_norm": 0.4, "y_norm": 0.45, "w_norm": 0.2, "h_norm": 0.1})
    check("_norm_box_dict top-left dict passthrough", _norm_box_dict(BOX, False) == BOX)
    check("_norm_box_dict bad/empty → None",
          _norm_box_dict((0, 0, 0, 0), True) is None and _norm_box_dict(None, False) is None)

    # ── ledger box copy (via _remember_candidates) ──────────────────────────
    fake = types.SimpleNamespace(_field_candidates={})
    ExtractionEngine._remember_candidates(fake, "2_anchor",
        {"customer_name": {"value": "V", "method": "anchor_crop_relocated", "confidence": 80, "box": BOX}})
    check("_remember_candidates copies the box into the ledger", fake._field_candidates["customer_name"][0]["box"] == BOX)
    fake2 = types.SimpleNamespace(_field_candidates={})
    ExtractionEngine._remember_candidates(fake2, "1_keyword",
        {"customer_name": {"value": "V", "method": "keyword", "confidence": 78}})
    check("box-less produced dict → ledger box None", fake2._field_candidates["customer_name"][0]["box"] is None)

    # ── Guard A: candidate OCR-validation (Oracle C4, 2026-07-15) ─────────────
    os.environ.pop("CANDIDATE_OCR_VALIDATE", None)
    def emit_ocr(results, ledger, ocr):
        fake = types.SimpleNamespace(_field_candidates=ledger)
        return ExtractionEngine._build_candidate_emit(fake, results, ocr)
    OCR = "Copperfield Electrical Delivery Docket Deliver To Stonegate Property Mgmt Durham DH1 3RW"
    # doc-14 bleed: an un-boxed HINT value NOT on the page is dropped → only the chosen remains → suppressed
    sand = {"customer_name": [cand("Stonegate Property Mgmt", "anchor_crop_relocated", 82, BOX),
                              cand("Sandpiper Hotels", "hint", 75, box=None)]}
    check("Guard A: off-page un-boxed hint dropped → only chosen left → picker SUPPRESSED",
          "customer_name" not in emit_ocr({"customer_name": noted("Stonegate Property Mgmt")}, sand, OCR))
    check("Guard A FAIL-SAFE: without ocr_text the Sandpiper candidate is KEPT (byte-identical)",
          "customer_name" in emit({"customer_name": noted("Stonegate Property Mgmt")}, sand))
    # a BOXED off-page candidate is KEPT (a box = a located on-page read); only un-boxed off-page is dropped
    mix = {"customer_name": [cand("Stonegate Property Mgmt", "anchor_crop_relocated", 82, BOX),
                             cand("Boxed Elsewhere Ltd", "anchor_inline", 80, BOX),   # off-page BUT boxed
                             cand("Sandpiper Hotels", "hint", 75, box=None)]}          # off-page + un-boxed
    vals = [c["value"] for c in emit_ocr({"customer_name": noted("Stonegate Property Mgmt")}, mix, OCR)["customer_name"]]
    check("Guard A: boxed off-page candidate KEPT", "Boxed Elsewhere Ltd" in vals)
    check("Guard A: un-boxed off-page candidate DROPPED", "Sandpiper Hotels" not in vals)
    # the CHOSEN winner is kept even if off-page + un-boxed (re-injected after the loop)
    chosen_out = emit_ocr({"customer_name": noted("Offpage Chosen Value")},
                          {"customer_name": [cand("Real Co On Page", "anchor_inline", 80, BOX)]},
                          "Header Real Co On Page footer")["customer_name"]
    check("Guard A: the CHOSEN value is kept even if off-page/un-boxed",
          any(_cmp_norm(c["value"]) == _cmp_norm("Offpage Chosen Value") for c in chosen_out))
    # a keyword candidate whose tokens ARE on the page is never dropped
    kept = [c["value"] for c in emit_ocr({"customer_name": noted("Stonegate Property Mgmt")},
                {"customer_name": [cand("Stonegate Property Mgmt", "anchor_crop_relocated", 82, BOX),
                                   cand("Durham DH1", "keyword", 60, box=None)]}, OCR)["customer_name"]]
    check("Guard A: an un-boxed candidate that IS on the page is kept", "Durham DH1" in kept)
    os.environ["CANDIDATE_OCR_VALIDATE"] = "0"
    check("Guard A kill switch=0 → off-page hint kept even with ocr_text",
          "customer_name" in emit_ocr({"customer_name": noted("Stonegate Property Mgmt")}, sand, OCR))
    os.environ.pop("CANDIDATE_OCR_VALIDATE", None)

    # ── HISTORY RANKING (owner exhibit ×3, 2026-08-11: 'Ltc' garble outranked 'Ltd') ─────────
    # A candidate exactly matching (under _cmp_norm) a value confirmed ≥3× in scope sorts FIRST
    # and carries confirmed_count; <3 confirms never promotes (frequency, not mere presence);
    # kill switch CANDIDATE_HISTORY_RANK=0 restores chosen-first. Ranking + label ONLY.
    os.environ.pop("CANDIDATE_HISTORY_RANK", None)
    def emit_hist(results, ledger, counts):
        fake = types.SimpleNamespace(_field_candidates=ledger, confirmed_counts_index=counts)
        return ExtractionEngine._build_candidate_emit(fake, results)
    hres = {"customer_name": noted("Bramblewood Joinery Ltc", "anchor_crop_relocated", 70),
            "_supplier_name": "Castellan Security Systems", "_document_slug": "service_worksheet"}
    hled = {"customer_name": [cand("Bramblewood Joinery Ltc", "anchor_crop_relocated", 70, BOX),
                              cand("Bramblewood Joinery Ltd", "keyword", 65)]}
    hcounts = {("castellan security systems", "service_worksheet", "customer_name"):
                   {_cmp_norm("Bramblewood Joinery Ltd"): 214}}
    hout = emit_hist(hres, hled, hcounts)["customer_name"]
    check("history: the ≥3-confirmed value outranks the chosen garble",
          _cmp_norm(hout[0]["value"]) == _cmp_norm("Bramblewood Joinery Ltd"))
    check("history: confirmed_count carried in the emit", hout[0].get("confirmed_count") == 214)
    check("history: the garble carries count 0", hout[1].get("confirmed_count") == 0)
    lowc = {("castellan security systems", "service_worksheet", "customer_name"):
                {_cmp_norm("Bramblewood Joinery Ltd"): 2}}
    lout = emit_hist(hres, hled, lowc)["customer_name"]
    check("history: <3 confirms never promotes (chosen stays first)",
          _cmp_norm(lout[0]["value"]) == _cmp_norm("Bramblewood Joinery Ltc"))
    # doc-type-scoped ('' supplier) fallback — the resolution order _make_format_lookup uses
    dtc = {("", "service_worksheet", "customer_name"): {_cmp_norm("Bramblewood Joinery Ltd"): 9}}
    dout = emit_hist(hres, hled, dtc)["customer_name"]
    check("history: doc-type-scoped ('') counts resolve as fallback",
          _cmp_norm(dout[0]["value"]) == _cmp_norm("Bramblewood Joinery Ltd"))
    os.environ["CANDIDATE_HISTORY_RANK"] = "0"
    kout = emit_hist(hres, hled, hcounts)["customer_name"]
    check("history kill switch=0 → chosen-first order restored",
          _cmp_norm(kout[0]["value"]) == _cmp_norm("Bramblewood Joinery Ltc"))
    os.environ.pop("CANDIDATE_HISTORY_RANK", None)
    check("history: a fake WITHOUT the counts index still emits (getattr guard)",
          "customer_name" in emit(hres, hled))

    # ── kill switch ──────────────────────────────────────────────────────────
    os.environ["FIELD_CANDIDATES_EMIT"] = "0"
    check("FIELD_CANDIDATES_EMIT=0 → nothing emitted", emit(results, ledger) == {})
    os.environ.pop("FIELD_CANDIDATES_EMIT", None)
    check("re-enabled → emits again", "customer_name" in emit(results, ledger))

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
