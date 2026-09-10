"""test_taught_corrob_adopt.py — TAUGHT-CORROB-ADOPT (mig 153, 2026-09-10; gary+007 → Oracle SIGN-OFF-WITH-
CONDITIONS C1-C4). docs/designs/TAUGHT_CORROB_ADOPT_2026-09-10.md.

The MIRROR of the class `_universal_postmerge_verify` EXCLUDES: a Stage-0.5 taught winner that raised a
pad-window `_padcodeflag` (a self-declared clip) whose pad recovery the INDEPENDENT keyword page-text family
corroborates. Exhibit: Thornbury delivery_number — taught box read `IN-64470`, page prints `DN-64472`, the
keyword family read `DN-64472` → ADOPT `DN-64472` (PHASE 1: review-bound, cap 87 + softened note).

THE ANTI-LOOSEN CONTRACT (a future dev must NOT weaken these):
  • The agreeing set MUST contain the `keyword` (page-text) family — never two box-crops of the same clip
    (Oracle C5). A pad+anchor_crop agreement with NO keyword does NOT adopt.
  • C1 positional guard: a keyword witness whose located box is OFF the taught box's row is a NEIGHBOUR bleed
    → not adopted (the full-page keyword regex has no positional binding).
  • A 1-2 digit-substitution alternative NEVER adopts (_uv_restore_demotion; correlated glyph misreads).
  • No `_pad_witness` (a clean teach, or the arc's parent OFF) ⇒ byte-identical.

Run: py -3.12 python_backend/tests/test_taught_corrob_adopt.py
"""
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
os.environ['TEMPLATE_TAUGHT_CORROB_ADOPT'] = '1'          # arm BEFORE import (module reads the flag at import)
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(_HERE, '..')))
from extraction import engine as E                         # noqa: E402

fails = 0
def check(label, cond):
    global fails
    print(('OK  ' if cond else 'BAD ') + label)
    if not cond:
        fails += 1

def mkengine(cands=None):
    e = E.ExtractionEngine.__new__(E.ExtractionEngine)
    e.patterns = {}
    e._field_candidates = cands or {}
    e.prefix_index = None
    e.length_index = None
    e.log = lambda *a, **k: None
    e._t = lambda *a, **k: None
    return e

TAUGHT_BOX = [0.806, 0.142, 0.081, 0.015]                  # the taught target box (Thornbury delivery_number)
FD = [{"key": "delivery_number", "type": "reference"}]
OCR = "Delivery Note No. DN-64472  Date 14/07/2026"        # DN-64472 is page-present

def kwcand(v, box=None):
    c = {"value": v, "stage": "1_keyword", "method": "keyword_override"}
    if box is not None: c["box"] = box
    return c
def cropcand(v): return {"value": v, "stage": "2_anchor", "method": "anchor_crop"}

def winner(val="IN-64470", pad="DN-64472", box=TAUGHT_BOX, note=True):
    d = {"value": val, "display_value": val, "confidence": 78,
         "method": "template_mapping_padcodeflag"}
    if note: d["validation_note"] = "A wider reading of this box shows '%s' ..." % pad
    if pad is not None:
        d["_pad_witness"] = {"value": pad, "confidence": 93, "box": box}
    return d

def run(results, cands):
    e = mkengine(cands)
    adopted = e._taught_flag_corrob_adopt(results, FD, "delivery_number", (), OCR,
                                          "Thornbury Fasteners", "delivery_note")
    return adopted, results["delivery_number"]

# ── 1. ADOPT — the Thornbury exhibit (keyword page-text corroborates the pad recovery) ──────────────
res = {"delivery_number": winner()}
adopted, d = run(res, {"delivery_number": [kwcand("DN-64472", box=[0.79, 0.142, 0.07, 0.015])]})
check("ADOPT: keyword-corroborated pad recovery over a flagged taught box", adopted is True and d["value"] == "DN-64472")
check("ADOPT: display_value follows", d.get("display_value") == "DN-64472")
check("ADOPT: method carries _corrobadopt + keeps the mapping family (template_mapping_corrobadopt)",
      d["method"] == "template_mapping_corrobadopt")
check("ADOPT: capped 87 (Phase 1 review-bound, < 88 floor)", d["confidence"] == 87)
check("ADOPT: softened note KEPT (held for one confirm), stale flag replaced",
      "DN-64472" in (d.get("validation_note") or "") and "please confirm" in (d.get("validation_note") or "").lower())
check("ADOPT: _pad_witness consumed; no stale corrected_to", "_pad_witness" not in d and "corrected_to" not in d)

# ── 2. COMMON-MODE reject (Oracle C5) — pad + anchor_crop agree but NO keyword page-text witness ────
res = {"delivery_number": winner()}
adopted, d = run(res, {"delivery_number": [cropcand("DN-64472")]})   # crop family, not keyword
check("COMMON-MODE: pad(mapping)+anchor_crop(crop) agree but no keyword → NOT adopted (guardrail)",
      adopted is False and d["value"] == "IN-64470" and d["method"] == "template_mapping_padcodeflag")

# ── 3. NEIGHBOUR-BLEED reject (Oracle C1) — keyword witness located OFF the taught row ──────────────
res = {"delivery_number": winner()}
adopted, d = run(res, {"delivery_number": [kwcand("DN-64472", box=[0.79, 0.55, 0.07, 0.015])]})  # y=0.55, far row
check("NEIGHBOUR-BLEED: keyword witness box off the taught row → NOT adopted (positional guard)",
      adopted is False and d["value"] == "IN-64470")

# ── 4. DELIBERATE TEACH — no _pad_witness (a clean taught read) → never engaged ─────────────────────
res = {"delivery_number": winner(pad=None)}                # no _pad_witness
adopted, d = run(res, {"delivery_number": [kwcand("DN-64472", box=[0.79, 0.142, 0.07, 0.015])]})
check("DELIBERATE TEACH: no _pad_witness → arc never engages, value unchanged",
      adopted is False and d["value"] == "IN-64470")

# ── 5. DIGIT-SLIP demote — a 1-digit-substitution alternative is refused (correlated misread) ───────
res = {"delivery_number": winner(val="IN-64470", pad="IN-64478")}
adopted, d = run(res, {"delivery_number": [kwcand("IN-64478", box=[0.79, 0.142, 0.07, 0.015])]})
check("DIGIT-SLIP: IN-64470→IN-64478 (1 digit) demoted by _uv_restore_demotion → NOT adopted",
      adopted is False and d["value"] == "IN-64470")

# ── 6. OFF byte-identical ───────────────────────────────────────────────────────────────────────────
_orig = E._TAUGHT_CORROB_ADOPT_ON
E._TAUGHT_CORROB_ADOPT_ON = False
try:
    res = {"delivery_number": winner()}
    adopted, d = run(res, {"delivery_number": [kwcand("DN-64472", box=[0.79, 0.142, 0.07, 0.015])]})
    check("OFF: arc returns False, results byte-identical", adopted is False and d["value"] == "IN-64470")
finally:
    E._TAUGHT_CORROB_ADOPT_ON = _orig

# ── 7. source pins — the arc runs BEFORE the emit + folds into the recompute guard ─────────────────
src = open(os.path.join(_HERE, '..', 'extraction', 'engine.py'), encoding='utf-8').read()
check("arc runs BEFORE _build_corroboration_emit (so the record reflects the adopted winner)",
      src.index("_adopted_tca = self._taught_flag_corrob_adopt(") < src.index("_corrob = self._build_corroboration_emit(results)"))
check("arc is folded into the recompute guard", "_d4 or _adopted_tca:" in src)
check("guardrail is keyword-family (Oracle C5) + Phase-1 cap < 88",
      "'keyword' not in slot['fams']" in src and E._TCA_PHASE1_CAP < 88)

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
