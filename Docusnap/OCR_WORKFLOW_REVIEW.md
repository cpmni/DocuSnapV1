# OCR Workflow Review & Drift Fix — 2026-06-23

## TL;DR
The persistent **"value box drifts ~one row above the value, reading the row above"** was a
**Stage 0.5 placement bug**, not OCR reading and not your teaching. `_relocate_and_read`
derived the value crop off the **whole OCR LINE box** for a key/value row, so for a row like
`Ticket No.  2605-0769-1` it was either refused (`_located_too_wide`) or derived off the wrong
origin — and the field fell through to the **registration transform**, which read the row
above. **Stage 2 (`anchor.py`) never had this bug** — it inline-harvests the value off the
located line and derives off the tight `label_box`. The fix brings Stage 0.5 to parity.

Shipped, tested, and revertable. Details + full workflow review below.

---

## How it was diagnosed (multi-agent)
Created **agent `007`** (elite OCR engineer, `.claude/agents/007.md`) + the **`ocr-engineering`
skill**, then ran 007 + oscar + eric in parallel, each told to challenge the prior diagnosis:

- **eric (Electron/frame)** — *exonerated the teach coordinate frame*: your drawn boxes are
  stored faithfully image-normalized end-to-end. Found one minor real bug: a 1px image border
  shifting the preview overlay ~1px (fixed, see below).
- **oscar (OCR)** — identified the **Stage 0.5 ↔ Stage 2 asymmetry**: `_locate_anchor` already
  exposes `inline_value` + `label_box`; Stage 2 consumes both, Stage 0.5 consumed **neither**.
- **007 (OCR engineer)** — refuted all three of my original hypotheses, confirmed **placement
  not reading**, and additionally caught two structural issues: a **diagnostic capture-pollution
  bug** and a **coarse drift tolerance** that my own earlier `anchor_stable` fix sat on top of.

The three converged on the same layer (`_relocate_and_read` using the line box, missing the
inline harvest) → **the fix below.**

---

## Root cause (precise)
1. `_locate_anchor` returns the matched line's **whole box** as `x/y/w/h`, with the tight
   `label_box` and the trailing `inline_value` exposed separately (template_mapper.py:833-843).
2. `_relocate_and_read` used the **line** box for `_located_too_wide` and for the geometric
   inset/derivation, and **never** read `inline_value`. For a "label …gap… value" row this
   means: refuse, or derive a crop off the line's left edge (wrong column / wrong row).
3. With the relocation neutralised, `_extract_one` fell to the **registration transform**
   (`_read_registration`), whose imperfect global fit placed the box ~one row up → it read the
   row above (`TIONS`, `Colour Issues`). The offset and teach coords were always correct.

---

## Fixes shipped (committed · tested · revertable)
| Commit | Change | Test |
|---|---|---|
| `85fb5e0` | **Inline harvest + `label_box` geometry** in `_relocate_and_read` (parity with Stage 2), and the drift guard now invokes the relocation whenever the value is **inline** on the label's row (not only when `_label_drifted`). | `tests/test_inline_harvest.py` — passes on the fix, **proven to FAIL on the pre-fix code**. Full extraction suite green (pre-existing `failsafe` "Booking" BAD unchanged). |
| *(border)* | Move the preview image's 1px border to `#tpl-img-wrap` so the overlay canvas (sized to `offsetWidth`) aligns to the image content box, not a 2px-larger border box. | renderer-only; eric-validated |

**What this fixes, generally:** every "label …gap… value" key/value layout (invoices, POs,
worksheets, delivery notes) — not this one document. The value is now read straight off the
label's own OCR line, gated identically to a crop read.

---

## Full OCR-workflow review — contradictions / errors found
| # | Location | Issue | Status |
|---|---|---|---|
| 1 | `_relocate_and_read` 460-513 vs `anchor.py` | Used line box, no inline harvest → key/value drift | **FIXED** (`85fb5e0`) |
| 2 | `_locate_anchor` 833-843 | line box as `x/y/w/h`, `label_box` separate → consumers diverge | **FIXED for Stage 0.5** (now uses `label_box`) |
| 3 | `settings/index.html` `#tpl-img` border | border-box vs content-box → ~1px uniform overlay shift | **FIXED** (border→wrapper) |
| 4 | `resolve_geometry` 205 + rung captures (491/529/586) | **Capture pollution** — all rungs capture `kind="target"`; the returned/displayed box can be the **last rung to run, not the winner** | **DEFERRED** (see below) |
| 5 | `_label_drifted` 454-455 | `_DRIFT_FLOOR=0.02` fixed page-fraction is coarse for dense forms (one row ≈ 0.025-0.035) | **MITIGATED** for key/value rows (harvest runs regardless of drift); see remaining item |
| 6 | `_extract_one` 575-603 | absolute-first + `shape_mode='ignore'` lets a type-valid **wrong-row** value win on a *differing* doc | **MITIGATED** (relocate-primary when inline); residual for label-above layouts |
| 7 | `registration.py` | fit rejection present? | **VERIFIED PRESENT** — RANSAC outlier rejection, `_DEFAULT_RESIDUAL=0.02`, degenerate-fit `return None` (n<2/n<3/var≈0). Threshold *tuning* for sparse pages is a review item, not a defect. |
| 8 | `anchor.py` (Stage 2) | does it carry the same trap? | **NO** — Stage 2 was the working reference (inline harvest + `label_box`); no parity gap. |

---

## Remaining items (deferred — with fix designs, NOT shipped)
1. **Capture honesty (#4 above) — the diagnostic green box can show a non-winning rung's box.**
   *Why deferred:* the clean fix threads the read box into the result via `_mapping_result`
   (e.g. a private `target_geom` key) and has `resolve_geometry` return it — `_mapping_result`
   is used by the entire extractor, and I judged it too risky to ship on an **unattended** build
   without your eyes. *Important:* the inline-harvest fix returns early and captures its **own**
   box, so **your key/value case displays correctly already**; this only matters for the
   absolute-wins-after-a-failed-relocation edge case.
   **Fix:** add `geom=` to `_mapping_result` (store `result['target_geom']`), pass the box each
   rung actually read, and in `resolve_geometry` use `val.get('target_geom') or captured['target']`.

2. **Coarse drift floor for NON-inline (label-above) layouts.** The harvest sidesteps the
   tolerance for key/value rows, but a value that sits *below* its label on a borderline-shifted
   dense form could still `anchor_stable` to the drawn (wrong) row.
   **Fix:** tie `_label_drifted`'s `tol_y` to the **located line height** (`~0.5 × located h`)
   instead of the fixed `_DRIFT_FLOOR`.

3. **Registration fit-reject threshold tuning.** Rejection exists; whether the inlier-count /
   residual gate is tight enough for sparse worksheet landmarks deserves a focused pass with
   real fits. Low priority now (the harvest bypasses registration for key/value rows).

---

## Verify tomorrow
Install the new build → Template Manager → tick **Preview registration on this doc** → flip
between worksheets. The value boxes should now sit **on the values** with rung tag **`[map]`**
(anchor/inline), reading the real `2605-0769-1` / `22/05/2026` / company name — not `[REG]` on
the row above. The per-field `[rung] · moved %` readout confirms which mechanism placed each box.

## Rollback (if needed)
- Tag `pre-ocr-geometry-fix` marks the known-good state.
- `git revert <sha>` per focused commit (each fix is isolated), then rebuild.
- Or re-install a prior `dist/*.exe`.
- **No DB migrations** in any of this work → your templates, mappings, and landmarks are safe.
