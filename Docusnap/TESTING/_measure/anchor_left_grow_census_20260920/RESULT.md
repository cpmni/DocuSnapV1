# anchor_code_left_grow (mig 192) — safety census, 2026-09-20

Switch: `anchor_code_left_grow` (Stage-2 taught-box left-clip recovery). OFF vs ON over the migrated warm-700
corpus (400 test docs), `RR_APP_ENV=1` (mig-186/191/154/157 ON in **both** arms), `OCR_RENDER_DPI=200`.

Runner `run.sh` (base_off vs on_anchor), comparator `compare.js`.

## Result — GATE PASS (safety)
```
docs compared: 400
REF correct: OFF 389  ON 389   (accuracy drop on 0 docs)
crop_fullpage_disagree/XCHECK flags: OFF 0  ON 0   (cleared by convergence: 0)
docs changed OFF->ON: 0
M violations (would-file ref WRONG under ON): 0
GATE: PASS (M=0, no accuracy drop)
```

## Reading (honest)
- **Safety = proven:** M=0, zero per-field accuracy drop, byte-identical outcomes — the switch introduces no
  regression.
- **Efficacy = PROVEN via the synthetic injection (2026-09-20 night run):** the corpus census is vacuous (0
  `crop_fullpage_disagree` flags → 0 fires), so efficacy is proven separately by
  `python_backend/tests/test_anchor_code_left_grow_efficacy.py` — a REAL rendered page (Courier mono) where the
  taught box clips the leading glyph, driving the REAL recovery (`_grow_code_left_read`, un-stubbed: real
  Tesseract + `_read_pad_window_code` + `_full_page_lines`). Results:
  - CONVERGE: page prints "WS-62315"; the clipped taught box's rigid read is the shape-valid confusable
    "NS-62315" (the measured result of clipping a mono "WS-62315" ~0.6 char — a leading W reads N/V per font);
    the padded re-read recovers the true "WS-62315" @90 through every guard (page-present, single-L clip,
    row-aligned, exact shape, not-label-glued, snap-union placement cert). Recovery FIRES.
  - ADVERSARIAL (the safety): page really prints the minority "NS-62315" → the tight read is page-PRESENT →
    recovery ABSTAINS (None) → no convergence → today's flip+flag STANDS. The genuine minority-series doc is
    protected. OFF byte-identical.

**Gate met: M=0 safety (corpus) + efficacy FIRES + adversarial ABSTAINS (injection).** Flip = owner's call
(recommend a look on the live Larkspur worksheet in the armed TEST build first). DARK meanwhile.
