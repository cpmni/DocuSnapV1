# DETECTION-DESKEW (skew-straighten for type detection) — PARKED / DO-NOTHING (2026-07-11)

**Status: PARKED by owner (2026-07-11).** Full advisor round run (oscar · reggie · gary · Oracle).
Decision: **do-nothing now.** This doc captures the analysis so a future session can revisit without
re-litigating.

## The proposal (owner)
During document-type detection at import, straighten (deskew) a **top ~25% slice** of the page in the
background, run detection on it, discard it — to improve type detection on skewed scans. Non-destructive.

## Verdict: don't build the proposed form; park the idea. WHY
1. **The top-slice shape is wrong** (all 3 specialists, independently):
   - `keyword.detect_document_type` scans the **whole page on purpose** — ~40% of real invoices carry the
     heading BELOW the top quarter (docstring `keyword.py:348-354`). A slice that REPLACES detection text
     loses those → regression. Any slice must be ADDITIVE.
   - A logo/letterhead-heavy top band **biases the projection-variance skew estimate** (`detect_skew_angle`
     needs many text lines) → measure the angle on the FULL page, never the slice.
   - A slice's `med_h` (median glyph height → row-grouping band width) inflates → **re-introduces the very
     MERGE failure it exists to cure** (Oracle: correctness, not cost — so **whole-page, not slice**).
2. **It is NOT fail-safe (Oracle's load-bearing catch).** The skew risk to detection is **row-grouping**,
   not character accuracy (reggie): SPLIT (tilted title's end drops → row breaks → multi-word title matches
   no single line) and **MERGE** (title band overlaps letterhead → a real word joins the line →
   whole-line `is_heading` equality fails → **`title_trusted` silently lost** while type may survive).
   On a skewed doc TODAY, MERGE suppresses `heading` → `title_trusted_fresh=False` → the three
   `identify_template` gates (prefer-sibling `template_matcher.py:88`, same-type rescue `:128`, refuse
   `:113/143`) are **DORMANT**. The rescue's whole job is to recover `title_trusted=True` → which **ARMS**
   those gates. If the recovered heading is WRONG (deskew mis-reads a Sales Order as "Invoice" @conf≥70):
   supplier has an Invoice sibling → **wrong-type template stamped + filed, silently, not to review**; or
   no sibling → **REFUSES a template raw would have matched** (today-correct doc → review). Two of three
   are NOT fail-toward-review. So "adopt when candidate strong" is insufficient — see the degrade-guard below.
3. **No evidence it's needed.** 1,000-doc demo at ~2–3° skew detects types correctly. Titles are the easiest
   thing OCR reads; the genuine rescue band is **~10–15°** = jammed feeder / phone photo, not a normal scan
   (≤3–4°). Auto-rotate (90/180/270) already handles gross rotation; born-digital is upright.

## Trigger to revisit
A **real skewed doc that misdetects its type** in normal use — OR the owner wants certainty and authorises
the read-only **sweep (Gate 0)** below to size the addressable population before committing any build.

## IF revisited — the agreed shape (do NOT rebuild from scratch)
**Gate 0 — read-only SWEEP first (may end it):** over the live corpus, born-digital-excluded, auto-rotated
docs with full-page `detect_skew_angle` ≥ ~3°: re-OCR **whole-page deskewed**, count docs that **GAIN
`heading=True` (conf≥70) they lacked raw** (heading-RECOVERY, not heading-ABSENCE — gary's predicate
over-counted). Classify each recovered doc's `identify_template` decision delta toward/away GT via
`test_harness/template_anchor.py`. Negligible recovery OR any "away-from-correct" tail → **DO-NOTHING**
(crossfield_sweep precedent). Real toward-correct cluster with zero away-from-correct → build.

**If built:** hook additive at `process_docs.py:489` (raw whole-page detection stays the baseline; extraction
inputs untouched — detection is text-only, no coordinate frame). Rescue candidate = **whole-page** deskewed
re-OCR (NOT slice). Env kill-switch `DETECT_SLICE_DESKEW` default OFF. Skip born-digital / sub-threshold skew.
Adopt the candidate ONLY when raw is weak (no trusted heading) AND candidate `heading=True` conf≥70 AND —
**degrade-guard (Oracle):** a rescue-recovered `title_trusted` may only ADD coverage where raw produced no
template match / no trusted type; it must NOT flip `identify_template` from a would-be-correct pick to
None/wrong. Never override a raw `heading=True`.

**Verification gate (M=0 alone is NOT sufficient — `document_type` is unscored by the field harness):**
type-flip side probe (zero flips away from correct type) + template-decision-delta audit (no doc newly
returns None/wrong template from a rescue-recovered heading) + `realdoc_regression` M=0 & zero per-field
drop (type flip → active field set → overall_confidence → auto-file-at-100 eligibility) + a **pinned unit
test that feeds a deskew-recovered WRONG heading** and asserts it is neither adopted over a good raw match
nor able to arm the `identify_template` refuse against a template raw would have matched.

**Files:** `process_docs.py:489,531-537,586-589,603,644-645` · `template_matcher.py:88-116,128-137,143-145`
· `keyword.py:314-336,421-431` · `tesseract.py:213-244` · `test_harness/template_anchor.py`.
