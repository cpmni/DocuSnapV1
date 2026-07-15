"""
test_caption_bleed_fuzzy.py — Guard B: the FUZZY caption-bleed guard (Oracle SIGN-OFF-WITH-CONDITIONS,
2026-07-15). A RIGID taught anchor_crop that landed on the field's own caption and OCR-garbled it
("Veliver 10°" from "Deliver To") must be HELD so the clean keyword wins — WITHOUT demoting a real
customer name that merely resembles a caption. Pins Oracle C1/C2/C3.

  cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_caption_bleed_fuzzy.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.anchor import _is_fuzzy_caption_bleed
from extraction.engine import _name_relocate_should_hold
from extraction.value_quality import name_quality

fails = 0
def check(label, cond):
    global fails
    print(("OK  " if cond else "BAD ") + label)
    if not cond: fails += 1

def main():
    # ── _is_fuzzy_caption_bleed predicate ─────────────────────────────────────
    check('fuzzy: "Veliver 10°" vs label "Deliver To" → True (D->V, To->10°)',
          _is_fuzzy_caption_bleed("Veliver 10°", "Deliver To", "customer_name") is True)
    check('fuzzy: clean "Ashcombe Care Homes Ltd" → False',
          _is_fuzzy_caption_bleed("Ashcombe Care Homes Ltd", "Deliver To", "customer_name") is False)
    check('fuzzy: empty value → False',
          _is_fuzzy_caption_bleed("", "Deliver To", "customer_name") is False)
    check('fuzzy: fires off the fixed vocab even with no taught label ("Veliver 10°", None)',
          _is_fuzzy_caption_bleed("Veliver 10°", None, "customer_name") is True)
    # a genuinely different name whose leading token isn't caption-shaped
    check('fuzzy: "Redwood Construction" → False (not a caption garble)',
          _is_fuzzy_caption_bleed("Redwood Construction", "Deliver To", "customer_name") is False)

    # ── Oracle C3: the name_quality < 0.6 CONJUNCTION is the precision lever ───
    # The fuzzy predicate ALONE can fire on a real company name; the caller's name_quality<0.6 gate is
    # what stops a demotion. Pin the quality scores the guard relies on.
    check('C3: name_quality("Veliver 10°") < 0.6 → the garble IS demotable',
          name_quality("Veliver 10°") < 0.6)
    check('C3: name_quality("Denver Trading") >= 0.6 → real name SURVIVES (even if fuzzy-matches "deliver")',
          name_quality("Denver Trading") >= 0.6)
    check('C3: name_quality("Delivery Solutions Ltd") >= 0.6 → real name SURVIVES',
          name_quality("Delivery Solutions Ltd") >= 0.6)
    check('C3: name_quality("Customer Care Ltd") >= 0.6 → real name SURVIVES',
          name_quality("Customer Care Ltd") >= 0.6)

    # ── engine hold: _name_relocate_should_hold admits the FLAGGED rigid crop (Oracle C2) ─────────
    KW      = {"method": "keyword", "value": "Ashcombe Care Homes Ltd"}
    BLEED   = {"method": "anchor_crop", "value": "Veliver 10°", "caption_bleed": True}
    PLAIN   = {"method": "anchor_crop", "value": "Veliver 10°"}                 # no flag
    AGREE   = {"method": "anchor_crop", "value": "Ashcombe Care Homes Ltd", "caption_bleed": True}
    RELO    = {"method": "anchor_crop_relocated", "value": "Veliver 10°"}       # shipped relocate path

    check('HOLD: rigid caption_bleed vs clean keyword → True (keyword wins, review-bound)',
          _name_relocate_should_hold(KW, BLEED, "customer_name") is True)
    check('PIN (Oracle C2): rigid anchor_crop WITHOUT the flag → False (Tier-A unchanged, byte-identical)',
          _name_relocate_should_hold(KW, PLAIN, "customer_name") is False)
    check('AGREE: flagged rigid that MATCHES the keyword → False (a real caption-word name survives)',
          _name_relocate_should_hold(KW, AGREE, "customer_name") is False)
    check('supplier_name is EXCLUDED (its own defences apply)',
          _name_relocate_should_hold(KW, BLEED, "supplier_name") is False)
    GARBLED_KW = {"method": "keyword", "value": "Xz9 q"}
    check('garbled keyword incumbent (name_quality < 0.6) → not held',
          _name_relocate_should_hold(GARBLED_KW, BLEED, "customer_name") is False)
    check('no incumbent → not held here (the anchor.py cap+note is the no-keyword fail-safe — Oracle C1)',
          _name_relocate_should_hold(None, BLEED, "customer_name") is False)
    check('shipped relocate path still admitted (RELOCATE_METHODS unchanged)',
          _name_relocate_should_hold(KW, RELO, "customer_name") is True)

    print('\n' + ('ALL PASS' if fails == 0 else f'{fails} FAILED'))
    sys.exit(1 if fails else 0)

main()
