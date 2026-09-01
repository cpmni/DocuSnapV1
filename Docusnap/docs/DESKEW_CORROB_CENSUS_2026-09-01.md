# DESKEW_CORROB_AUTOFILE — census (2026-09-01)

Oracle's flip gate for the DARK `deskew_corrob_autofile` arc (`aa61350`). Run on the owner's
rollout DB (`%APPDATA%\ScanFinder\docusnap.db`, mig 101, 166 confirmed — the leanest / most
warming-phase state available) over the deduped 605-paper corpus at 200 DPI (product DPI).

## Method
Two arms via `TESTING/_measure` census runners, both `DESKEW_REVIEW_RETRY=1`, differing ONLY by
`DESKEW_CORROB_AUTOFILE`:
- **baseline** (arc OFF) — full 605: exit 0, **33 straighten-adopted**, 25 docs carrying a
  "Read differently after straightening … confirm once" note (42 note-fields).
- **arc** (arc ON) — the 25 fired docs re-run.
Then diff: reads byte-identical? which notes did the arc drop? is each dropped-note `now` == GT?

## Result — GATE MET
- **Reads byte-identical across arms: 0 divergences** (the arc only touches notes/`corrected_to`).
- **Heals (arc dropped the hold): 4**, every one GT-correct (M = 0):
  - `doc1620_Pelican invoice_0049-4`  invoice_number  was `(empty)` → `PI/25/7476`  (GT `PI/25/7476`)
  - `doc1883_Pelican invoice_0023-15` invoice_number  was `P1/26/6000` → `PI/26/6000` (GT `PI/26/6000`)
  - `doc1884_Pelican invoice_0030-14` invoice_number  was `(empty)` → `PI/25/5450`  (GT `PI/25/5450`)
  - `doc213_Pelican invoice_0011-1`   invoice_number  was `(empty)` → `PI/25/3699`  (GT `PI/25/3699`)
- **38 fired note-fields correctly STAYED held** — no keyword page-text witness, no learned
  skeleton, or a disputed read. Includes the disputed-class date `08-08-2025` → `28-08-2025`
  (two credible dates differing) which the C4 seam correctly keeps for a human.
- **Disputed-class probe:** the only non-empty `was` among the heals is `P1/26/6000`, a garble that
  fails Pelican's `PI/NN/NNNN` skeleton (was_shape False) → a legitimate rescue. No skeleton-VALID
  differing `was` was ever dropped.

## Verdict
All of Oracle's flip conditions are satisfied: reads byte-identical, the auto-file set differs only
by an enumerated + human-verified list, M = 0, no disputed-class doc silently files. The arc is a
conservative, correct rescue of Pelican `invoice_number` in the warming phase.

**Recommendation:** the gate is met — `deskew_corrob_autofile` is safe to flip for the rollout.
Owner's call (flipping live is not done in this session). All 4 heals are correct; the arc healed
nothing it should not have and held everything ambiguous.
