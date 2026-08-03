"""test_crosscheck_outlier_reconcile.py — Slice-1 crosscheck-outlier reconcile pins
(gary design + Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-03).

Run: py -3.12 python_backend/tests/test_crosscheck_outlier_reconcile.py

WHAT THIS PINS. anchor.py's authoritative-crop cross-check flips a crop-vs-fullpage DISAGREEMENT to
a FRESH full-page locate-OCR ('anchor_crop_crosscheck', capped 70 + "please verify") which then wins
Tier-A. But the fresh locate can ITSELF garble a valid-shaped digit (doc-09: correct crop+keyword+
mapping 'PO-83150', lone fresh-locate flip 'PO-83160') — so on disagreement ALONE the flip can be the
OUTLIER and discard the corroborated truth. This pass (engine._reconcile_crosscheck_outlier) owns the
flip-REFUTED direction: restore a >=2-INDEPENDENT-family (>=1 CROP-family) + page-present alternative
over an UNcorroborated flip. E2 owns the OPPOSITE (flip-corroborated / City-Office) direction.

THE ANTI-LOOSEN CONTRACT (locks BOTH directions so nobody can collapse to "always prefer full-page"
OR "always prefer crop"):
  • Direction A restores (mapping-backed AND ⊕-anchor-only via the preserved pre-flip crop — Oracle C1).
  • Direction B (City-Office): a page-present flip is corroborated -> NEVER overridden.
  • >=1 CROP-family leg required (bare 'anchor'/registration/keyword-alone can't restore — Oracle C2).
  • not-page-present / registration-only / winner-not-a-flip -> None (fail-toward-review).
The predicate is field-name-AGNOSTIC (no field_key param) so it heals custom codes identically; Slice-1
CROSSCHECK scope = _is_ref_like_key OR date (custom *_number/*_no/*reference* + date). booking_ref /
account_code / text / numeric are Slice-2 (the universal post-merge verify).
"""
import os, sys, inspect
try: sys.stdout.reconfigure(encoding='utf-8')   # cp1252 consoles choke on the ⊕ glyph
except Exception: pass
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))   # embeddable-python: seat backend dir
from extraction.engine import (                                   # noqa: E402
    _crosscheck_corroborated_alternative as alt,
    _crosscheck_witness_bucket as bucket,
    _CROSSCHECK_CORROB_CONF,
)
from extraction import anchor                                     # noqa: E402

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

XC = "anchor_crop_crosscheck"
def flip(v, preflip=None, method=XC):
    d = {"value": v, "method": method}
    if preflip is not None:
        d["_crosscheck_original"] = preflip
    return d
def cand(v, stage, method): return {"value": v, "stage": stage, "method": method}
def kw(v):    return cand(v, "1_keyword", "keyword")
def mp(v):    return cand(v, "0.5_mapping", "template_mapping")
def acrop(v): return cand(v, "2_anchor", "anchor_crop")
def areg(v):  return cand(v, "2_anchor", "anchor_registration")
def abare(v): return cand(v, "2_anchor", "anchor")
def axc(v):   return cand(v, "2_anchor", "anchor_crop_crosscheck")   # the post-flip garble in the ledger
def hint(v):  return cand(v, "2.5_hint", "hint")

PAGE_9150 = "Northgate Textiles\nPurchase Order\nOrder No. PO-83150\nDate 21/07/2026\n"
PAGE_CITY = "City Office Supplies\nInvoice\nInvoice No 152574\n"
PAGE_DATE = "Delivery Note\nDate 21/07/2026\nRef DN-5\n"

print("_CROSSCHECK_CORROB_CONF clears the 88 critical floor:")
check("restore confidence >= 88", _CROSSCHECK_CORROB_CONF >= 88)

print("\nDirection A — an uncorroborated flip is REFUTED by a corroborated alternative:")
check("mapping+keyword+crop agree PO-83150 -> restore PO-83150",
      alt(flip("PO-83160", preflip="PO-83150"), [mp("PO-83150"), kw("PO-83150"), axc("PO-83160")], PAGE_9150, False) == "PO-83150")

print("\nCondition 1 — the ⊕-anchor-only sibling (NO mapping) heals via the preserved pre-flip crop:")
check("keyword + pre-flip crop (no mapping) -> restore PO-83150",
      alt(flip("PO-83160", preflip="PO-83150"), [kw("PO-83150"), axc("PO-83160")], PAGE_9150, False) == "PO-83150")
check("C1 LOAD-BEARING: WITHOUT the pre-flip crop, keyword alone (1 family) -> None (would be a document fix)",
      alt(flip("PO-83160"), [kw("PO-83150"), axc("PO-83160")], PAGE_9150, False) is None)

print("\nDirection B — City-Office: a page-present flip is corroborated, NEVER overridden:")
check("flip 152574 is on the page -> None (untouched; the mangled crop 192074 can't win)",
      alt(flip("152574", preflip="192074"), [kw("152574"), mp("152574"), axc("152574")], PAGE_CITY, False) is None)

print("\nAnti-loosen — fail-toward-review (keeps the flip flagged):")
check("2-family alternative NOT present in the page text -> None",
      alt(flip("PO-83160", preflip="PO-99999"), [kw("PO-99999"), mp("PO-99999")], PAGE_9150, False) is None)
check("alternative agreed only by anchor_registration -> None (independence fraud excluded)",
      alt(flip("PO-83160"), [areg("PO-83150")], PAGE_9150, False) is None)
check("C2: keyword + bare-'anchor' (no crop-family leg) -> None",
      alt(flip("PO-83160"), [kw("PO-83150"), abare("PO-83150")], PAGE_9150, False) is None)
check("C2: two NON-crop families (keyword + hint), no crop leg -> None",
      alt(flip("PO-83160"), [kw("PO-83150"), hint("PO-83150")], PAGE_9150, False) is None)
check("winner is not a crosscheck flip (plain anchor_crop) -> None",
      alt({"value": "PO-83160", "method": "anchor_crop", "_crosscheck_original": "PO-83150"},
          [kw("PO-83150"), mp("PO-83150")], PAGE_9150, False) is None)
check("empty flip value -> None", alt(flip(""), [kw("PO-83150"), mp("PO-83150")], PAGE_9150, False) is None)

print("\nDate arm — calendar-aware, format-variant peers merge:")
check("uncorroborated flip 24/07 -> restore corroborated 21/07/2026",
      alt(flip("24/07/2026", preflip="21/07/2026"), [kw("21/07/2026"), mp("21/07/2026")], PAGE_DATE, True) == "21/07/2026")
check("format-variant peers (21/07 == 21-07) merge into one 21-July restore",
      alt(flip("24/07/2026", preflip="21-07-2026"), [kw("21/07/2026"), mp("21-07-2026")], PAGE_DATE, True) in ("21/07/2026", "21-07-2026"))

print("\nCustom PIN (Decision 3) — the predicate is value-driven, not name-keyed:")
check("a NON-PO custom code (MEM-4471) heals identically",
      alt(flip("MEM-4472", preflip="MEM-4471"), [kw("MEM-4471"), mp("MEM-4471")],
          "Membership Card\nMember No MEM-4471\n", False) == "MEM-4471")
check("predicate takes NO field_key param (not hardcoded to po_number or a name convention)",
      list(inspect.signature(alt).parameters) == ["winner", "cands", "ocr_text", "is_date"])

print("\nSlice-1 CROSSCHECK scope boundary (anchor._is_ref_like_key — the fire-gate, NOT widened):")
check("custom '*_number' covered: policy_number", anchor._is_ref_like_key("policy_number") is True)
check("custom '*_no' covered: membership_no", anchor._is_ref_like_key("membership_no") is True)
check("booking_ref -> Slice-2 (universal verify), crosscheck won't fire", anchor._is_ref_like_key("booking_ref") is False)
check("account_code -> Slice-2", anchor._is_ref_like_key("account_code") is False)

print("\nWitness bucket (finer than _method_family — Oracle C2):")
check("0.5_mapping -> (mapping, crop=True)",   bucket("0.5_mapping", "template_mapping") == ("mapping", True))
check("1_keyword -> (keyword, crop=False)",    bucket("1_keyword", "keyword") == ("keyword", False))
check("anchor_crop -> (crop, True)",           bucket("2_anchor", "anchor_crop") == ("crop", True))
check("anchor_registration EXCLUDED",          bucket("2_anchor", "anchor_registration") is None)
check("bare 'anchor' EXCLUDED",                bucket("2_anchor", "anchor") is None)
check("anchor_crop_crosscheck (the flip) EXCLUDED", bucket("2_anchor", "anchor_crop_crosscheck") is None)

print("\nWiring (source) — gated, byte-identical OFF, re-bases like E2:")
eng = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
anc = open(os.path.join(_HERE, '..', 'extraction', 'anchor.py'), encoding='utf-8').read()
check("kill switch module-level, default OFF",
      "CROSSCHECK_OUTLIER_RECONCILE = os.environ.get('CROSSCHECK_OUTLIER_RECONCILE', '0') != '0'" in eng)
pj = eng.find("if CROSSCHECK_OUTLIER_RECONCILE:")
pblk = eng[pj:pj + 1600] if pj != -1 else ""
check("the pass is gated on the kill switch", pj != -1)
check("fires only on anchor_crop_crosscheck winners", '!= "anchor_crop_crosscheck"' in pblk)
check("ALWAYS pops the transient _crosscheck_original stash", '_xd.pop("_crosscheck_original"' in pblk)
check("re-bases to _CROSSCHECK_CORROB_CONF + anchor_inline", "_CROSSCHECK_CORROB_CONF" in pblk and '"anchor_inline"' in pblk)
check("drops the flag (validation_note/was_corrected/corrected_to)",
      all(k in pblk for k in ("validation_note", "was_corrected", "corrected_to")))
check("pass runs immediately BEFORE the G1 veto-fallthrough block",
      pj != -1 and eng.find("# G1 (VETO-FALLTHROUGH corroboration guard", pj) - pj < 1600)
bf = eng.find("def _crosscheck_witness_bucket")
bblk = eng[bf:bf + 900] if bf != -1 else ""
check("bucket EXCLUDES registration + bare anchor + the flip (C2 in source)",
      '"anchor_registration", "anchor", "anchor_crop_crosscheck"' in bblk)
check("anchor.py stashes _crosscheck_original ONLY under the kill switch",
      'os.environ.get("CROSSCHECK_OUTLIER_RECONCILE", "0")' in anc and '_crosscheck_original' in anc)
check("anchor.py: the stash line sits AFTER the switch check (OFF path adds no key)",
      anc.find('_xcheck_preflip = value') > anc.find('CROSSCHECK_OUTLIER_RECONCILE'))

print(f"\n{fails} FAILED" if fails else "\nAll crosscheck-outlier reconcile pins passed")
sys.exit(1 if fails else 0)
