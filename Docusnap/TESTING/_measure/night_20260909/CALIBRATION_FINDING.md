# Calibration finding — docs HELD despite reading correctly (2026-09-09 night)

Mined from the two anomaly sweeps (`consensus.jsonl` 123 live + `consensus147.jsonl` 147 corpus). ~10% of held
docs read the filing-critical fields (issuer + ref + date) CORRECTLY at high confidence — held for reasons that
are review-volume, not real risk. Three sub-classes:

## 1. TOP — the stale type-note auto-file/UI ASYMMETRY (a real gap, ~6 docs)
Docs #52/#59/#61 (purchase_order), #88/#94 (worksheet), #76 (sales_order): **overall 100, every field
correct+high-conf**, yet held (`reason=flagged`) by the note *"Couldn't match this document to the supplier's
saved <Type> layout."*
- **Verified asymmetry:** the RENDERER suppresses this exact note on load once the type is confirmed-valid for
  the supplier (`_STALE_TYPE_NOTE`, renderer.js:2503) — DISPLAY only. The **auto-file gate / trust.js / engine do
  NOT strip it** (grep: no suppression outside the renderer). Copperfield has **21 confirmed worksheets + 21
  confirmed POs** → the type IS valid → the note is STALE → but the gate still holds the doc from auto-file.
- So the UI treats these docs as fine while the auto-file gate holds them. Any supplier the owner **confirms but
  never teaches a TEMPLATE** (common — these all have `template_id = null`) hits this on the docs that trigger
  the type-note.
- **Fix direction (approval-class, SAFE):** run the stale-type-note suppression in the auto-file gate too — or,
  better, the engine should not plant / should self-heal *"couldn't match saved layout"* when the supplier has
  confirmed docs of that type (not only when a taught template exists). Then these auto-file. reggie/gary + Oracle.

## 2. below-floor with correct critical fields (~5 docs) — format calibration
sales_order #80/#81/#68/#71 (+ invoice #28): overall **82–83** while issuer @95, ref @94–98, date @94 are all
correct. The overall is dragged below the auto-file floor by format weighting / a date soft-note (e.g. #80's
`order_date` carries a "Kept the read value…" keyword_override note). The FILING-critical fields are fine. This
is the `optional_soft_flag_autofile` (mig 142, DARK) + overall-confidence-calibration territory — a graduated
scope with every role read clean shouldn't sit below floor because a note shaved the overall.

## 3. genuine low-conf-but-correct (~1–2 docs) — legit hold
#9 delivery_note: `delivery_number` read `DN-84037` **correctly but @70** with a real box-drift shape-warn ("the
taught box has drifted off the value"). Correct value, genuinely low confidence → holding is right; the value is
recoverable (re-teach / the drift arcs).

## Bottom line
The single most valuable review-volume reducer is **#1** — a concrete UI-vs-gate asymmetry with a safe fix. It
alone would auto-file ~6/123 (5%) of the sample's held-but-perfect docs, and generalises to every
confirm-but-don't-teach-a-template supplier. #2 is a softer calibration play (mig 142 + overall calibration).
