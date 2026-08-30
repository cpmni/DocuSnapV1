# Straightened second opinion — deskew re-read of flagged docs (2026-08-30)

> ## ⏭ REVISED 2026-08-30 (what SHIPPED) — the field-scoped slice design below is SUPERSEDED
> A product-faithful **200 DPI** census on the owner's Nordwind corpus (the exact docs whose misreads
> prompted this) **falsified the field-scoped premise:**
> - The **slice arm fired 0 times** on the real misreads. The garbled supplier names read at 88–96%
>   confidence (Jordwind / iordwind / …Lt), so they are NOT *withheld* — and the slice arm is a sibling of
>   `_maybe_gate_reread`, which only runs on a value the format gate WITHHELD. Wrong layer for this class.
> - The **whole-page** straighten (the existing, Oracle-vetted `--deskew-pages` "Straighten + Reprocess"),
>   run at min-angle **0.3°**, healed **6 of 8** skew-garbled names (Jordwind→Nordwind, …Lt→…Ltd, one doc
>   56→97 overall), **0 regressions**. This is the owner's own manual remedy ("a straighten + reprocess
>   fixes it"), just automatic.
> - The empty **ref/date** on every Nordwind doc is a **template/first-batch extraction gap, NOT skew**
>   (present on 0°-skew docs too); straightening does not fill it. Handled as a **separate** task.
>
> **SHIPPED mechanism (kill switch `DESKEW_REVIEW_RETRY`, DEFAULT OFF; setting `deskew_review_retry_enabled`;
> floor `DESKEW_REVIEW_MIN_ANGLE`/`deskew_review_min_angle`, default 0.3°):** in `process_docs.py`, right
> after the normal `engine.extract`, a doc that **would land in review** (`_needs_review`) AND whose page is
> skewed ≥ the floor is **re-OCR'd straightened** and re-extracted; the straightened result is **adopted
> whole ONLY if its `_overall_confidence` is higher**, and the adopted doc is **forced `needs_review`**.
> Safety: it only ever runs on a doc **already** review-bound, so it can never demote a clean auto-file; a
> straightened read is **never silently auto-filed** (that was Oracle's 2026-07 SEND-BACK — auto-file, not
> review); skips upright pages, born-digital pages, `--reextract`, and an already-deskewed run. `engine.py`
> is back to a single-pass reader (the `_maybe_deskew_reread` hook + `ocr/deskew_reread.py` + its pin were
> removed). **Still DARK pending the M=0 corpus gate + Oracle ratify before any live flip.**
>
> Everything below is the ORIGINAL field-scoped exploration, kept for the reasoning + the measurement that
> redirected it. It is NOT what shipped.

---

**Status:** design, pre-Oracle. Owner request; barry (product) + oscar (OCR) advised; builds on the
Oracle-vetted `docs/designs/DESKEW_FIELD_REREAD_2026-07-14.md` (the whole-page version). **This spec
CHANGES the mechanism (slice, not page) and BROADENS the trigger (any misread / no-corroboration, incl.
ref/date), so it needs its OWN Oracle pass — the 2026-07 sign-off does not cover the broadened trigger.**

## 0. Owner observation & instruction
"Most docs that land in Review with a warning resolve with a straighten + reprocess. Retry any flagged
doc with a straighten + reprocess — but only where there's a potential misread OR no corroboration; NOT
the first import of a template-less sender; only where it would be beneficial. And straighten an EXPANDED
SLICE of the value we want to correct, not the whole page — we only need to re-read the fields with
errors; this saves time."

## 1. Shape — "straightened second opinion", FIELD-SCOPED, corroboration-gated
Not a whole-doc reprocess-and-replace (that is Oracle's SEND-BACK from 2026-07: a clean, *unflagged* ref/
date digit shifts under rotation, reads high-confidence, gets trusted → **silent wrong file**). Instead:
on a flagged FIELD in doubt, quietly re-read **that value's slice on a straightened crop**, and adopt the
new value **into that field only** IF it *gains corroboration the raw read lacked* — else the document is
untouched. Never a whole-record replace; never a sibling; never doc type or issuer identity.

**The corroboration gate is the star (owner's addition, an upgrade on the 2026-07 name-only rule).** It
does three jobs at once:
- **Adopt rule.** Keep the straightened read only if it now has **≥2 independent PAGE method-family
  agreement** {mapping, crop, keyword} that the raw read lacked. "Better" = "gained corroboration", NOT
  "higher confidence number" (a confident garble has a high number). Reuse the shipped `_corrobLicensed` /
  `critfield_corrob_floor_relax` predicate + `rereadHolds.corroborated()`. **Stamp the deskew read as its
  OWN method** so the corroboration bucket never counts it as agreeing with the raw family (two reads of
  the same tilted crop garble the same way — self-agreement is not evidence).
- **Self-protection.** When straightening garbles a header (proven to happen), the garble won't
  corroborate → discarded, raw kept. Immune to the known degradation *by construction*.
- **Auto-file licence.** Clearing the flag on the corroboration bar is the SAME bar that licenses every
  other silent auto-file — no new trust surface.

## 2. Trigger map
**FIRE** only when ALL hold: the field is flagged for **no-corroboration** OR a **likely-misread** warning
(caption-bleed / relocate-disagreement on a name; a date that won't parse; a reference with a shape
anomaly) AND **page skew ≥ ~3°** AND **not born-digital** AND **not already hand-straightened** AND the
field has a **stored raw value box** to expand (template mapping / prior read box / ⊕ anchor — a
keyword-only field with no box falls back to Option C, §4).

**DO NOT FIRE:** first import from a template-less sender (owner's gate; also where the type-flip hole is
worst — `DETECT_DESKEW_PARKED_2026-07-11.md`); born-digital; below the ~2–3° angle floor (Tesseract
self-tolerates; straightening only adds noise — this alone removes most of the queue); **type-ambiguity /
"sender not identified"** (type + identity flips are out of scope by construction); a required field simply
empty with no skew signal; a value already corroborated sitting under a cosmetic floor.

**Reality to state plainly:** this rescues a **skewed minority**, not a queue-wide reprocessor.

## 3. Slice recipe (oscar)
- **Angle θ = full-page `detect_skew_angle`** (`ocr/tesseract.py:767`), NEVER estimated from the value
  slice (too little text → noisy → risk of rotating the wrong way). For a rigid scan the page angle IS the
  correct local angle and is *more* robust. Cross-check optionally against the registration transform's
  rotation `atan2(m10,m00)` **only** when the fit is falsifiable (≥3 inliers); never use it as the applied
  angle. `orientation.py` (90/180/270 OSD) is irrelevant here.
- **Expand the crop** from the raw page around the known value box, pad each side by
  `Δy ≈ (Wv/2)·|sinθ| + q`, `Δx ≈ q` (drop the second-order `(1−cosθ)` terms), where **`q`** = a fixed
  quiet-zone (~0.3–0.5× cap-height, min ~8 px — the pad-window lesson, `oracle_log.md` 2026-08-07). Use
  PIL `rotate(expand=True)` on the crop so nothing clips; +~2 px resample border.
- **Anti-smear = RESOLUTION, not interpolation** (the refutation is settled: `DESKEW_SS_ROTATE` was built +
  refuted same-day 2026-08-05 — supersample-rotate garbles the same header; the smear is scan noise
  resampling into 1–2 px strokes under any rotation). Recipe: **greyscale (not binarised) → upscale
  (LANCZOS) to ~300-DPI-equiv (cap height ≥ ~30 px via `_ink_band_height`, `region_core.py:86`, not only
  the width rule) → single BICUBIC rotate about centre via `_apply_skew_rotation` (`:823`, the ONE rotation
  impl) → light-first ladder.** Order deliberately puts deskew BEFORE contrast/sharpen so sharpening hits
  straightened strokes. Do NOT enable SS-rotate; do NOT add OpenCV (interpolation isn't the lever).
- **Re-anchor** in the rotated crop by **label adjacency** (the caption rotated with the value — pick the
  run right-of/below it, `targeted_reread._nearest_label_pick`), fallback nearest-crop-centre.
- **Coordinate frame:** inverse-map the chosen box back to the RAW page frame. The forward chain is
  raw → crop(−origin) → **upscale ×s** → rotate(θ about the upscaled-crop centre), so the inverse must undo
  ALL THREE: rotate the box CENTRE by −θ about the upscaled-crop centre, **÷s (undo the upscale)** on both
  centre and size, then translate by the crop origin. **Keep the STORED RAW box's w/h** (the NO-BLOAT pin;
  do NOT take w/h from the rotated-upscaled frame — that bloats the overlay by `s` and by `w·sinθ`, pulling
  captions into the crop). Store **raw-frame coords** so the Review overlay draws on the value with no
  display change. Never store deskewed/upscaled-frame coords bare. Pin the round-trip at 1e-6 on a synthetic
  tilted+upscaled box (extend the existing NO-BLOAT pin).
- **PSM/ladder:** OEM 3, **PSM 7 primary** (single line), heavy PSM-7 fallback, add PSM 6 only when
  `_ink_band_count ≥ 2` (wrapped address). Cap-height upscale. For digit-bearing codes/refs/dates, constrain
  `tessedit_char_whitelist` to the field's **learned** shape charset (safe here because the adopt gate
  already requires kinship + independent corroboration).

## 4. Cost / build variant
The saving is **skipping the whole-doc re-extract** (re-OCR one tiny crop, no extraction stages), not the
rotate. Route the slice re-read through the **warm OCR worker** (`region_core.process`) + the trimmed PSM-7
ladder → cheapest. **Option C fallback** for a keyword-only field with no stored box: `targeted_reread.py`
already does locate → tight-crop re-read → adopt-gate on a *deskewed page* (1 `image_to_data` locate pass);
use it where §2's "stored raw box" precondition fails. Both share the same angle source + adopt gate. **No
new dependency** (Tesseract Apache-2.0 · pytesseract Apache-2.0 · Pillow HPND · NumPy/scipy BSD-3 · pypdfium2
BSD-3/Apache-2.0).

## 5. Adoption gate — the SEAM (read before building)
Clearing the flag REMOVES the human checkpoint on exactly the hard case (a skewed scan). Non-negotiables:
1. **Independent PAGE family, not a re-read of the same crop.** The deskew read must **bucket to the
   EXISTING `crop` family** (`_corrob_record_bucket`), NOT a new `deskew` family and NOT an unknown name.
   Rationale (Oracle 2026-08-30, load-bearing): a NEW family lets the raw `anchor_crop` candidate (family
   `crop` ≠ `deskew`) *agree* with the same-way garble → 2 families → licensed → **silent wrong file**
   (the doc-561 "same header garbles the same way under any rotation" case). An UNKNOWN name buckets to
   None → the agree-set is gated shut (`engine.py:4447`) → never licenses (fail-closed but inert). Only
   bucketing to `crop` is both safe AND useful: the raw same-family crop is *skipped* at `engine.py:4441`
   (same pixels/recipe = counts for nothing), so the deskew read can be licensed ONLY by an independent
   `keyword`/`mapping` read. A distinct provenance STRING for display ("read on a straightened copy") is
   fine; the BUCKET must be `crop`. Adopt only on **≥2 independent page-family corroboration** via the
   shipped `_corrobLicensed` — learned-shape / memory / hint are NOT families and never count toward the ≥2.
2. **Filing-critical fields (ref/date) stay REVIEW-BOUND by default** (fill/improve to "confirm once", NOT
   silent auto-file). A ref/date may SILENT-AUTO-FILE only through the shipped `critfield_corrob_floor_relax`
   **two-leg gate** (`trust.js:1118-1120`): `_corrobLicensed(corroboration)` (≥2 PAGE families, per R2)
   **AND** `valueMatchesShape(v, cls, sampleValues)`. **Both legs, always.** Learned-shape is an ADDITIONAL
   gate for silent-file, NEVER a substitute for the ≥2 page-family corroboration; corroboration alone never
   silent-files a ref/date either. (This is the widening past the 2026-07 name-only sign-off; §11 R1–R5 is
   the ruled condition set.)
3. **RAW is the privileged default** (the `delivery_docket_12` lesson): a clean raw read is never replaced
   by a lower-conf straightened garble. The trigger only fires on an already-FLAGGED field, so a clean raw
   read never enters this path — hold that gating exactly.

## 6. UX
- Fires silently (background lane arm; no spinner).
- **Improves + corroborates enough to auto-file:** files, and the receipt/activity chip carries one honest
  line — *"Straightened this scan so it read cleanly."* (a trust deposit).
- **Improves to confirm-once:** the note flips from "couldn't read/corroborate X" to *"Straightened this
  scan and it read more cleanly — confirm once."* via the exact `rereadHolds.js` confirm-once family.
- **Discarded:** the user sees NOTHING (doc byte-identical, still flagged with its original note). Do NOT
  announce failed retries (warning fatigue). Keep the attempt in the SFDEV/dev-inspector trace only.
- **Undo** falls out free (put-back for an auto-file; a Review edit for confirm-once). Tag the adopted
  value provenance = "read on a straightened copy".
- **Kill switch** `deskew_retry_ambiguous_enabled`, default state = **owner's call at flip** (ships DARK,
  per house rule, until the gate below is met).

## 7. Fit + one bug to fix in the same arc
- **New arm of the quiet-reread lane, routed through `src/modules/processing/rereadHolds.js`** — inherit the
  confirm-once notes, the per-(scope,field) reliability batch, the S3-C5 machinery; do NOT hand-roll holds.
- **Once-only stamp** (a `deskew_retry_at` column, mirroring `put_back_at`/`learning_excluded_at`) so it
  fires once per doc and never loops.
- **Slice-0 prerequisite:** `_extract_document`/region path able to re-OCR a rotated crop of one field.
- **Fix the manual "Straighten all" store-unconditionally bug** (the July design's Slice 2 — it stored the
  deskewed read even when worse, how `docket_12` got its worse @78 value): route it through a
  keep-the-better check, or make it display-only. **SEPARATE change / SEPARATE gate (Oracle C5):** it lives
  on the manual reprocess path, which `realdoc_regression` does NOT exercise, and its blast radius differs
  from the auto arc — so it ships as its own slice (S3) with its OWN census (reprocess of taught-box docs,
  Straighten ON, zero taught-field regression) + a "manual straighten never stores worse-than-raw" pin. Do
  NOT let it ride the auto arc's gate.

## 8. Failure modes → guardrails
1. Wrong-way rotation from a bad page angle (sparse/multi-column) → θ from the full page + ≥3° floor +
   keep-raw default + corroboration discards.
2. Local ≠ page angle (curl/perspective/feeder jog) → optional band-divergence abstain
   (`|θ_band−θ_page|>~1°`); primary guard = corroboration; these docs are fine left flagged.
3. **Caption-grab after expansion** (padded crop pulls in "BILL TO", re-locate picks the caption — the
   `DESKEW_RAW_CROPS` RED class) — *biggest risk*. Guard: label-adjacency re-locate + kinship-to-garble
   edit-distance gate (a caption is not kin to the garbled value) + known-caption vocab veto.
4. Smear garble → upscale-before-rotate + greyscale + light-first; corroboration backstop.
5. Overlay frame drift → inverse-map to raw frame, keep w/h (NO-BLOAT pin); never store deskewed coords.
6. Adopting on self-agreement → independent-family only; ref/date review-bound unless learned/confirmed.
7. Cold-spawn cost → warm worker + trimmed PSM-7 ladder.

## 9. Build slices
- **S0 (prereq):** rotated-crop single-field re-OCR path (byte-identical when unused; M=0 gated).
- **S1 (core safety spine, DARK):** the self-gates (angle floor / born-digital / not-already-straightened /
  stored-box) + field-scoped adoption with RAW-privileged default + the corroboration gate as adopt rule +
  show-your-work note / silence-on-discard.
- **S2 (lane wiring):** the `rereadHolds.js` arm + `deskew_retry_at` once-only stamp + the trigger map.
- **S3 (share the rule):** fold the manual Straighten-all into the same keep-the-better check.
- **S4 (receipt):** the "straightened so it read cleanly" activity line.

## 10. Verification gate (owner + Oracle before any flip)
- Realdoc **M=0 / M_type=0** OFF-vs-ON at the product DPI; the arm may only HEAL held docs, never gain a
  wrong auto-file. Non-vacuous: the gate must show it actually FIRED + adopted on skewed exhibits.
- A ≥3° skewed-corpus census: adopted-and-correct vs discarded; **zero** ref/date silent auto-files that
  aren't learned-shape/confirmed matches.
- Pins: the corroboration-independence rule; the NO-BLOAT inverse-map; ref/date review-bound; RAW-privileged
  on an already-flagged field only.
- **The broadened trigger onto ref/date is new vs the 2026-07 sign-off → Oracle re-rules it before code.**

## 11 · ⚖ Oracle gate — SIGN OFF WITH CONDITIONS (2026-08-30)
Right layer; genuinely discharges the 2026-07 seven vetoes (field-scoped from the start, fires only on an
already-flagged field, reuses the SHIPPED two-leg auto-file gate). Safe **only if these are pinned.** The
load-bearing pair is **C1 + R2/R3** — get the deskew read into the `crop` bucket and behind the two-leg
gate and the ref/date broadening carries no new silent-wrong-file surface.

**Ref/date condition set (R1–R5):**
- **R1** — fire only on an already-FLAGGED ref/date (won't-parse / shape-anomaly / no-corrob); never on a
  clean, parsing, shape-valid value.
- **R2** — ADOPT into the field only on **≥2 PAGE-family** corroboration via the real `_corrobLicensed`
  (page family required; learned-shape / memory / hint do NOT count); the deskew read **buckets to `crop`**
  (C1).
- **R3** — SILENT AUTO-FILE only through `critfield_corrob_floor_relax`'s two legs (`_corrobLicensed` **AND**
  `valueMatchesShape`). Never on corroboration alone; never on learned-shape alone.
- **R4** — a **type-valid** raw ref/date the deskew read DISAGREES with routes through
  `rereadHolds.holdChangedReads`' S3-C5 **two-value** "was X, now Y — check which is right"; the reassuring
  "read more cleanly — confirm once" note is reserved for a **non-type-valid** raw baseline (else it's a
  one-sided trust deposit biasing a possibly-wrong value).
- **R5** — `FIELD_CORROBORATION_DATE_FOLD` ON in this path (else every date reads as a disagreement); a
  deskew date must pass `validator.parse_date` before it is adoptable.

**Cross-cutting (C1–C5):**
- **C1 (bucketing, load-bearing)** — deskew read → the EXISTING `crop` bucket in `_corrob_record_bucket`;
  NOT a new family, NOT None (see §5.1). **Two-direction pin:** (i) deskew agreeing ONLY with the raw
  `anchor_crop` → NOT licensed; (ii) deskew agreeing with an independent `keyword` → licensed. A pin
  asserting a new family was added to `_CORROB_PAGE_FAMILIES` must FAIL.
- **C2 (record rebuild)** — specify WHO injects the deskew candidate into `_field_candidates[key]` and
  re-runs `_build_corroboration_emit` for that key BEFORE the hold/auto-file gate reads the row.
  `rereadHolds.corroborated()` only READS the stored record; without the rebuild the arc fails CLOSED (no
  heal) and §10's non-vacuous gate can't pass.
- **C3 (class-aware locate + guard)** — the **name** class re-locates by **label-adjacency** (read the run
  right-of/below the located caption — the 2026-07 anchor-relocate geometry), NOT `targeted_reread`'s
  similarity-to-garble (which returns the CAPTION for a caption-bleed name → leaves Kingfisher inert). The
  **ref/date** class uses garble-similarity locate. The kinship-to-garble gate applies to **ref/date only**
  (it's INVERTED for names — the name garble contains the caption, so kinship would accept it); the name
  class is carried by the **known-caption vocab veto + label-adjacency**.
- **C4 (inverse-map)** — undo rotation AND the ×s upscale (÷s) before translate; keep the STORED RAW box's
  w/h; extend the NO-BLOAT pin to the upscale round-trip (§3).
- **C5 (§7 split)** — the manual "Straighten-all" store-unconditionally fix ships as its OWN slice with its
  OWN census + pin (§7); it must NOT ride the auto arc's gate.
- **Whitelist dependency** — `tessedit_char_whitelist` is a HINT not a filter (forces a stray glyph into the
  set: S→5, a shape-clean garble); it is safe ONLY because the adopt gate then requires an independent page
  family to agree on the string. State the dependency so nobody drops corroboration while keeping the
  whitelist.
- **Citation fix** — the anti-smear evidence is the **2026-08-07 band-probe** (`oracle_log.md:546-549`: a
  generous crop on the deskewed 300-DPI frame reads fine; the casualty was the ~120-DPI locate pass), not
  the `DESKEW_SS_ROTATE` refutation (which downsamples back). Resolution + placement, not interpolation.

**Verification gate (tightened):** realdoc M=0 / M_type=0 proves INERTNESS not correctness (customer_name is
unscored — the 2026-07 caveat). ADD: a ≥3° skewed-corpus census with EXPLICIT counts (docs where the arm
fired / adopted / auto-filed) + **zero** ref/date silent auto-files that aren't `_corrobLicensed` AND
`valueMatchesShape`; a NEGATIVE census the `DESKEW_RAW_CROPS` RED would catch (zero caption commits into
name/free-text — the 'BILL TO'/'INVOICE TO'/'CUSTOMER' class); and pins each failing on its bug — C1 both
directions, R3 (learned-shape-alone doesn't license), R4 (disagreeing type-valid → S3-C5, not the reassuring
note), C4 round-trip, the docket_12 keep-raw pin carried forward, and a Kingfisher name-class heal pin
(proves C3 didn't leave the headline case inert). Full verdict logged in `docs/oracle_log.md`.
