# Universal corroboration-adopt over a taught box — `template_taught_corrob_adopt` (DARK, mig 153)

**2026-09-10.** Owner directive: *"a function that every read goes through for all fields — check all read
values, do 2 of them agree? great, then autofile if the confidence is there. this should be the last time we
need to deal with values not being corroborated."*

Advisors: **gary** (root cause + design), **007** (read-independence) → **Oracle SIGN OFF WITH CONDITIONS
C1-C4 + gate G1-G3** (`docs/oracle_log.md` 2026-09-10). Build DARK; **flip gated**.

---

## The exhibit (live -TEST build, all switches ON; extraction trace)
`ThornburyFasteners_delivery_docket_10.pdf`, Delivery Note, field `delivery_number`. Page prints **`DN-64472`**.
- The taught Stage-0.5 mapping box read **`IN-64470`** (clipped: leading `D→I` from the box shift + trailing
  `2→0`), committed @70/78 on taught authority, pad-window flag fired (`template_mapping_padcodeflag`, held).
- The **keyword** page-text family read **`DN-64472`** @93 — but "lost, superseded by IN-64470" (authority
  precedence, not a confidence contest).

So the correct value was read by an independent family and the doc still committed the garble + held.

## Root cause (gary, verified in code)
No arc lets an on-page corroborated alternative **adopt** over a Stage-0.5 taught winner that **flagged**:
- `_crosscheck_corroborated_alternative` fires only for `winner.method=="anchor_crop_crosscheck"` (engine.py:2357).
- `_universal_postmerge_verify` double-excludes: `_override_eligible`==False for any Stage-0.5 method
  (engine.py:7760, `_is_stage05_located` 1033) AND the `validation_note` guard (7768).
- The pad-window recovery is never `_remember_candidates`'d, so the corroboration record can't see the 2nd witness.

## 007's independence ruling (the crux)
The pad-window re-read and the taught crop are the **same method family** (both box-crop OCR of the taught
geometry — `_crosscheck_witness_bucket` engine.py:2320-2339; "same family = same pixels = counts for NOTHING"
engine.py:5294). The **only genuinely independent witness** for `DN-64472` is the keyword page-text read. So an
adopt-over-a-taught-box must gate on `_corrobLicensedKeyword` (the agreeing set must contain `keyword`), never
the two-crop `_corrobLicensed`. This is Oracle's edge-clip **C5** reused.

## The fix — `template_taught_corrob_adopt` (DARK, mig 153, seed OFF)
**Part A** (template_mapper.py, the `_maybe_pad_code` FLAG branch ~2717): stash
`out["_pad_witness"] = {value, confidence}` — surfaces the pad recovery. Additive `_`-key (engine pops it),
inert unless Part B reads it. HARD dep `template_pad_window_code` ON.

**Part B** (engine.py ~11940, BEFORE `_build_corroboration_emit`, AFTER universal_verify + the G1/Fix-A holds):
new arc `_taught_flag_corrob_adopt`. For a field where the winner is Stage-0.5 (`_is_stage05_located`) AND method
endswith `_padcodeflag` AND carries `_pad_witness`, AND `_uv_tier` is a **RESTORE tier** (ref/date/numeric/
percentage — NOT `supplier_name` identity, NOT `currency` totals):
1. Compute the corroborated alternative via the EXISTING `_uv_corroborated_alternative(winner, cands +
   [pad_witness as a mapping/crop leg], ocr_text, tier, ftype, require_crop=True)` (engine.py:2775 — already
   requires ≥2 distinct families + a crop leg + `_uv_present` page presence).
2. **ADOPT only if** `"keyword" in slot["fams"]` (**the guardrail**) AND `_uv_restore_demotion(...)` is None
   (V type-credible) AND **(C1) the keyword witness's box sits in/near the taught target box or shares its
   row-band** (the neighbour-bleed guard — ledger `box` engine.py:3711).
3. Adopt: `value=V`, `method=base+"_corrobadopt"` (KEEP the mapping family so the deposed `IN-64470`, also
   mapping, is same-family-skipped at emit and never enters `disagree` → the rebuilt record is
   `winner=DN-64472(mapping), agree=[keyword], disagree=[]` → both `_corrobLicensed` + `_corrobLicensedKeyword`
   True). Fold "adopted" into the recompute guard (engine.py:11968) so overall/needs_review/format penalty recompute.
4. Else: **byte-identical** — leave the flag + note.

## The seam (Oracle, honestly named)
- **Manual-anchor precedence** is narrowed: the arc engages ONLY where the mapper ITSELF raised a `_padcodeflag`
  (a self-declared clip — the taught box read a different value than its own widened window), never a clean teach
  (no `_pad_witness`). A deliberate teach is not silently reversed.
- **mig-152 M=2 belt:** today the belt BLOCKS the wrong `IN-64470` (keyword disagrees). After adopt, `DN-64472`
  wins and the deposed `IN-64470` is mapping-family (not a page family) → the belt correctly no longer fires. The
  arc RESOLVES the disagreement (the only cross-family voice genuinely agrees); it does not launder a safety.
  **But: the belt is no longer a backstop for the adopted value** — the keyword guardrail carries the full weight.
- **Neighbour bleed (the one hole):** the full-page keyword regex has zero positional binding, so it could latch a
  spatially-adjacent same-shape code → a genuine two-family agreement on a wrong-for-this-field value. **C1's
  positional guard is the close.**

## Oracle conditions (binding) + staging
- **C1 (FLIP-blocking):** the positional guard on the keyword witness (in/near the taught box or its row-band).
- **C2 — STAGE (the 87-vs-90 reconciliation):** the 88 critical floor blocks c<88 and is UNCHANGED by band-88, so
  **Phase 1** adopts review-bound (cap **87**, softened note *"Corrected from the taught box's clipped read —
  please confirm."*, note KEPT so a bleed still surfaces, no auto-file). **Phase 2** (raise to **90** → band-88
  auto-file) only after C1 + the fire census pass.
- **C3 — fail-safe pin:** no `_pad_witness` OR no keyword-agreeing slot ⇒ byte-identical (flag + note intact, held).
- **C4 — pin:** Part A's `_pad_witness` reaches Part B, and the arc is inert without `template_pad_window_code`.

## Verification gate (before the FLIP)
- **G1 — M=0:** 605-corpus OFF-vs-ON (`RR_APP_ENV=1`, `OCR_RENDER_DPI=200`, dedup `RR_IDS`) — zero new
  wrong-and-would-file, zero per-field accuracy drop. (Proves no-regression; the corpus rarely fires Stage-0.5.)
- **G2 — direct integration fixture** on a taught clipping template: (a) `DN-64472` adopts, `agree:[keyword]`,
  `disagree:[]`, both licences True; (b) **the adversarial census** — a same-shape-NEIGHBOUR layout where the pad
  over-reads the neighbour + keyword grabs it must NOT adopt (exercises C1; a green fixture lacking this is worse
  than none); (c) a pure-digit-slip alt is demoted, no adopt; (d) C3 byte-identical.
- **G3 — pins:** `digit_substitution_diff("IN-64470","DN-64472")`==-1 (pin the exhibit verdict either way); the
  same-family skip of the deposed value; the mig-152 gate silent-after-adopt but firing on a bleed.

Auto-file today = **zero** (triple-DARK: mig 153 + band-88 mig 145 + the corrob master, all seed-OFF).

## Slices
- Slice 0: mig 153 seed OFF + TEST_SWITCH_KEYS + env plumbing.
- Part A: the `_pad_witness` stash (template_mapper FLAG branch).
- Part B: the `_taught_flag_corrob_adopt` arc (Phase 1 review-bound cap 87 + softened note + the C1 positional
  guard + the keyword guardrail + recompute fold).
- Pins: unit (adopt / common-mode reject / neighbour-bleed reject / deliberate-teach untouched / digit-slip demote
  / OFF byte-identical) + JS licence pin + G-gate harness notes.
- Phase 2 (later, census-gated): raise the cap to 90 for band-88 auto-file.

## Separate — the residual "File up to N" offer (Oracle direction)
Auto-accept is already default-ON and files non-viewed siblings; the offer shows only for eligible docs the
operator is **viewing** (presence guard). **Suppress the click, keep the signal:** replace the consent offer for
viewed-but-eligible docs with the **in-view countdown** (`sweep_inview_countdown`, mig 103) — visible,
cancellable/pausable, and **never firing while a field editor is dirty**. Do NOT let a viewed doc auto-file with
zero signal. Correctness unchanged (same `isAutoFileEligible`). Its own small slice, designed separately.
