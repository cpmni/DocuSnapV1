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
- **Efficacy = NOT proven here (vacuous arm):** the synthetic corpus has **0** `crop_fullpage_disagree`
  flags to begin with, so the arm never fires → 0 changed. This is exactly the vacuous-arm limitation Oracle
  flagged: the corpus lacks the real taught-box clip shapes. Efficacy must be confirmed on the **live Larkspur
  worksheet** (the WS-62315 exhibit) — armed in the 2026-09-20 TEST build.

Flip = owner's call after live-exhibit efficacy is seen. DARK meanwhile.
