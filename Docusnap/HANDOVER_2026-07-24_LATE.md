# HANDOVER — 2026-07-24 LATE (Opus 5, xhigh; then Opus 4.8 re-review + overnight)

## 🌙 OVERNIGHT AUTONOMOUS RESULTS (Opus 4.8, owner asleep — READ THIS FIRST)

Owner asked to finish the fixes, test fully, and explore any remaining gap + propose a morning fix.
**Nothing committed, nothing pushed. All changes kill-switched / revertable. The late-rescue sticky
cap is DONE and gate-clean; the full test suite is clean of my change; the one remaining genuine gap
(#183) is root-caused with two proposed fixes below — NOT built (needs the advisor gate).**

### 1. Late-rescue sticky cap — FINISHED + FULLY TESTED ✅
- Built, unit-tested, corpus-A/B-gated (details in the "BUILT THIS RE-REVIEW" block below).
- **FULL Python test suite run (all 179 files, twice — once to expose a runner charmap artefact,
  once clean with `PYTHONIOENCODING=utf-8`): 170 PASS.** The 8 non-pass are ALL pre-existing or
  non-tests, ZERO caused by my change, and I FIXED one previously-failing file:
  - `test_late_anchor_rescue.py` — **was one of CLAUDE.md's catalogued 7-fails, now GREEN** (my fix).
  - Pre-existing (confirmed by `git stash` of my change → still fail, or catalogued in CLAUDE.md):
    `test_anchor_crop_crosscheck(3)`, `test_template_rescue(1)`, `test_identity_fusion`,
    `test_reprocess_manifest` (stale doc_overrides tuple-unpack), `test_network_field_authority` +
    `test_stage45_text_preserve` (stale `validate_and_adjust(trace=)` stub — signature drift, not mine).
  - Non-tests (need CLI args): `slip_fixtures.py` (fixture generator), `_prefix_parity_probe.py` (probe).
- **Safety re-confirmed:** OFF (`LATE_RESCUE_CAP_STICKY=0`) is byte-identical (A/B OFF arm == 387/M=10
  baseline exactly). Value is never touched. Fully revertable (kill switch, or `git checkout`; uncommitted).

### 2. SEAM CHECKED — no conflict with today's `LATE_RESCUE_LOCATED_CORROB` (2.6b)
Traced #473 (the 2.6b canary) under both switches. The two fixes operate on **disjoint field
populations**: 2.6b lifts `method=="keyword"` fields (the taught-ownership cap); the sticky cap
touches `late_rescue` fields (Stage-2.6 rescue, method `anchor.*`). No field is both. #473's correct
`PO-96235` was auto-filing at 90 under OFF — but that 90 was **the leak itself** (a blind rescue
boosted above 85), NOT the corrob feature. The sticky cap holds it at 85 (fail-toward-review); it is
one of the ~50 correct-but-blind reads the cap holds. **No feature regressed** — only the leak closed.
⚠ MORNING REFINEMENT IDEA (needs Oracle): exempt a late-rescue read from the sticky cap IF a located
re-read INDEPENDENTLY corroborates it — that would let *corroborated* correct late reads auto-file
while still holding the blind ones. Reconciles the two fixes' intent. Do not build unvetted.

### 3. THE REMAINING GAP — #183 (`PO-60906` → `PO-20008`, silent auto-file). ROOT-CAUSED, fix PROPOSED, NOT built.
The sticky cap does NOT fix #183 — it is NOT a late-rescue (supplier resolved fine). It is the OTHER
genuine misread, and after the GT repair it is the ONLY real corpus M left. **Fully diagnosed:**
- The page value `PO-60906` is perfectly legible (rendered — it's just skewed ~2.1°). NOT a GT poison.
- Skew broke the full-page OCR **row-grouping**: the "Order No PO-60906" line is **absent from the
  reconstructed `ocr_text` entirely** (only "Order Date"/"Order Total" survive — verified).
- The taught rigid crop landed on near-empty paper (skew displaced the value up-left) → read
  `")}-OUIUO0"` → rejected `not_credible`.
- Stage-2 `anchor_inline` (word-GEOMETRY harvest off the located label) assembled **`PO-20008`** from
  the skew-scattered digits — a value that appears **NOWHERE** in the full-page OCR text.
- It is a valid `PO-#####` shape → passes format → conformance boost +8 (now VISIBLE via my C6 trace:
  `2.5_correct boost:8 changed:false`) → +5 → **98 → silent auto-file, no note.**

**PROPOSED FIXES (for the morning — pick one, both need reggie/007 → Oracle; DO NOT build unvetted):**
- **(A) HARVEST-CORROBORATION HOLD (smaller, fail-toward-review, doesn't recover the value).** If a
  critical ref/date value committed by `anchor_inline` does NOT appear as a token anywhere in the
  full-page `ocr_text`, **AND** the field's own rigid crop was rejected as not-credible → cap <88 +
  note → held for review. The two conditions TOGETHER are load-bearing: (a) alone would flag the
  legitimate "column-only crop" class (~2% of refs the full-page OCR misses but the crop reads right);
  requiring (b) — the rigid crop ALSO failed — excludes that class, leaving only the untrustworthy
  word-geometry harvest. This is the SAFE direction (value ABSENT ⇒ distrust), not the illusory-
  independence trap (value present ⇒ trust) — but Oracle must still vet it.
- **(B) FIELD-SCOPED WITNESSED DESKEW (bigger, RECOVERS the value).** Deskew ONLY this field's crop
  region, re-read, accept the re-read ONLY if it agrees with a second source (the `DESKEW_RAW_WITNESS`
  pattern already in the codebase). Recovers `PO-60906` instead of just holding. Never global deskew
  (proven to corrupt #180 — see §3a). This is the "real" fix; (A) is the cheap safety net.

### 4. OWNER DECISIONS WAITING
- **Default of `LATE_RESCUE_CAP_STICKY`.** I left it ON (fail-toward-review; the worst class is a
  silent wrong file). Its cost is ~50 docs (13%) held on the COLD corpus, LOW in steady state (rescue
  only fires on unlearned/late-resolved suppliers). Oracle's condition was "owner accepts the volume".
  If cold-onboarding review is too heavy, `LATE_RESCUE_CAP_STICKY=0` (byte-identical). Your call.
- **Commit?** The sticky cap + C6 trace + test fixes are ready. I did not commit (your call).
- The GT repair (§2) still needs your eyeball (all 9 crops read + tabulated, `stress_test/out/evidence_.../`).

---

# HANDOVER — 2026-07-24 LATE (Opus 5, xhigh; then Opus 4.8 re-review)

## ⭐⭐ END-OF-SESSION RE-REVIEW (Opus 4.8, TESTED — supersedes §3's single-cause framing below)

The owner asked for a hard re-review. The earlier passes (this session) latched serially onto ONE
cause at a time without testing it — first "crop padding", then "skew" — and each was asserted, not
run. Testing corrected all three. **The genuine misreads have NO single clean root-cause fix; they
are a multi-factor stack, and the safest concrete win is the late-rescue re-cap (§4), NOT deskew.**

**What was TESTED this pass (all direct, reproducible):**

1. **GT poisoning = SOLID (re-confirmed at 600 DPI raw).** #180→`PO-91914` (GT `PO-81914` ✗),
   #259→`DN-38472` (GT `DN-28472` ✗), #266→`DN-39943` (GT `N-39942` ✗). True M = 2 (#183, #472).
   ⚠ **#180 is a GT-poison, NOT a genuine misread — the RAW pipeline reads it CORRECTLY (`PO-91914`);
   it only shows as "M" because GT is poisoned.** So the genuine-misread set is exactly {#183, #472}.

2. **SKEW is a real operative cause — but DESKEW IS NOT THE FIX (it is not fail-safe).** Reprocessing
   with `--deskew-pages`: #472 `PO-38093`→**`PO-98093` ✓**, #183 `PO-20008`→**`PO-60906` ✓** — BUT
   #180 `PO-91914`(correct)→**`PO-81914` ✗**: the deskew rotation-RESAMPLE flipped the `9`→`8`
   (the documented `DESKEW_RAW_WITNESS` glyph-flip), corrupting a read that was RIGHT raw, and
   landing coincidentally on the poisoned GT. **Global deskew trades one class of error for another.**
   This is exactly what `project_detect_deskew_parked` ("not fail-safe"), `project_deskew_field_reread`
   ("straighten NOT monotone") and `project_deskew_raw_witness` (resample glyph-flip) already warned —
   the §3 handover under-weighted them. Any deskew must be FIELD-SCOPED + witnessed, never global.

3. **The keyword "Order No." gap is real but NOT a one-liner — the naive fix REGRESSES.** po_number
   keyword labels lack `Order No`/`Order Number` (they sit under sales_order_number), so a PO labelled
   "Order No." gets NO keyword po_number read and falls to the fragile taught crop. BUT: temporarily
   adding "Order No" to po_number labels and re-tracing #472 → keyword matched the FOOTER BOILERPLATE
   ("…quote this **Order No.** on all correspondence and delivery notes") → value `"on all
   correspondence…"` → null. The doc has TWO "Order No." strings; the naive label grabs the wrong one.
   A real fix needs reggie PRECISION (prefer the header occurrence / require an alphanumeric-shaped
   adjacent value), not a label add. (Config was patched in a temp test and reverted via
   `git checkout` — tree clean.)

**THE CORRECTED CHAIN for #472** (the one fully-traced genuine misread): (a) keyword can't read the
clean full-page "Order No. PO-98093" (label gap + footer collision) → (b) falls to the taught anchor →
(c) supplier resolved LATE so Stage 2 ran blind → Stage 2.6 does a BLIND crop → (d) SKEW clips that
crop → `PO-38093` → (e) the 85 cap LEAKS to 98 (§4) → silent wrong auto-file. **Five dominoes.**
#183 is the same minus (a-usable-text): skew also broke the full-page OCR ROW-GROUPING so the "Order
No" line is ABSENT from the text entirely (verified — only "Order Date"/"Order Total" survive), and
anchor_inline synthesised `PO-20008` from the garble.

**SAFEST NEXT BUILD = the late-rescue TERMINAL RE-CAP (§4 / task #4). ✅ BUILT THIS RE-REVIEW.**
It does not solve skew or keyword: it converts #472 from *silent-wrong-auto-file* to *held-for-review*
(fail-toward-review), and it is Oracle-signed with conditions. Everything else (field-scoped witnessed
deskew for #183; reggie precision for the "Order No." occurrence-picker) is larger design work.

### ✅ BUILT THIS RE-REVIEW — the late-rescue sticky cap (UNCOMMITTED, kill `LATE_RESCUE_CAP_STICKY`, default ON)
- **`engine.py` `_apply_late_rescue_sticky_cap()`** (pure helper near `_late_rescue_applicable`, called
  ONCE before `overall_confidence`): for every field carrying the `late_rescue` provenance, return its
  confidence to `_LATE_RESCUE_CAP=85` if a boost re-inflated it. VALUE untouched. OFF ⇒ byte-identical.
  Verified live on #472: **ON → conf 85** (held, below the 88 floor); **OFF → conf 98** (old leak).
- **`engine.py` Stage-2.5b trace (Oracle C6):** now emits on ANY `boost>0` (was `if was_changed`), so a
  conformance-only lift is no longer invisible — the exact blindness that hid this leak for a day.
- **`tests/test_late_anchor_rescue.py`:** FIXED the stale fixture (supplier moved into the issuer band —
  it sat after "Site / Customer", a recipient marker, so `ISSUER_HINT_BAND` correctly truncated it; the
  7-fail file is now GREEN, closing one of CLAUDE.md's catalogued pre-existing failures) + DE-VACUUMED the
  "capped at 85" assertion (it passed on an EMPTY field, `0<=85` — the trap that hid the leak) + added the
  sticky-cap gate tests (re-cap to 85 / value untouched / below-88 / provenance-scoped / meta-skipped).
- **`anchor.py` crop-headroom change REVERTED** — it was the wrong layer (a compensator for skew, A/B
  regressed). Idea + evidence preserved in `project_structured_crop_headroom.md` and §3b; rebuild fresh
  (narrow shape / part-2 label-strip) only if pursued.
- ⚠ **Oracle C5 (forward-seam pin) DONE** as a comment at the re-cap; **corpus A/B result: see the foot
  of this file** (OFF must be byte-identical; ON must not raise M and should drop #472 from silentAutoFile;
  review-volume delta reported). **Real-world cost is LOW**: rescue only fires on late-resolved suppliers
  (cold DB / unlearned / weak fingerprint), rare once suppliers are learned — the 14% is a synthetic-corpus
  artefact, not a steady-state number.

**Verdict on the "was Opus 5 thinking properly" question:** partially not — it serially single-caused
without testing, demoted the safe Oracle-signed fix (§4) beneath an untested deskew story, and nearly
un-flagged a correct GT-poison call (#180) by trusting the deskew read over the image. The GT-poison
analysis, the ref-hold DO-NOTHING, and the cap-leak trace all survived scrutiny. **↓ Original body
retained below for the trace; treat §3 as SUPERSEDED by this block.**

---

**Branch `feat/reprocess-throughput-autostraighten`, last commit `1a6e2dd` (origin in sync `0 0`).
NOTHING COMMITTED THIS SESSION. One source file modified, one scratch harness added — see
"Uncommitted" below. Live DB migration 53; 514 confirmed / 20 needs_review / 32 deleted.**

This session was asked to build the ONE tracked follow-up from `HANDOVER_2026-07-24.md` — the
"ref-hold guard". **It should not be built.** The investigation demolished its premise and found
two better defects, one of them the owner's own diagnosis. No code was committed; the one code
change made is kill-switched and DEFAULT OFF (byte-identical).

---

## TL;DR

1. **The ref-hold guard is DEAD** — Oracle DO NOTHING, on mechanism, not on measurement.
2. **The corpus ground truth is poisoned on 8 rows.** True M is **2**, not 10. This invalidates the
   "M-safe" gate on all four of 2026-07-24's shipped commits, in both directions.
3. **`NAME_GUARD_KEYWORD_CLEAR` shipped DARK for a reason that does not exist.** Its M 10→11 was a
   GT artefact. It is flippable once a proper gate is run (NOT the M gate — see C4 below).
4. ⭐ **ROOT CAUSE FOUND (the owner's diagnosis) — PER-DOCUMENT SKEW, measured at a 4.5° spread.**
   A taught anchor is an axis-aligned box at an absolute position; every document carries its own
   angle; at these fields' x_norm 0.83-0.86 the text line moves ~15px per degree, so within ONE
   supplier the line walks **up to 66% of a taught band height** out of the box. That is why the
   authoritative crop returns garbage, and it is the single mechanism behind all of it. **See §3a.**
   ⚠ **The crop-headroom fix I built is a COMPENSATOR, not the fix** — its A/B REGRESSES (M 10→11,
   M_type 0→1, ref −2, **0 healed**), which is the signature of treating a symptom. It is committed
   nowhere and is DEFAULT OFF. **Do not flip it on. Go at the deskew / skew-aware placement layer,
   and revisit `project_detect_deskew_parked` with the §3a measurement in hand.**
5. **A second real defect:** the Stage-2.6 late-rescue confidence cap (85) is silently undone by two
   later boosts (→98). Measured 55/56 leak. Demoted below (4) — see why.

---

## 1. REF-HOLD GUARD — DO NOT BUILD (Oracle: DO NOTHING)

The handover's framing was wrong in three ways, all verified by live trace:
- The existing authoritative-crop cross-check (`anchor.py:642-689`, gated `method == "anchor_crop"`
  at `:665`) is **structurally unreachable** on this class: the crop is REJECTED at `:424-425`, so
  `method` ends up `anchor_inline` and the whole block is skipped. It is a NEW check, not a
  loosening of `_crop_is_credible`.
- "single-digit" is wrong for the crop comparison — #259's two reads are **2 digit positions** apart.
- `on_reject` is **trace-only** (`engine.py:3093`, `:3601` bind it `if self._trace else None`). A
  guard hanging off it would be **dead in production and green under `--trace`**. (reggie's catch.)

gary and reggie both designed it; I measured both predicates over 514 docs
(`stress_test/_rejectcrop_measure.js`, gitignored output). **Acceptance arm
(`NAME_GUARD_KEYWORD_CLEAR=1`), role ref key: gary 10 newly held / reggie 11 — 1 "wrong", 9-10
CORRECT.** The "1 wrong" is **#259, which is itself poisoned GT** ⇒ **true score 0 TP / 9-10 FP**.
It also fires on NEITHER genuine misread (their crops are `")}-OUIUO0"` / `"No. PQO-aRano"` —
garbage, not near-misses), so no near-miss predicate can ever reach the real class.

**Oracle's mechanism argument (the durable reason — do not re-litigate on new corpus data):** the
doctrine at `anchor.py:651` is *"an authoritative anchor wins silently ONLY when two INDEPENDENT
reads AGREE"*, and it presumes **both reads are credible**. The proposed guard applies it to one
credible read and one the pipeline has **already adjudicated as not credible** — that is the
invariant inverted. A rejected crop is not an independent read; it is noise already binned. #259
proves it on its own data: the crop reads `DN-28470`, and the last digit `2` is undisputed by
everyone. This holds at 0 false holds and perfect GT.

---

## 2. THE CORPUS GT IS POISONED — true M is 2, not 10

Every M-gate doc was rendered at 350-400 DPI and the printed value read directly off the page.

| doc | corpus GT | pipeline reads | THE PAGE SAYS | verdict |
|---|---|---|---|---|
| #259 | `DN-28472` | `DN-38472` | **`DN-38472`** | GT POISONED |
| #180 | `PO-81914` | `PO-91914` | **`PO-91914`** | GT POISONED |
| #266 | `N-39942` | `DN-39943` | **`DN-39943`** | GT POISONED |
| #273 | `N-74270` | `DN-74279` | **`DN-74279`** | GT POISONED |
| #262 | `N-99718` | `DN-99718` | **`DN-99718`** | GT POISONED (missing `D`) |
| #263 | `N-64472` | `DN-64472` | **`DN-64472`** | GT POISONED (missing `D`) |
| #269 | `N-51440` | `DN-51440` | **`DN-51440`** | GT POISONED (missing `D`) |
| #287 | `02/2026` | `DN-74630` | **`DN-74630`** | GT POISONED (a DATE in the ref field) |
| #190 | `PO-21275` | null | **`PO-21275`** ✅ | ⚠ **VALUES CORRECT — the TYPE is wrong** |

**ALL NINE CROPS HAVE NOW BEEN READ** (an earlier pass had rendered but not opened five of them).
⚠ **#190 must NOT get a value override** — its ref AND date match the page exactly; the fault is a
PURCHASE ORDER confirmed as a `delivery_note`, so the fix is the TYPE, not the answer key. The count
is **8 poisoned VALUES + 1 poisoned TYPE**; "true M = 2" is unchanged.
✅ **#287 now has the independent corroborator Oracle required (C7c):** the page reads `DN-74630`,
exactly matching `gt_overrides.json` entry `"92"` (written 2026-07-12, different session, different
purpose) — a second source that is not a model reading an image. Harvest it before pruning.
| **#183** | `PO-60906` | `PO-20008` | **`PO-60906`** | **GENUINE misread** |
| **#472** | `PO-98093` | `PO-38093` | **`PO-98093`** | **GENUINE misread** |

**How #259 was poisoned (this is the evidence to cite, NOT the image):** the file
`ThornburyFasteners_delivery_docket_02.pdf` is imported **8 times** (#214 #237 #259 #279 #298 #319
#432 #492). Seven were confirmed `DN-38472`. #259 carries a `corrections` row
`delivery_number: "N-28472" -> "DN-28472"` — a **single-character prepend**. An operator who
prepends one character has not re-read the digits, so the confirmed value's DIGITS are a pipeline
read of that era, not a human observation. That chain is independent of anyone's eyesight.
⚠ The prior ledger's *"two sources (the crop '2' + the human confirm) say DN-28472"* is FALSE: its
quoted crop read `'N-28472'` is **verbatim that corrections row's `original_value`** — the "crop"
leg was never a measurement. ⚠ Do NOT cite the 7 siblings as witnesses — same file, same pixels,
same engine family; that is same-pixel agreement, the weak form. Cite them as *consistency* only.

**Corpus hygiene (Oracle Seam D, quantified):** **361 distinct source files across 514 confirmed
rows** — 153 rows are duplicate imports. That inflates the graduation counter (`trust.js:45`
W=10 reachable from a handful of documents), the Stage-2.5d dominant-value snap (≥5 count / ≥80%
share) on a *constant* delivery number, accuracy denominators and M sensitivity. **Report distinct
source files alongside any row count from now on.**

---

## 3. ⭐ ROOT CAUSE — PER-DOCUMENT SKEW walks the text line out of the taught box

⚠⚠ **THIS SECTION WAS RE-WRITTEN AT THE END OF THE SESSION. The clipping described below is REAL but
it is a SYMPTOM. The cause is SKEW, measured after the owner pointed out that the evidence crops were
"very wide … and badly skewed".** Everything in §3b (crop headroom) is a compensator, not a fix — which
is exactly why its A/B bought 2 new silent wrong reads and healed 0.

### 3a. THE MEASUREMENT (decisive)

The corpus is SYNTHETIC — documents generated to SIMULATE scans (owner-stated; the generator for these
specific suppliers is not in the repo — `stress_test/gen_corpus.py` is a DIFFERENT, older corpus with
5 other suppliers, so do not read its `rng.uniform(-1.0, 1.0)` as authoritative for these files).
Skew is therefore per-document and deliberate — and that is the POINT: real scans are skewed too.

Measured with `ocr/tesseract.py:286` `detect_skew_angle` (raw, `min_angle=0.0`) at the pipeline's own
300 DPI, alongside each field's taught `x_norm` and band height:

| doc | skew | x_norm | px per 1° | taught band |
|---|---|---|---|---|
| #183 | **−2.100** | 0.856 | 16.2 | 78px |
| #484 | −0.500 | 0.826 | 14.3 | 65px |
| #287 | −0.500 | 0.831 | 14.6 | 81px |
| #180 | +1.100 | 0.856 | 15.8 | 77px |
| #472 | +1.200 | 0.826 | 14.6 | 66px |
| #259 | +1.500 | 0.831 | 14.9 | 82px |
| #263 | +1.800 | 0.831 | 15.0 | 82px |
| #262 / #269 | +2.200 | 0.831 | 15.1 | 83px |
| #266 / #173 | +2.300 | 0.831 / 0.850 | 15.1 / 16.0 | 83 / 76px |
| #273 | **+2.400** | 0.831 | 15.2 | 83px |

**Skew spread across these docs: −2.1° … +2.4° = 4.5°.**

A taught anchor is an **AXIS-ALIGNED box at an ABSOLUTE position**. Each document carries its own
angle, rotation is about the page CENTRE, so the text line's vertical offset grows with horizontal
distance from centre — and every one of these ref fields sits at **x_norm 0.83-0.86**, the far right
edge, where the line moves **~15px per degree**. Within a SINGLE supplier:
- **Larkspur `po_number`**: #180 +1.1° vs #183 −2.1° → 3.2° → **51px of walk against a 77px band = 66%**
- **Thornbury `delivery_number`**: #287 −0.5° vs #273 +2.4° → 2.9° → **44px against an 82px band = 54%**

**So the text line can be displaced by most of a band height — in the worst pairing, more than a full
band — purely from skew variation between documents. An absolute axis-aligned box CANNOT hold on this
corpus.** #183 carries the most extreme angle in the set, which is why its taught box rendered nearly
empty, and why its committed `PO-20008` is a value the page text does not contain anywhere.

This single mechanism explains every loose end: garbage crops on some docs and clean reads on others;
**`no_candidate = 326/574` (57%)** of rejected crops having no comparable token; and why extra headroom
partially rescued the badly-skewed docs while pulling adjacent rows into the well-aligned ones.

**THE FIX IS AT THE DESKEW / SKEW-AWARE PLACEMENT LAYER, NOT CROP PADDING.** `detect_skew_angle` already
exists and returns sane values, but the pipeline only applies it when `deskew_pages` is passed (the
opt-in Straighten path) — normal processing reads these pages skewed as-is.
⚠ **`project_detect_deskew_parked` recorded detection-time deskew as "PARKED do-nothing: not fail-safe
(arms dormant template gates)". That decision was taken WITHOUT this measurement. It must be revisited
with this evidence** — and note `project_deskew_field_reread` warns "straighten NOT monotone", and
`project_skew_anchor_misread` already recorded that skew breaks label relocation (DN→IN@97). All three
were in the memory index and none were consulted until the owner forced the issue.

### 3b. (SYMPTOM, kept for the record) structured OCR crops slice the glyph bottoms off

`anchor.py:3053-3058` gives proportional vertical headroom (`+0.4*h + 6`) **only** to
`text`/`multiline_text`. Structured ref/date/currency fields keep a **flat 20px** that does not
scale with glyph size. The stated reason is:

> *"Pad text fields more; numerics keep the tight box (so they don't bleed into the next column)."*

**That rationale does not cover what it gates.** Column bleed is HORIZONTAL; the withheld padding is
`half_h` — VERTICAL. Vertical padding cannot bleed into a neighbouring column, only into an adjacent
ROW. The justification is mismatched to the mechanism, which is why this survived.

**MEASURED on #472** (`ThornburyFasteners_purchase_order_01.pdf`, 300 DPI = `tesseract.py:36`
`_RENDER_DPI`, taught band 66px). Same doc, same box, only the vertical pad changes:

| `ANCHOR_STRUCTURED_HEADROOM` | the taught crop reads |
|---|---|
| OFF (**current live behaviour**) | `"No. PQO-aRano"` — garbage, bottom-clipped digits render as letters |
| 0.15 | `"No. PO-98002"` |
| 0.25 | `"No. PO-98092"` |
| **0.35 / 0.4** | **`"No. PO-98093"` — EXACTLY CORRECT** |

Rendered proof crops are in the session scratchpad (`doc472_B_pipeline_numeric.png` = clipped,
`doc472_C_with_text_headroom.png` = whole). This is the READING axis: it makes the highest-authority
read succeed rather than changing who wins.

### PART 1 — BUILT, UNCOMMITTED, DEFAULT OFF
`python_backend/extraction/anchor.py`: new `_structured_headroom_ratio()` /
`_STRUCTURED_HEADROOM_RATIO` beside `_MAX_CROP_WIDTH_CAP`, plus one `elif` at the crop-padding site.
Kill switch **`ANCHOR_STRUCTURED_HEADROOM`, default `0` ⇒ ratio 0.0 ⇒ byte-identical**; clamped to
0.4; garbage-safe. Verified: unset→0.0, `0.25`→0.25, `9`→0.4, `junk`→0.0.

### PART 2 — DESIGNED, NOT BUILT (required; part 1 alone does not fix #472)
Even the perfectly-read crop is **still rejected `not_credible`**, because it carries the caption
tail `No.` and `_pattern_coverage` (`anchor.py:2208-2222`) uses `re.search` = **FIRST** match, which
scores `"No."` at 3/12 = 0.25 against `_CREDIBLE_COVERAGE_MIN` 0.8.
⚠ **`finditer`/longest-span is NOT sufficient** — it only reaches `PO-98093` = 8/12 = **0.67**, still
under 0.8. The fix is to **strip the taught LABEL fragment before the credibility gate**:
`_crop_is_credible` already receives `label`, and `_is_bare_label(v, label)` is the precedent.
Strip `No.` ⇒ coverage 8/8 = 1.0 ⇒ credible ⇒ the correct value wins at Tier-A.
⚠ Do NOT "fix" this by making `_recover_clean_token` prefer the longer token — gary verified that
would COMMIT `DN-28470` on #259, which is also wrong.

### RISK the corpus A/B must answer
Vertical padding CAN pull in an adjacent ROW, and `clean_crop_segment` takes the FIRST line — so an
over-wide band could read the row above. That is the real reason to sweep the ratio rather than ship
a guessed constant.

---

## 4. Stage-2.6 late-rescue cap leak — REAL, but demoted below (3)

`engine.py:3572-3576` states the invariant in prose: *"confidence capped at `_LATE_RESCUE_CAP` 85 …
so a rescued ref/date can never auto-file at any threshold."* **False in production.** Chain:

| step | site | conf |
|---|---|---|
| Stage 2.6 rescue caps | `engine.py:3628` | **85** |
| Stage 2.5b conformance boost `min(95, c+8)` | `engine.py:3784` + `ocr_corrector.py:274` `boost_table{0:8}` | **93** |
| Stage 4.5 learned-agreement `min(98, c+5)` | `engine.py:4358` | **98** |

`boost_table[0] = 8` means **zero fixes still earns +8** — i.e. merely CONFORMING to the learned
shape. A valid-shaped misread conforms BY CONSTRUCTION (`PO-38093` is shape-identical to
`PO-98093`), so the boost is strongest exactly where it is least informative. Same illusory-
independence trap that got `CROSS_TIER_CONF_LIFT` reverted on 2026-07-24.

**Measured: 56 late-rescue fields across 55 docs; 55 leak above the cap; 1 wrong (#472), 54 correct.**
= **14.2% of the 387 auto-filing docs newly held** → Oracle's *"5-15%: ship behind the kill switch,
but the owner must be shown the review-volume delta and accept it"* band. 54 correct docs held to
catch 1 wrong.

**WHY DEMOTED:** if the crop stops clipping (§3), the rescued read is CORRECT and this cost/benefit
changes completely. **Re-measure the leak AFTER §3 lands — measuring it now measures a world we are
about to leave.** (Oracle sequenced the ceiling before this because he did not have §3's evidence.)

Also found, zero-behaviour, fix in the same commit whenever this is built:
- `engine.py:3629` sets `data["late_rescue"] = True` — **written once, NEVER READ** (grepped Python
  + JS). Dead provenance.
- `src/windows/review/renderer.js:2482` tests `m === 'late_rescue'` as a **method string**, but
  `:3629` explicitly leaves the method untouched ⇒ **that branch can never fire**. Dead expectation.
- `engine.py:3793` emits the 2.5b trace only `if was_changed`, so a conformance-only lift is
  invisible — which is why this took a day to find. Emit whenever `boost > 0`.
- `engine.py:4338` justifies the `min(98,…)` cap as *"so a boost ALONE never reaches the auto-file
  threshold (100)"*. **STALE**: graduation landed after it, and `trust.js:45`/`:548` make the
  graduated floor **95**. The ceiling sits 3 points ABOVE the bar it was designed never to reach.

---

## 5. `test_late_anchor_rescue.py` — 7 RED, diagnosed: ONE stale fixture

All 7 failures cascade from one: `supplier resolved late via 2.5a text scan`. The fixture's OCR is
`WORKSHEET / Site / Customer / Formby & Sons / Meridian…` — and `\bcustomer\b` is a **recipient
marker** (`chrome_band.py:26`), so the 2026-07-20 `ISSUER_HINT_BAND` fix (`e8f3a6c`) correctly
truncates the issuer band there and the supplier no longer resolves late ⇒ the rescue never runs ⇒
6 downstream assertions fail. **The product is behaving correctly; the fixture predates the fix.**
Fix = move the supplier line ABOVE the recipient marker.

⚠ **AND THE CAP ASSERTION IS VACUOUS:** `check("rescued confidence capped at 85", (cust.get("confidence") or 0) <= 85)`
passes when `cust` is EMPTY, because `0 <= 85`. It is green because the field is unfilled, not
because the cap works. That is CLAUDE.md's own "dead guard greens every test" trap and it is why the
§4 leak survived. Fix the fixture FIRST or the file cannot gate anything.

---

## Uncommitted

```
 M python_backend/extraction/anchor.py          # §3 part 1 — kill-switched, DEFAULT OFF
?? stress_test/_rejectcrop_measure.js           # scratch corpus measurement (output gitignored)
```
(`../Backup/`, `../Docusnap - Copy/`, `../Docusnap - Copy.zip` are outside the repo, pre-existing.)

## Verification state — honest

- **Baseline corpus run READ** (untraced, defaults): 514 docs, **387 would auto-file, M=10**,
  M_type 0, accuracy type 99.8 / supplier 100.0 / ref 96.9 / date 99.0. 21 regressions, 20 silent.
- **`--trace` proven behaviour-neutral**: traced run also gives 387/514 (count identity only —
  ⚠ Oracle wants the SET of ids compared, not just the cardinality; NOT done).
- **A/B for §3 part 1 at ratio 0.35 RAN AND FAILED — READ.** ref 96.9%→**96.5%**, **M 10→11**,
  **M_type 0→1**, regressions 21→23, auto-file 387→390; diff = **2 new silent wrongs (#173, #484),
  ZERO healed**. Full table + interpretation in `## A/B RESULT` at the foot of this file. The fix as
  built must NOT be flipped on. (The mechanism is still proven on #472 — the shipped SHAPE is what failed.)
- **NOT verified:** no unit test written for §3; §3 part 2 not built; the late-rescue ceiling not
  built; no GT override edited; nothing committed or pushed; no installer rebuilt.
- **TWO OF MY OWN MID-SESSION CLAIMS WERE WRONG — corrected here:**
  1. I first rendered the taught box treating `x_norm`/`y_norm` as the TOP-LEFT. They are the
     **CENTRE** (`anchor.py:3046`, `cx = int(x_norm*w)`; `x1 = cx - half_w`). My initial
     "#183's box misses the value entirely" was partly that error. The corrected renders
     (`taughtbox2.py`) are the valid ones.
  2. I initially reported the raw taught box as "what the crop sees". The pipeline adds 20px each
     side; the corrected artefacts reproduce the real crop.
- **#183 is NOT fixed by §3.** Its supplier and template resolve fine; the full-page OCR **loses the
  ref line entirely** (text contains only `PURCHASE ORDER    Order Date 11/03/2026`) and the harvest
  produced a valid-shaped `PO-20008` — a token that appears NOWHERE in the page text. Oracle's read:
  two faults — (a) OCR lost the line (oscar/007), **(b) the pipeline SYNTHESISED a well-formed
  reference out of a garble, which is in scope and more dangerous than a digit misread** because
  every downstream shape gate then passes by construction. **Unresolved evidence to gather first:**
  the exact input string the inline harvest received, and which function produced `PO-20008`
  (`_clean_text_fallback` / `clean_crop_segment` / `_qualify_against_format`, or 2.5b `try_correct`).
  **If `try_correct` made it with n_fixes 1-3, the corrector CREATED the value and paid itself
  +20/+12/+6 for it** — and #183 and #472 collapse into one root cause.

## FIRST ACTIONS (fresh session)

1. ⭐ **START AT §3a (SKEW), not at the crop padding.** Re-open `project_detect_deskew_parked` with
   the 4.5°-spread measurement. The question to answer FIRST, before any code: can the taught box be
   made skew-aware (deskew the page before the rigid crop, or rotate the crop rectangle by the
   page's detected angle about the page centre), and what does that do to the corpus? `detect_skew_angle`
   (`ocr/tesseract.py:286`) already works — the pipeline just never calls it outside the opt-in
   `deskew_pages` path. ⚠ Heed the two standing warnings: `project_deskew_field_reread` ("straighten
   NOT monotone") and the parked note's reason ("arms dormant template gates") — neither is refuted by
   the new measurement, they are the risks the design has to answer.
   Reproduce the measurement with the session script (see Key facts) — it prints skew, x_norm,
   px-per-degree and band height per doc.
2. **The crop-headroom work is a compensator — do NOT resume it as the primary line.** It is
   DEFAULT OFF and its A/B failed (M 10→11, M_type 0→1, ref −2, 0 healed; new silent wrongs #173
   `WS-77682`→`WS-77622`, #484 `PO-83362`→`PO-82262`). Keep it only as a possible SECOND-ORDER
   tidy-up after skew is handled, and only in the narrow shape (apply headroom ONLY where the rigid
   crop would otherwise be REJECTED, which would have avoided both regressions by construction).
   §3b part 2 (strip the taught label before the credibility gate) is still independently valid —
   `_pattern_coverage` scoring `"No."` at 3/12 is a real defect regardless of skew.
3. Write the unit test for §3 (pin: OFF ⇒ byte-identical; a clipped structured crop is recovered;
   an adjacent-row bleed is NOT admitted) and take §3 to reggie/007 → Oracle before any default flip.
4. Only then re-measure §4 (the late-rescue leak) in the post-§3 world.
5. `gt_overrides.json` repair — **blocked on the owner** (see below).

## Deferred (designed, not built) — with their load-bearing conditions

- **§3 part 2** — see the ⚠ notes above; `finditer` alone is insufficient (0.67 < 0.8).
- **Late-rescue ceiling (§4)** — Oracle C1: enforce as a **TERMINAL re-cap once**, immediately before
  `overall_confidence` (`engine.py:4363`) — **NOT per-site skips**, because `engine.py:3182` has a
  `max()` that defeats any ceiling and a future boost site would silently re-open it. C2: must cover
  BOTH lifts (+8 alone = 93; +5 alone = 90; both clear the 88 `CRITICAL_FIELD_FLOOR`) — a one-site
  fix ships a green test over a live defect. C3: the gate test must be proven RED at 98 after a FULL
  `extract()` **and** a `trust.isAutoFileEligible` refusal. C4: fix §5's fixture first. C5: pin the
  forward seam at `engine.py:3577-3585` (the "let a located rescue displace a keyword incumbent"
  follow-up would collide the ceiling with Stage-2.6b's lift; today they are **disjoint by
  construction** — 2.6 fills empties, 2.6b requires `method == "keyword"`, so there is NO collision).
- **Per-template field HIDING** — owner queued it this session (was "do not start without owner
  input"). Spec `HANDOVER_2026-07-21.md:80`. Hide-only, superset-locked, structural roles
  (issuer/date/ref) NEVER hidable, display mask NOT a data delete.

## Needs the USER

1. **The 8 GT crops (Oracle C7, BLOCKING).** The harness self-validation
   (`realdoc_regression.js:124-141`) is anti-MISAPPLICATION only — `ov.ref` is taken on trust at
   `:134`, so it **cannot detect a wrong replacement value**. That is the abuse channel: a future
   change could "fix" a regression by editing the answer key. So each entry needs the OWNER's eyeball
   on the disputed glyph + the crop PNG saved as an artefact + a `why` citing a corroborator
   independent of an image read. **All 9 crops are rendered and waiting at
   `stress_test/out/evidence_2026-07-24_LATE/gt_repair/`** (gitignored — they carry real supplier
   names and refs, so NEVER commit them). That folder's `README.md` carries the per-doc
   GT-vs-page table, the #259 single-character-prepend argument, and the ⚠ "harvest entry `92`
   before pruning" note. The crop-clipping evidence for §3 is beside it in `crop_clipping/`, and
   both generator scripts (`taughtbox2.py`, `cropdocs.py`) are in the folder so everything can be
   regenerated read-only.
2. **Before pruning the 7 inert Thornbury `gt_overrides.json` entries, HARVEST entry `"92"`** — it
   independently records `ThornburyFasteners_delivery_docket_16 = DN-74630`, written 2026-07-12 by a
   different session for a different purpose, and is real corroboration for **#287**. The 8 SKIPPED
   warnings are the design working (the 2026-07-20 DB wipe made them inert), not a fault.
3. **After the GT repair: re-run the corpus A/B for all four of 2026-07-24's kill switches**
   (`TAUGHT_OWNERSHIP_OWN_LABEL`, `LATE_RESCUE_LOCATED_CORROB`, `TEMPLATE_NAME_PRESENCE_VETO`,
   `DESKEW_RAW_WITNESS`). Each was gated "M-safe" against ≥8 poisoned **ref-role** rows — that
   invalidates the results in BOTH directions.
4. **`NAME_GUARD_KEYWORD_CLEAR` flip (Oracle C4):** its gate is **NOT** "M didn't rise" — the
   harness's scored set (`realdoc_regression.js:147`) does not even include `customer_name`, so it is
   blind to the flip's own subject matter. The gate is: **enumerate the documents the flip newly
   auto-files and verify each one's ref/date/supplier against the PAGE**, not against GT. The trigger
   is narrow (`anchor.py:1360` marks only the `:586` site; `engine.py:415-419` excludes
   `supplier_name` and requires a keyword incumbent), so the set should be small.
5. A dev `npm start` was left RUNNING from this session.

## Key facts / paths

- Live DB `%APPDATA%\ScanFinder\docusnap.db` — **migration 53**, 514 confirmed (**361 distinct source
  files**), 20 needs_review, 32 deleted. Open read-only (`?mode=ro`).
- Corpus gate: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js`
  (`GATE=1` exits 1 on ANY silent regression — always READ `stress_test/out/realdoc_regression.md`,
  a trailing `echo` masks the exit code).
- Single-doc trace: `TRACE=1 TRACE_FIELD=<field> GREP=<tokens> … stress_test/_trace_docs.js <ids>`.
- This session's scratch measurement: `stress_test/_rejectcrop_measure.js` (both predicates × three
  scopes, plus the §4 leak section).
- **⭐ The skew measurement (§3a) reruns read-only:
  `py -3.12 stress_test/out/evidence_2026-07-24_LATE/skewmeasure.py`** — prints per-doc skew angle,
  the field's taught `x_norm`, px-of-line-walk per degree, and the taught band height, then the spread.
- **Evidence folder `stress_test/out/evidence_2026-07-24_LATE/`** (gitignored — real supplier names and
  refs, NEVER commit): `README.md` (per-doc GT-vs-page table + the #259 single-character-prepend
  argument + the #287 corroborator) · `gt_repair/` (the 9 owner-witness crops) · `crop_clipping/` (the
  §3b before/after) · `skewmeasure.py` / `taughtbox2.py` / `cropdocs.py` to regenerate everything.
  ⚠ The `gt_repair/` crops are WIDE top-right quadrant shots containing 2-3 text lines — fine for
  reading the printed value, but regenerate them tight around the reference before using them as the
  formal sign-off artefact.
- Python tests are script-style: `cd python_backend && py -3.12 tests/<file>.py`.
- Advisors used: gary + reggie (designs), **oracle twice** (the reversal, then the cap leak). Oracle's
  verdicts are the authority on §1 and §4 — read them before re-opening either.

---

## A/B RESULT — §3 part 1, `ANCHOR_STRUCTURED_HEADROOM=0.35` — ⚠ **REGRESSES. DOES NOT SHIP.**

| metric | baseline (OFF) | headroom 0.35 | delta |
|---|---|---|---|
| ref accuracy | 96.9% (498/514) | **96.5% (496/514)** | **−2** |
| **M (silentAutoFile)** | 10 | **11** | **+1** ⛔ |
| **M_type** | 0 | **1** | **+1** ⛔ |
| regressions / silent | 21 / 20 | 23 / 22 | +2 |
| would auto-file | 387 | 390 | +3 |
| type / supplier / date | 99.8 / 100.0 / 99.0 | 99.8 / 100.0 / 99.0 | unchanged |

**Regression diff (the decisive artefact) — 2 NEW silent wrong reads, ZERO healed:**
```
NEW  #173 service_worksheet ref: want 'WS-77682' got 'WS-77622'   [SILENT]   (1 digit: 8->2)
NEW  #484 purchase_order    ref: want 'PO-83362' got 'PO-82262'   [SILENT]   (2 digits: 3->2, 3->2)
HEALED: none
```

**Interpretation (honest).** Part 1 ALONE cannot heal #472 — that crop is still rejected on the caption
prefix, which is what §3 PART 2 exists to fix. But a bigger crop CAN make a previously-marginal crop newly
credible and then commit a value degraded by the extra band. **This is exactly the adjacent-row / extra-noise
risk flagged before the run, and it is now MEASURED, not hypothetical.** So the §3 hypothesis is NOT
falsified — the mechanism is proven on #472 (`"No. PQO-aRano"` → `"No. PO-98093"`) — but **0.35 as a shipped
constant is net-negative and must not be flipped on.**

**What this does NOT settle:** the ratio was not swept, and part 2 was not built, so the pairing that the
mechanism actually needs has never been measured. Sweep 0.15 / 0.25 (the #472 crop was already recognisable
at 0.15 — `"No. PO-98002"`) and measure part 1 + part 2 TOGETHER before drawing any conclusion about the fix
as a whole. It is entirely possible the correct answer is a smaller ratio, or a ratio applied only when the
rigid crop would otherwise be rejected, or nothing at all.

⚠ Remember the M numbers on BOTH arms are computed against the POISONED GT (§2) — 8 of the 10 baseline M
rows are not real. The **delta** is still meaningful (these 2 docs previously matched their GT and now do
not), but do not quote either absolute M until the GT repair lands.

---

## ✅ A/B RESULT — the late-rescue STICKY CAP (`LATE_RESCUE_CAP_STICKY`) — GATE PASSED

Both arms, same live DB snapshot (514 confirmed):

| metric | OFF (control) | ON (default) | verdict |
|---|---|---|---|
| ref / date / type / supplier accuracy | 96.9 / 99.0 / 99.8 / 100.0 | **identical** | value never touched ✓ |
| regressions (silent) | 21 (20) | 21 (20) | identical ✓ (the cap holds, it doesn't re-read) |
| **M — silent-wrong AUTO-FILE** | **10** | **9** | ↓ **#472 held instead of filed** ✓ |
| M_type | 1 | 1 | unchanged ✓ |
| would-auto-file | 387 | 337 | −50 held for review (the cost) |

- **OFF is byte-identical to the session baseline** (387 / M=10) — control confirmed, kill switch clean.
- **ON drops M 10→9. The doc removed is EXACTLY #472** (`comm` diff of the two M-lists = `#472` only).
  Nothing else moved — the cap is provenance-scoped to `late_rescue` fields.
- **Accuracy byte-identical** — the cap changes auto-file eligibility, never a value. #472's value stays
  the wrong `PO-38093`, but at conf 85 (< the 88 critical floor) it is HELD for review, not silently filed
  (fail-toward-review). So `silentWrong` (a read metric) is unchanged at 20; `silentAutoFile` (M, the
  auto-file-safety metric) is what drops — the intended behaviour.
- **Cost = 50 docs held** (387→337, ~13%) on this COLD synthetic corpus. Real-world steady state is far
  lower: rescue only fires when the supplier resolved LATE (cold DB / unlearned / weak fingerprint), which
  is rare once suppliers are learned. This is Oracle's "5-15% → owner accepts" band; the fix ships kill-
  switched so the owner can flip it off if cold-onboarding review volume is ever too high.
- After the GT repair (§2) lands, corpus M with the cap ON would be ~1 (only #183 remains — the genuine
  misread that is NOT late-rescue and needs the skew/OCR line-loss work, not this cap).

**STATUS: the late-rescue sticky cap is BUILT, TESTED (unit + corpus A/B), and gate-clean. UNCOMMITTED.**
Remaining Oracle conditions all met (C1 terminal ✓, C2 both lifts ✓, C3 gate test RED-first→green ✓,
C4 fixture fixed ✓, C5 forward-seam pinned ✓, C6 2.5b trace ✓). Ready to commit when the owner is ready;
nothing pushed.
