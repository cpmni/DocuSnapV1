# HANDOVER — 2026-07-17 EVENING

**Branch:** `feat/reprocess-throughput-autostraighten`
**Last PUSHED commit:** `7298b10` (Option C parallel per-field crops)
**UNPUSHED commits (3):** `1f30946`, `ba667b6`, `da4a5ff` — *ask before pushing*
**UNCOMMITTED:** Option A duplicate-filing core (`filename_pattern.js` + its test) + `stress_test/out/accuracy_baseline.md`
**Latest installer:** `dist\ScanFinder Setup 2.0.0-r20260717-1415-7298b10.exe` (has B+C parallelism; does **NOT** contain the 3 unpushed commits)
**Prior handover this date:** `HANDOVER_2026-07-17.md` (the resolve-issuer + embeddable-python batch — now all PUSHED through `7298b10`)

---

## TL;DR
A long interactive testing marathon on the built app. Shipped (committed, unpushed): single-doc
reprocess parallelism (B+C, default OFF), a teach label-picker word-ratio tiebreak, a wizard
Speed-default + focus fix, and a keyword-branding template rescue that no longer trusts the unstable
logo (H, half-fix). Built but uncommitted: duplicate-filing options core (A). **The headline is a
DIAGNOSIS, not a fix:** the user surfaced the true root cause of the "no template match" family —
**the coarse logo hash is unreliable on scans, so template identity fragments (duplicate templates)
and `confirmed_count` never grows.** Fully measured on the dev DB. Two tasks queued (M #19 root cause,
N #20 counter bug) for a proper advisor+Oracle design next session. No regressions introduced.

---

## COMMITTED, UNPUSHED (3 commits)

### `da4a5ff` — keyword-branding template rescue no longer gated on the unstable logo (H, HALF-FIX)
- **Root cause (measured, `project-logo-hash-unreliable`):** on degraded scans the coarse 64-bit logo
  phash (and the 256-bit detail hash) is USELESS for supplier matching — the same logo drifts as much
  as different logos (intra up to 24–36 Hamming, inter as low as 2–8; ranges fully overlap). The
  **keyword branding fingerprint separates cleanly** (intra p50 1.00 / min 0.60, inter MAX 0.50 → 0%
  cross-supplier false-match at the 0.80 threshold).
- **Change:** `template_matcher.py` rescue 2b (same-type ≥0.80 branding overlap + `title_trusted`) no
  longer requires the logo within a band. Kill switch `RESCUE_ENFORCE_LOGO_BAND=1` = old behaviour
  byte-identical; `RESCUE_LOGO_BAND` env-tunable. **File: 1 (`template_matcher.py`, +12/-2).**
- **Verified:** corpus A/B (realdoc_regression fix vs enforce-band) IDENTICAL, no regression.
- **HONEST LIMIT:** the dev DB's Copperfield logos are mostly good, so the fix matches via the direct
  logo path *before* the rescue runs — I could NOT reproduce the owner's exact "no template match" and
  therefore could NOT demonstrate the rescue flipping a real doc. **See below — this is only HALF the
  fix; the match side is loosened but the CREATE/reuse side is still logo-gated (the real bug, M).**

### `ba667b6` — wizard Speed defaults to Fast (machine-scaled) + new-type modal focus repair
- Onboarding "Processing speed" now maps cards to real cores (Gentle=1, Balanced≈half, Fast=recommended)
  and defaults to Fast. Review new-type modal now runs the shared focus repair
  (`markFocusSuspect` + `ensureWindowFocus` + `repairModalInputFocus`) after the rAF focus — fixes the
  "caret but no text input" the user hit creating a type from Review.
- **Files:** `src/windows/onboarding/renderer.js`, `src/windows/review/renderer.js`. **Needs a rebuild** (renderer JS).

### `1f30946` — teach label-picker word-ratio tiebreak
- `src/windows/shared/anchorLabel.js`: on a score-1 LEFT/ABOVE tie, flip to ABOVE only when the above
  caption has ≥2 curated FORM-LABEL words AND out-scores left by ≥0.5 word-ratio (garble left `Rote,`
  no longer beats a real caption above `Site / Customer`). Curated vocab (not a dictionary — steer, not
  reject); kill switch `setRatioTiebreak(false)`. reggie + Oracle reviewed; `test_anchor_label.js` 109 green.
- **Files:** `anchorLabel.js`, `test_anchor_label.js`. **Renderer-only → needs a rebuild.**

## COMMITTED + PUSHED earlier this session (context)
- `25469e2` **Option B** — parallel full-page OCR passes on single-doc reprocess (~1.9×), default OFF
  (`DS_OCR_PARALLEL_FULLPAGE`). Corpus A/B byte-identical.
- `7298b10` **Option C** — parallel per-field crop reads on single-doc reprocess (~4.8s→~1s), default OFF
  (`DS_OCR_PARALLEL_FIELDS`). Corpus A/B byte-identical. Both wired to the "Faster single-document
  reprocessing" Settings toggle (`ocr_parallel_reprocess_enabled`). Design: `docs/designs/REPROCESS_PARALLELISM_BC_2026-07-17.md`.
  ⚠ **Pending: owner 6-core memory-pressure load test before flipping either default ON.**

## UNCOMMITTED — Option A (duplicate-filing options), core only
- `src/modules/filing/filename_pattern.js`: added `resolveDuplicate(baseFilename, ext, existsIn, opts)`,
  `_duplicateTag`, `DUPLICATES_SUBFOLDER='Duplicates'`. Suffix policy (DUPLICATE default / COPY / number
  / date / custom) + subfolder policy. **Default is byte-identical** to today's `-DUPLICATE`.
- `test_filename_pattern.js`: policy tests, all pass; both files `node -c` clean.
- **NOT wired yet:** `filing/handler.js` step 4 + a Settings control + the first-run UI. **Then commit.** (Task A/#9.)

---

## THE HEADLINE — root cause of the "no template match" family (DIAGNOSED, NOT FIXED)

The user found it by looking at Settings → Templates. Two verified bugs, one root cause. **All measured
read-only on the dev DB** (`%APPDATA%\ScanFinder\docusnap.db`).

### M (#19) — template fragmentation (duplicate templates)
Copperfield has **3 invoice + 4 purchase_order + 1 delivery + 1 sales_order** templates. Confirmed docs
DO link (their `template_id` is set) but SPLIT across near-duplicates instead of converging:
- invoice: 20 confirms across 3 templates (11 + 4 + 5)
- purchase_order: 19 across 4 templates (10 + 7 + 1 + 1) + **1 confirmed template-less**
- sales_order: 11 on the one template + **5 confirmed with NO template** (the `sales_order_05` class)

**Measured proof it's purely the logo:** `sales_order_05` has branding overlap **1.00** with template 9
(all 8 fingerprint words present) but logo distance **22**; a sales order that DID match has the same
**1.00** branding and logo distance **6**. Identical perfect branding — only the logo differs.

The coarse logo drifts up to 36, so the CREATE/reuse decision in `learning._upsertTemplate` (7–13 logo
"convergence band" + ≥0.60 kw overlap) occasionally (a) spawns a duplicate template or (b) lets a doc
confirm template-less. **`da4a5ff` loosened the logo band on MATCH (rescue 2b) but NOT on CREATE/reuse
— that's the missing half.**

**Fix (next session):** on confirm/upsert, REUSE an existing same-supplier same-type template
identified by the KEYWORD FINGERPRINT (0% cross-supplier false-match) + type-slug, and ADD the doc's
logo to that template's multi-ref set (converge). Do NOT gate reuse on the logo. Then future docs match.
CLEANUP: merge the existing duplicates (`templates.mergeInto`). Also pin **why the rescue didn't fire
for `sales_order_05` despite `da4a5ff`** (likely `title_trusted` false OR an earlier return — reprocess
via working-tree showed template_id=null raw AND straightened).

### N (#20) — `confirmed_count` never incremented on confirm
Roster shows "confirmed 0×" regardless of real confirms (user-reported, verified). All 9 Copperfield
templates have `confirmed_count` 0 or 1 despite 11–20 confirmed docs linked to each (delivery tpl 4 = 0
but 20 linked; sales tpl 9 = 0 but 11 linked; only 1/9 templates has a non-zero count, max 1). The
confirm path sets `documents.template_id` but never bumps the template's counter.
- **Severity question for the fix:** trust auto-file graduation needs "W=10 CLEAN confirmations" — if
  `trust.js` reads `confirmed_count` (not a live COUNT of confirmed docs), this ALSO silently prevents
  graduation. **Verify during the fix.**
- **Fix options:** (a) increment `confirmed_count` in the confirm/`_upsertTemplate` reuse branch; or
  (b) compute a LIVE count in the roster + any consumer = `COUNT(documents WHERE template_id=t.id AND
  status='confirmed')` (robust, no drift). Small, self-contained.

---

## Verification state — honest
- B+C: corpus A/B **byte-identical** (default OFF), before the branch push. Confirmed.
- `da4a5ff`: realdoc_regression A/B (fix vs `RESCUE_ENFORCE_LOGO_BAND=1`) **IDENTICAL, no regression**.
  BUT could NOT reproduce the target failure on the dev DB (good logos) → measured-safe, not proven-effective.
- `1f30946`: `test_anchor_label.js` 109 checks green.
- `ba667b6`: not smoke-tested by me on the built app (renderer-only; the wizard/focus paths are visual).
- Option A: unit tests pass, `node -c` clean; **NOT wired, NOT corpus-run** (filing core, no pipeline files).
- Last `stress_test/out/realdoc_regression.md` (71 docs): type/supplier/date 100%, ref 98.6%, **M=0
  auto-file-wrong, M_type=0** — the 1 regression is #42 PO ref want `PO-36990` got null (recall miss,
  not an auto-file-wrong). Healthy known-good state.
- **Corrected mid-session claim:** my early "reprocess 12s → 4–5s" was too rosy. Measured: cached
  reprocess ~1.7s (no gain — already fast), straighten reprocess ~9.4s → ~6.3s (~1.5×). Said so to the owner.
- The user's M/N/sales_order_05 observations were on the **1415-7298b10** build (no `da4a5ff`); my
  working-tree reprocess (WITH `da4a5ff`) also failed to match sales_order_05 → `da4a5ff` doesn't fix that doc.

---

## FIRST ACTIONS for the fresh session
1. **Design the M fix (root cause) with advisor + Oracle, control-test-first.** Keyword-fingerprint
   template convergence on confirm/upsert + duplicate merge. This subsumes H and L. Investigate
   `learning._upsertTemplate` reuse gate + the born-new path; pin why `sales_order_05`'s rescue didn't fire.
2. **Fix N** alongside (or first — it's small): increment `confirmed_count` OR live-count it; verify
   whether `trust.js` graduation reads it (blast-radius check).
3. **Decide the Option A wiring** (task #9) — wire `filing/handler.js` step 4 + Settings + first-run, then commit.
4. Then work the remaining queue (below).

## Deferred / queued (tasks #6–#20)
- **#6** B-safety (Resolve→Confirm-WITHOUT-reprocess poison seam) — shared learning path, deferred.
- **#9 A** — duplicate-filing options: core done (uncommitted), needs wiring + commit.
- **#10 C** — green "taught" dot for template-mapped fields (`getTaughtFieldKeys` only checks
  `field_anchors`, not template mappings).
- **#11 E** — pre-warm processing workers at startup (owner asked; design via advisor+Oracle).
- **#12 F** — anchor crop flagged despite a good value (rejected caption trips the crosscheck flag; fix
  = don't flag on a rejected candidate).
- **#15 I** — straighten the doc in the Resolve/disambiguation picker pane.
- **#16 J** — Search screen: verify send-to-review (shipped `21c6572`) + add a Delete button.
- **#17 K** — ⊕ value box drawn mid-text-block (teach-time box snap).
- **#18 L** — folded into M (template match lost after reprocess = the fragmentation root cause).
- **#19 M** — template fragmentation (ROOT CAUSE — design next).
- **#20 N** — `confirmed_count` counter bug.

## Needs the USER
- 6-core memory-pressure load test of B+C before flipping either reprocess-parallelism default ON.
- Confirm before any push (3 commits are unpushed).
- The M/N fix should be validated on the Desktop **Demo Docs** corpus (9 suppliers, the fragmentation is visible there).

## Key facts / paths
- Live DB: `%APPDATA%\ScanFinder\docusnap.db` (note: **ScanFinder**, not DocuSnap). Open READ-ONLY
  (`file:...?mode=ro`). `templates` columns: `id, name, slug, document_type_slug, logo_phash,
  keyword_fingerprint, confirmed_count, ..., group_id` (**no `supplier_name`** — supplier is `name`).
- Reliable supplier signal = `template_matcher.extract_keyword_fingerprint` / `_keyword_hit_ratio`
  (branding words). NOT the logo pixels on scans.
- Diagnostic probes saved in the session scratchpad: `diag_so05.py` (branding vs logo distance),
  `diag_confirmed_count.py` (counter vs live-link), `measure_drift.py`, `measure_logo*.py`,
  `measure_keyword_fp.py`, `reprocess_template.js`.
- Kill switches added this session: `DS_OCR_PARALLEL_FULLPAGE`, `DS_OCR_PARALLEL_FIELDS`,
  `DS_OCR_POOL_WORKERS`, `RESCUE_ENFORCE_LOGO_BAND`, `RESCUE_LOGO_BAND`, `anchorLabel.setRatioTiebreak`.
- Tests: JS via Electron-as-Node; Python pytest-style. New this session: `test_parallel_fullpage.py`,
  `test_parallel_fields_dispatch.py`, `test_region_embeddable_import.py` (runs under `python -P`).
- No background processes of mine running. The owner may have a dev `npm start` or the built app open.
