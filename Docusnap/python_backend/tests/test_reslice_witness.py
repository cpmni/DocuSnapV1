"""test_reslice_witness.py — the RE-SLICE WITNESS SWEEP (2026-08-30, owner arc; oscar + 007 + reggie → Oracle).

Pins (no Tesseract — the line reader is a stub with per-line geometry):
  reader   : in-band line pick (0 / 1 / 2 qualifiers), the last-money-token rule, the STOP predicate
             (strict shape AND cents-equal AND sign-equal), the rung cap, the "never a disagreeing read".
  trigger  : _penny_reconciles (exact / ±2 %-only declines / sign mismatch / no subtotal).
  sweep    : OFF ⇒ 0 + ledger untouched; every decline leg (no note / not strict / not reconciled / no zone /
             zone already agrees / no agreeing rung); a fire injects EXACTLY ONE un-noted mapping-family
             candidate and commits NOTHING.
  end-to-end: the injected witness makes the record licensed and lets the SIGNED demoter
             `_demote_recon_total_corroborated_note` release the "adjusted to the total that balances" note
             under its own rails (crop-side family, ≥80, penny-exact, sign, arithmetic re-verify).

Run: py -3.12 python_backend/tests/test_reslice_witness.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from PIL import Image  # noqa: E402
from extraction import reslice as RS, engine as E  # noqa: E402

fails = []


def check(label, ok):
    print(f"  {'OK ' if ok else 'BAD'} {label}")
    if not ok:
        fails.append(label)


# ── a fake page + box: 1000x1000 px, the box 100x20 px at (800, 400) ──
PAGE = Image.new("L", (1000, 1000), 255)
BOX = {"x_norm": 0.8, "y_norm": 0.4, "w_norm": 0.1, "h_norm": 0.02}


def reader_with(lines_by_call):
    """A `_read_lines_full` stub: returns the next lines list per call (geometry in the prepped frame)."""
    calls = {"n": 0}

    def _fn(img, psm):
        i = min(calls["n"], len(lines_by_call) - 1)
        calls["n"] += 1
        lines = lines_by_call[i]
        text = "\n".join(l.get("text", "") for l in lines)
        return text, 90.0, 80.0, lines
    _fn.calls = calls
    return _fn


# R8 crop for BOX: vpad = hpad = 0.5*20 = 10 px → crop y0 = 390, the original band inside the crop = (10, 30);
# after the 20 px border the band is (30, 50) in the prepped frame.
def L(text, top, height, mean, words=None):
    """A `_read_lines_full` line dict; `words` = per-word (text, conf) — defaults to every word at `mean`."""
    ws = words if words is not None else [(w, mean) for w in text.split()]
    return {"text": text, "top": top, "height": height, "mean_conf": mean, "min_conf": mean, "words": ws}


IN_BAND = L("Total (inc VAT) £2,363.76", 31, 18, 92.0)
ABOVE = L("VAT @ 20% £393.96", 2, 18, 90.0)

print("pick_in_band_line:")
check("one in-band line -> picked", RS.pick_in_band_line([ABOVE, IN_BAND], (10, 30)) is IN_BAND)
check("no in-band line -> None", RS.pick_in_band_line([ABOVE], (10, 30)) is None)
check("two in-band lines -> abstain (never nearest-wins)",
      RS.pick_in_band_line([IN_BAND, dict(IN_BAND, text="£9,999.99")], (10, 30)) is None)
check("empty -> None", RS.pick_in_band_line([], (10, 30)) is None and RS.pick_in_band_line(None, None) is None)
check("C6: prep() never scales — the band offset is exactly the border",
      RS.prep(Image.new("L", (134, 38), 255)).size == (134 + 2 * RS.BORDER_PX, 38 + 2 * RS.BORDER_PX))

print("money_token / witness_agrees:")
check("the one strict token on a caption row (+ its own word conf)",
      RS.money_token("Total (inc VAT) £2,363.76", [("Total", 95.0), ("(inc", 95.0), ("VAT)", 95.0), ("£2,363.76", 61.0)]) == ("£2,363.76", 61.0))
check("no amount on the line -> None", RS.money_token("Total (inc VAT)") is None and RS.money_token("") is None)
check("C3: TWO strict amounts on the line (Net/Gross) -> abstain",
      RS.money_token("1,969.80 2,363.76") is None and RS.money_token("Net £1,969.80 Gross £2,363.76") is None)
check("a garbled tail ('£9 32632.76' = two amount-shaped tokens that do not rejoin) -> abstain",
      RS.money_token("Total (inc VAT) £9 32632.76") is None)
check("OCR-split tail rejoined as ONE amount", (RS.money_token("Total 2 363.76") or (None,))[0] == "2,363.76"
      and (RS.money_token("Total 2 363 76") or (None,))[0] == "2,363.76")
check("C3: an OCR-split tail with ANOTHER amount before it -> abstain", RS.money_token("VAT 393.96 2 363.76") is None)
check("agrees: cents + sign", RS.witness_agrees("£2,363.76", "2,363.76"))
check("disagrees: a dropped digit", not RS.witness_agrees("£2,363.7", "2,363.76"))
check("disagrees: one digit wrong", not RS.witness_agrees("£2,383.76", "2,363.76"))
check("disagrees: sign", not RS.witness_agrees("-2,363.76", "2,363.76"))
check("garbage never agrees", not RS.witness_agrees("£9 32632.76", "2,363.76"))

print("read_money_witness:")
fn = reader_with([[ABOVE, IN_BAND]])
w = RS.read_money_witness(PAGE, BOX, "2,363.76", read_lines_fn=fn)
check("R8 reads the in-band agreeing line -> witness at the amount's conf", w and w["value"] == "£2,363.76" and w["rung"] == "R8" and w["confidence"] == 92)
check("stopped at the first agreeing rung (one call)", fn.calls["n"] == 1)
# Oracle C4: the amount's OWN word confidence, never the caption-inflated line mean
DILUTED = L("Total (inc VAT) £2,363.76", 31, 18, 86.0, words=[("Total", 95.0), ("(inc", 95.0), ("VAT)", 95.0), ("£2,363.76", 60.0)])
fn = reader_with([[DILUTED]])
w = RS.read_money_witness(PAGE, BOX, "2,363.76", read_lines_fn=fn)
check("C4: caption@95 + digits@60 -> the witness carries 60 (below the demoter's 80 bar), not the line mean 86",
      w is not None and w["confidence"] == 60)
fn = reader_with([[L("1,969.80 2,363.76", 31, 18, 92.0)]])
check("C3: a two-amount in-band line -> no witness", RS.read_money_witness(PAGE, BOX, "2,363.76", read_lines_fn=fn) is None)
fn = reader_with([[dict(IN_BAND, text="Total £29,242.76")], [dict(IN_BAND, text="Total £29,242.76")]])
check("a DISAGREEING valid read is never returned (both rungs) -> None", RS.read_money_witness(PAGE, BOX, "2,363.76", read_lines_fn=fn) is None and fn.calls["n"] == 2)
fn = reader_with([[ABOVE], [ABOVE, IN_BAND]])
check("R8 abstains (no in-band line), R7 reads it -> witness R7", (RS.read_money_witness(PAGE, BOX, "2,363.76", read_lines_fn=fn) or {}).get("rung") == "R7")
fn = reader_with([[ABOVE], [ABOVE, IN_BAND]])
check("tries=1 caps the ladder -> None", RS.read_money_witness(PAGE, BOX, "2,363.76", read_lines_fn=fn, tries=1) is None and fn.calls["n"] == 1)
check("no page / no box / no committed -> None", RS.read_money_witness(None, BOX, "1.00") is None and RS.read_money_witness(PAGE, None, "1.00") is None and RS.read_money_witness(PAGE, BOX, "") is None)
os.environ["RESLICE_MAX_TRIES"] = "9"
check("RESLICE_MAX_TRIES is clamped to the ladder length", RS.max_tries() == len(RS.RUNGS))
os.environ.pop("RESLICE_MAX_TRIES", None)
check("default tries = 2", RS.max_tries() == 2)

print("_penny_reconciles:")
R_OK = {"total_amount": {"value": "2,363.76"}, "subtotal": {"value": "£1,969.80"}, "vat_tax": {"value": "£393.96"}}
check("1,969.80 + 393.96 = 2,363.76 exactly -> True", E._penny_reconciles("2,363.76", R_OK))
check("2,383.76 (within ±2 % but not penny-exact) -> False", not E._penny_reconciles("2,383.76", R_OK))
check("2,363.77 (one penny off) -> False", not E._penny_reconciles("2,363.77", R_OK))
check("no subtotal -> False (unknown is not reconciled)", not E._penny_reconciles("2,363.76", {"total_amount": {"value": "2,363.76"}}))
check("C2: tax NOT READ -> False even when subtotal == total (the 2026-08-06 false balance)",
      not E._penny_reconciles("1,969.80", {"total_amount": {"value": "1,969.80"}, "subtotal": {"value": "£1,969.80"}}))
check("C2: tax read as 0.00 is fine", E._penny_reconciles("1,969.80", {"total_amount": {"value": "1,969.80"}, "subtotal": {"value": "£1,969.80"}, "vat_tax": {"value": "0.00"}}))
check("sign mismatch (credit total vs positive subtotal) -> False", not E._penny_reconciles("-2,363.76", R_OK))
check("garbage total -> False", not E._penny_reconciles("9 32632.76", R_OK))
check("shipping tried IN and OUT", E._penny_reconciles("2,373.76", dict(R_OK, shipping={"value": "10.00"})))

print("_reslice_witness_sweep:")
NOTE = E.RECON_TOTAL_ADJUSTED_NOTE
MAPPING = {"field_key": "total_amount", "page_number": 0, "target_x_norm": 0.8, "target_y_norm": 0.4,
           "target_w_norm": 0.1, "target_h_norm": 0.02, "anchor_x_norm": 0.6, "anchor_y_norm": 0.4,
           "anchor_w_norm": 0.1, "anchor_h_norm": 0.02}


def mk(note=NOTE, committed="2,363.76", zone_read="29,242.76", mapping=MAPPING, pages=None, geom=None):
    res = {"total_amount": {"value": committed, "method": "keyword_override", "confidence": 93,
                            "validation_note": note},
           "subtotal": {"value": "£1,969.80", "method": "shadow_reconcile", "confidence": 87},
           "vat_tax": {"value": "£393.96", "method": "shadow_reconcile", "confidence": 90}}
    cands = {"total_amount": ([{"stage": "0.5_mapping", "method": "template_mapping", "value": zone_read,
                                "confidence": 90, "located": False, "noted": False}] if zone_read else [])
                             + [{"stage": "1_keyword", "method": "keyword_override", "value": "£2,363.76",
                                 "confidence": 93, "located": False, "noted": False}]}
    fake = types.SimpleNamespace(_field_candidates=cands, _s05_mappings=[mapping] if mapping else [],
                                 _s05_pages=(pages if pages is not None else [PAGE]),
                                 _s05_read_geom=({"total_amount": geom} if geom else {}), _reslice_witness={},
                                 _trace=False, _t=lambda *a, **k: None, log=lambda *a, **k: None,
                                 _recon_displaced={"total_amount": "29,242.76"})
    return fake, res


def sweep(fake, res, stub_lines=None, env="1"):
    """Run the sweep with the reader stubbed at the reslice module boundary."""
    orig = RS.read_money_witness
    if stub_lines is not None:
        fn = reader_with(stub_lines)
        RS.read_money_witness = lambda page, box, committed, read_lines_fn=None, tries=None: orig(page, box, committed, read_lines_fn=fn, tries=tries)
    if env is None:
        os.environ.pop("RESLICE_WITNESS_SWEEP", None)
    else:
        os.environ["RESLICE_WITNESS_SWEEP"] = env
    try:
        return E.ExtractionEngine._reslice_witness_sweep(fake, res, [])
    finally:
        RS.read_money_witness = orig
        os.environ.pop("RESLICE_WITNESS_SWEEP", None)


f, r = mk()
n0 = len(f._field_candidates["total_amount"])
check("OFF (unset) -> 0, ledger untouched", sweep(f, r, [[ABOVE, IN_BAND]], env=None) == 0 and len(f._field_candidates["total_amount"]) == n0)
f, r = mk()
check("OFF ('0') -> 0", sweep(f, r, [[ABOVE, IN_BAND]], env="0") == 0)
f, r = mk(note="")
check("decline: no note", sweep(f, r, [[ABOVE, IN_BAND]]) == 0)
# Oracle C1: ONE producer, ONE consumer — only the reconciliation pick's note triggers the sweep
f, r = mk(note="the total looks like the subtotal (tax not included) — please check")
check("C1 decline: a non-RECON note (net-misread) never triggers the sweep", sweep(f, r, [[ABOVE, IN_BAND]]) == 0 and len(f._field_candidates["total_amount"]) == 2)
f, r = mk(note="was read the same way by two independent methods — the attribution could not be verified")
check("C1 decline: the class-C shadow-attribution note never triggers the sweep (the seam)", sweep(f, r, [[ABOVE, IN_BAND]]) == 0)
# Oracle C10 (the item-3 seam): under the STRICT format-fail yield the mapping yields at the merge with the
# yield note and the pick early-returns — no RECON note — so the sweep declines and the doc stays held.
f, r = mk(note="Kept the read value “2,363.76” — a taught mapping read “£9 32632.76”, which doesn't match this field's expected format. Please check.")
check("C10 seam: the strict-yield note is not the sweep's trigger (held, by design — never flip strict-money before its census)",
      sweep(f, r, [[ABOVE, IN_BAND]]) == 0 and r["total_amount"]["validation_note"].startswith("Kept the read value"))
# Oracle C6: the mapper's 0-based page index is honoured as-is
f, r = mk(mapping=dict(MAPPING, page_number=1))
check("C6: page_number 1 with one page in hand -> decline (no_mapping_zone), never an off-by-one read", sweep(f, r, [[ABOVE, IN_BAND]]) == 0)
f, r = mk(mapping=dict(MAPPING, page_number=1), pages=[None, PAGE])
check("C6: page_number 1 reads pages[1]", sweep(f, r, [[ABOVE, IN_BAND]]) == 1)
f, r = mk(committed="9 32632.76")
check("decline: committed not strict money", sweep(f, r, [[ABOVE, IN_BAND]]) == 0)
f, r = mk(); r["subtotal"]["value"] = "£1,000.00"
check("decline: committed does not penny-reconcile", sweep(f, r, [[ABOVE, IN_BAND]]) == 0)
f, r = mk(mapping=None)
check("decline: no mapping zone", sweep(f, r, [[ABOVE, IN_BAND]]) == 0)
f, r = mk(zone_read="£2,363.76")
check("decline: the zone's own read already agrees (no witness needed)", sweep(f, r, [[ABOVE, IN_BAND]]) == 0)
f, r = mk()
check("decline: no agreeing rung (the zone re-reads the garble again)", sweep(f, r, [[dict(IN_BAND, text="£29,242.76")], [dict(IN_BAND, text="£29,242.76")]]) == 0
      and len(f._field_candidates["total_amount"]) == 2 and f._reslice_witness == {})
f, r = mk()
before = dict(r["total_amount"])
n = sweep(f, r, [[ABOVE, IN_BAND]])
led = f._field_candidates["total_amount"]
check("FIRE: exactly one witness injected", n == 1 and len(led) == 3)
w = led[-1]
check("the witness is an un-noted, non-located mapping-family read at the line's conf",
      w["method"] == "template_mapping_resliced" and w["stage"] == "4.7_reslice" and w["noted"] is False
      and w["located"] is False and w["confidence"] == 92 and w["value"] == "£2,363.76"
      and E._crosscheck_witness_bucket(w["stage"], w["method"]) == ("mapping", True))
check("the sweep COMMITS NOTHING (results untouched)", r["total_amount"] == before)
check("provenance recorded", f._reslice_witness["total_amount"]["rung"] == "R8")
f, r = mk(geom=[0.8, 0.4, 0.1, 0.02])
check("the box the mapper actually read is preferred when known", sweep(f, r, [[ABOVE, IN_BAND]]) == 1)

print("end-to-end: witness -> record licensed -> the signed demoter releases the note:")
f, r = mk()
sweep(f, r, [[ABOVE, IN_BAND]])
f._val_types = {"total_amount": "currency"}
rec = E.ExtractionEngine._build_corroboration_emit(f, r)["total_amount"]
check("record: mapping now agrees (the garble is suppressed by its family's agreement) -> licensed",
      rec["agree"] == ["mapping"] and rec["disagree"] == [] and E._corrob_licensed(rec))
os.environ["RECON_TOTAL_NOTE_DEMOTE"] = "1"
try:
    corrob = {"total_amount": rec}
    fired = E.ExtractionEngine._demote_recon_total_corroborated_note(f, r, corrob)
    check("demoter fires on the sweep witness: note released, value unchanged, no confidence minted",
          fired and r["total_amount"].get("validation_note") is None and r["total_amount"]["value"] == "2,363.76"
          and r["total_amount"]["confidence"] == 93 and r["total_amount"]["method"].endswith("+corrob_clear"))
    check("provenance: the demoter names the resliced witness",
          corrob["total_amount"]["note_demoted"]["witness_method"] == "template_mapping_resliced")
    # CONTROL: without the sweep the same doc keeps its note (the founding hold)
    f2, r2 = mk()
    rec2 = E.ExtractionEngine._build_corroboration_emit(f2, r2)["total_amount"]
    check("control: no witness -> record NOT licensed, demoter declines, note stands",
          not E._corrob_licensed(rec2) and not E.ExtractionEngine._demote_recon_total_corroborated_note(f2, r2, {"total_amount": rec2})
          and r2["total_amount"]["validation_note"] == NOTE)
    # Oracle C5: PASS-2 (joint subtotal+total election) — the total's note releases, the SUBTOTAL's note
    # survives (the pair elected each other; no independent per-field witness), the doc stays held.
    f3, r3 = mk()
    r3["subtotal"]["validation_note"] = "adjusted to the subtotal that balances against the total — please verify"
    sweep(f3, r3, [[ABOVE, IN_BAND]])
    rec3 = E.ExtractionEngine._build_corroboration_emit(f3, r3)["total_amount"]
    E.ExtractionEngine._demote_recon_total_corroborated_note(f3, r3, {"total_amount": rec3})
    check("C5 PASS-2: total note released, subtotal note SURVIVES (doc still held by it)",
          r3["total_amount"].get("validation_note") is None and r3["subtotal"]["validation_note"].startswith("adjusted to the subtotal"))
finally:
    os.environ.pop("RECON_TOTAL_NOTE_DEMOTE", None)

print(f"\n{'FAIL ' + str(len(fails)) if fails else 'test_reslice_witness: all checks passed'}")
sys.exit(1 if fails else 0)
