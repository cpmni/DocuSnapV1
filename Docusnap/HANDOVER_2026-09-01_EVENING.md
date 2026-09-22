# HANDOVER — 2026-09-01 EVENING (rollout day 2: fixes shipped, two gated plans READY TO BUILD)

**Branch** `feat/teach-side-overnight`. **HEAD = origin = `d629b07` — ALL PUSHED, tree clean.**
Latest signed installer: **`dist\ScanFinder Setup 2.0.0-r20260901-1838-29adce2.exe`** (the owner is
rolling out on a second PC). **⚠ 3 orphaned `electron.exe` processes are alive on this machine
(port 9223 NOT listening — Chris-sandbox remnants). NEVER name-kill (the standing trap); they WILL
EBUSY any `npm run build` native rebuild — get the owner to close them (or reboot) before building.**

## ⏭ THE FRESH SESSION'S JOB (owner order): BUILD PLAN A, THEN PLAN B
Both are fully advisor+Oracle gated (verdicts logged in `docs/oracle_log.md` under 2026-09-01).
Build them EXACTLY to the conditions below — deviating from A:C1/C2 or B:C1–C4 goes back to the Oracle.

---

## PLAN A — the Chris r-09-01 fixes (eric design → Oracle SIGN-OFF-W/COND C1-C8). SMALL.
Two Review-window findings (`docs/CHRIS_FULL_APP_REVIEW_2026-09-01.md` cards 1+2). All in
`src/windows/review/renderer.js` + a light guard in `src/modules/review/handler.js`.

**F1 — stale garble ripple + heading after an issuer correction.** Mechanisms (verified):
`offerIssuerRipple(srcDocId, name, row)` (renderer.js:7708) freezes `name` at offer time (button
:7723, `findIssuerSiblings` :7711, `applyIssuerRipple` :7738); the blur re-offer doorway
(:4445-4452) is gated `typed !== input.dataset.original` so retyping the ORIGINAL correct value
never re-runs it; `_updateSenderFieldsBtn` (:1463, label from live `_currentIssuerValue()` :3859)
is not called from the supplier_name input handler (:4389-4414). Build:
- A named `_teardownIssuerRipple(row)`: remove `.ripple-bar` (scoped to the row), clear
  `row.dataset.rippleOffered`, call `_updateSenderFieldsBtn()`. Call it from the supplier_name
  `input` handler (the existing `if (key === 'supplier_name')` hook ~:4413) **AND from
  `_applyTeachValue` (:5954) when fieldKey==='supplier_name'** (it deliberately emits no input
  event — Oracle C3). **The teardown is NOT behind any kill switch (C8)** — it is a staleness bug fix.
- Guard `offerIssuerRipple` at its head on `check-issuer-read(name)`: implausible/empty → remove any
  bar + return (one choke point covering both call sites :4450 blur + :4730 branding).
- Defence-in-depth: `apply-issuer-ripple` (review/handler.js:785) refuses an implausible value —
  **C1 BLOCKER: it must READ `teach_issuer_plausibility_warn` ITSELF** (a direct
  `learning.issuerReadLooksImplausible` call bypasses the IPC's gate at :293-295; a switched-OFF
  install must not refuse ripples) — and **return a `reason`** the bar surfaces ("that name doesn't
  look like a company — check the field"), never a mute failure (C6).

**F2 — a clipped teach box overwrites an already-correct issuer value with junk.** Mechanism
(verified): renderer.js:5308-5314 commits the drawn read (`input.value = text`, `.corrected`,
`corrections[fieldKey]`) with no plausibility check; the junk check only SPEAKS later
(:5380 → `speakIssuerTeach` :5977-6012). Build:
- Before the write, **ONLY for `fieldKey === 'supplier_name'` (C2 BLOCKER — NOT `_isNameLikeField`:
  the predicate's FP profile is unmeasured on address/customer keys AND `speakIssuerTeach` only runs
  for supplier_name, so elsewhere the decline would silently lie)**: await `checkIssuerRead(text)`;
  if implausible AND the field currently holds a non-empty value → do NOT write. Decline is ATOMIC
  (C7): no `corrections` write, no `.corrected`, no `dismissServerNote`, no new-value
  `fieldValidationError` — the prior value + its notes stand untouched. Skip the focus-repair block
  (:5335-5340) on the no-write path.
- Surface the declined read as an OFFER: a `Use "<X>"` action on `speakIssuerTeach`'s implausible
  branch (:6008-6012, currently actionless) wired to `_applyTeachValue` so a deliberate accept flows
  the normal correction path. **Thread the ONE `checkIssuerRead` result through** (C5 — don't ask
  twice). Stale-async guard: capture fieldKey/doc id before the await, bail if changed (the :5968
  pattern). Implausible-but-EMPTY-prior still writes (today's behaviour). Date/ref/total
  byte-identical. The position anchor still stages on decline (deliberate — "a box is evidence about
  WHERE"; the copy's "Draw it again" is the mitigation).

**C4:** amend the warn-only contract comments (review/handler.js:286 + learning.js:128-129) to name
the new write/offer consumers; annotate `database/modules/test_issuer_plausibility.js` that its
immunity list (BP/IBM/3M/H&M…) is now LOAD-BEARING for the write path.

**Pins + gate (A):** extract TWO PURE decisions into a dual-export module (the
`src/windows/shared/logoSource.js` pattern), e.g. `src/windows/review/issuerTeachDecision.js`:
`shouldOfferIssuerRipple({read, implausible})` and
`shouldDrawnReadReplaceField({read, priorValue, implausible, isNameLike})`. Unit-test BOTH polarities
— the implausible+non-empty-prior case must FAIL on today's code (reproduce first), the
implausible+empty-prior case pins preserved behaviour, switch-OFF pins both decisions identical to
today; the immunity names assert `false` through `shouldDrawnReadReplaceField`. Plus a
SOURCE-CONTRACT test (the `test_issuer_ripple_contract.js` style) proving the real call sites consult
the module (the input handler, `_applyTeachValue`, `offerIssuerRipple`'s head, the :5308 write) —
the dead-guard trap. Realdoc: **byte-identical BY CONSTRUCTION** (renderer/confirm-time only; state
it in the commit, don't burn a run). Finish with a Chris re-verify of both exhibits (branding-garble
→ retype original → no stale bar/heading; clipped draw over a correct value → old value kept +
"Use X" offer) + the OFF-arm smoke. Honest scope note: single-token garbles (`NOCUMENT`) PASS the
plausibility predicate (BP/IBM immunity) — the teardown is the fix; the guard is defence-in-depth.
Do NOT claim the garble-ripple class fully closed.

---

## PLAN B — QUICK REPROCESS (gary design → Oracle SIGN-OFF-W/COND **C1-C7 BINDING**). A REAL ARC.
Owner ask: Reprocess All offers **Quick** (reuse the first pass) vs **Full**. Premise (Oracle-
corrected, load-bearing): Reprocess All ALREADY stages cached `ocr_text` into the manifest
(handler.js:4551) — the cost is page RENDER + per-field crop OCR + image stages; the true "half run"
is the sanctioned imageless `--reextract` (process_docs.py:464-470, 728-733), batch-wired. DARK
switch `quick_reprocess_enabled` (absent = OFF) + SFDEV toggle; flip is a separate owner decision.

Build order inside B:
1. **mig 104** (103 is used): `ALTER TABLE documents ADD COLUMN ocr_recipe TEXT` (go-forward, no
   backfill; NULL = legacy).
2. **Python:** emit `ocr_recipe` in `file_done` **ONLY when full-page text was PRODUCED this run**
   (fresh OCR or born-digital — NEVER cached-text reuse, NEVER `--reextract`) as
   `{dpi, light, bd, bd_used, rev, tess}` built from **runtime-actual values** (the dpi passed, the
   light levels run — never re-read from settings) (C3+C6); `bd_used` = any page provenance
   born_digital. Emit `imageless: true` on `--reextract` runs. `OCR_PIPELINE_REV` constant lives in
   `ocr/tesseract.py` beside what it versions, with a bump-checklist comment;
   `get_tesseract_version()` captured mechanically into the recipe (C6).
3. **JS module `src/modules/processing/ocrCache.js`:** `currentOcrRecipe(db)` +
   `ocrCacheUsable(row, current)` (pure). Invalidators: `ocr_dpi`, `ocr_light_text_recovery`,
   `born_digital_enabled`, rev/tess mismatch. Per-doc refusals: empty `ocr_text`, enhance-active
   template, `bd_used`, NULL stamp. NON-invalidators with reasons in code: `auto_rotate_enabled`
   (rotation is baked into the working copy at import — verified), date_order/number_format
   (parsing, not OCR). JS mirrors the rev constant; a cross-language pin must FAIL on a one-sided bump.
4. **`reprocess-batch` (handler.js:4608) gains `opts.quick`:** partition staged docs by the
   predicate. Usable shard: `--reextract` appended (manifest per-doc `ocr_text` already flows via
   doc_overrides, process_docs.py:332). Refusal shard: runs Full — and **inside a Quick-enabled
   batch that Full-fallback shard OMITS manifest `ocr_text`**, forcing ONE honest re-OCR that earns
   the doc its stamp (C3 — this is what makes legacy self-heal TRUE, and finally delivers the
   standing 08-27 light-text flip-heal condition; its text diffs are a NAMED census arm — count +
   eyeball). `deskewAll` → whole batch Full (Quick disabled + one-line reason).
5. **Manifest staging (C2):** the stored `template_id` WINS when present — staging byte-identical to
   today's :4532. Fresh `templates.identifyByFingerprint` (with `document_type_slug` +
   `logo_detail_hash`) fills ONLY null-template docs + the blank-supplier-unpin class, differs-only
   admit — mirroring `_reextractFastCore` handler.js:3526-3539 EXACTLY. Pin: a bound doc's manifest
   under Quick is byte-identical to today's.
6. **Imageless merge guards in `applyReprocessResult`,** keyed on the Python `imageless: true`
   (never a JS-side guess). The destructive seam is real: :3066-3068/:3078-3081 plain-assign
   `template_id`/`logo_phash`/`logo_detail_hash`/`keyword_fingerprint` (`result.* || null`) while
   `ocr_text` is COALESCEd. Guards: preserve `logo_phash`/`logo_detail_hash` unconditionally;
   preserve `template_id`/`keyword_fingerprint` when the fresh value is null; taught-anchor field
   keys abstain (the existing `getTaughtFieldKeys` C6 list, :3603-3610); an image-family stored row
   (`anchor_crop*`/`anchor_registration`/`template_mapping`/`ocr_region`) survives a DIFFERING
   text-derived value — kept, no user note, **BUT (Oracle C1, the safety linchpin) that doc is
   EXCLUDED from this run's consent-bar offer AND scope auto-accept, with a trace event naming the
   field + both values** — otherwise Quick silently FILES what Full would HOLD (the
   `trust_role_disagreement_refuse` doorway never sees the dissent; the "zero value divergences"
   tolerance is blind to it BY CONSTRUCTION). **Preserve the PRIOR `overall_confidence` whenever the
   guard kept ≥1 stored row (C4)** — the imageless engine scores kept mapping reads as 0, which
   would mass-hold the best-taught suppliers. Pin the merge never trips `_supBlanked` / never NULLs
   a stored supplier (C7 — :3058/:3070).
7. **Dialog:** replace the Reprocess-All `confirm()` (review/renderer.js:9003-9007) with
   Quick(recommended)/Full/Cancel; `{quick:true}` through `reprocessBatch` (:9047-9049); summary
   returns `quickCount`/`fullFallbackCount`; the Quick dialog carries the `_selfFiles` honesty line
   (:8996-9001 — graduated senders CAN file straight away); do NOT claim Full "re-reads everything
   from the page" (it reuses cached text today — that retrofit is SLICE 2).
8. **Slice 2 = SEPARATE + LATER (own switch + census):** retrofit `ocrCacheUsable` onto today's
   UNCONDITIONAL cache reuse (:4551 batch, :3353 single) — it changes today's byte behaviour.
   Do NOT fold into slice 1.

**Pins + gate (B):** `test_ocr_cache_usable.js` (every invalidator flips; NULL/malformed stamp;
bd_used; the rev cross-pin), Python `tests/test_reextract_recipe.py` (rendered run emits a
runtime-actual recipe; cached-text + `--reextract` runs emit NONE; `imageless:true`; the deskew
retry stays refused on reextract — extend the existing pin), `test_quick_reprocess_merge.js` (every
guard above + the TRADE-OFF pin: a fresh anchor teach in scope → Quick keeps the stored value,
review-bound, and the keyword fallback did NOT claim the taught field), the partition/fallback pin,
and the C1 contested-keep pin (stored mapping X vs fresh keyword Y≠X → value stays X + doc
ineligible + trace; Y==X → eligible). GATE before merge: pins green under E44; realdoc-605
switch-OFF byte-identical; a warmed-copy Quick-vs-Full arm comparing **values + BINDINGS
(template_id/supplier_name/document_type_id/detected_type_name) + hold/note sets +
isAutoFileEligible + would-file parity (any deficit itemised = the honest pixel-heal price) + M=0 +
a Quick×2 == Quick×1 idempotence arm**; the C3 census arm. Confirm-before-build assumption (one
fixture run): a `--reextract` `file_done` emits null `_logo_phash` (the guard is correct regardless).
Honest limitations to keep in the copy/docs: Quick cannot mint a NEW supplier identity from a logo
(the Stage-2 logo arm never runs imageless — deliberate) and pixel-only heals (deskew retry,
light-text, banner type-recovery, new anchor/mapping teaches, barcode refresh) do not run — those
docs stay HELD with old values, never silently wrong.

---

## What THIS session shipped (all PUSHED, `133832f` → `d629b07`)
- `26d9960` **date fix** — the central parser (`filing.parseDate`) accepts FULL month names
  ("July 28, 2026" now files as 28-07-2026; reversed the stale pin that expected "15 August 2024"
  refused). Chris-validated live.
- `15c5386`+`1fb752c` **Help button** — left nav rail, moved into the main group under Settings
  after the owner couldn't find it at the bottom. Chris-validated ("easy to find").
- `3a10a7c` **three features built DARK** (mig 102: `quiet_reread_silent`, `sweep_inview_countdown`,
  `accept_field_chars_enabled` + `extractions.charset_flag_meta`) → `41adfc9` **defaulted ON for
  the rollout (mig 103 UPSERT)** + toggle-audit round 2 (8 more reading-internal toggles SFDEV-
  hidden; owner kept barcodes + Learning-Repair visible) + copy fixes (41× "ScanFinder"→"Scan
  Finder", curly quotes, "On by default"). Pins: accepted-chars py 11 · charset service 26 ·
  presence onlyViewerIs · date predicate 18.
- `61a19f6` **DESKEW_CORROB census — flip gate MET** (4 GT-verified Pelican heals, M=0, reads
  byte-identical, disputed dates held). `docs/DESKEW_CORROB_CENSUS_2026-09-01.md`. Flip of
  `deskew_corrob_autofile` = owner's call (still OFF).
- `20eca32` **comprehensive error logging** (both paths; stage/type/truncated-traceback → diaglog;
  always-on log = shape only; fixed a pre-existing filename leak). Pins 13+16.
- `5b06132` **watch hardening** — watch now reads at the SAME DPI as import (`_ocrDpiEnv` was
  missing — a silent accuracy parity break), RAM+OMP caps, async spawn-error resilience.
- `f50afa5`+`29adce2` **watch separation** (DARK `watch_separate_enabled`, absent=OFF) — splits
  multi-doc PDFs IN the watch folder over the explicit stable set; `_separating` blocks the poll for
  the span; `applySeparationToTracked` pre-marks segments (re-import-loop guard, pinned 10);
  freshly-split watch segments HELD for review. Stability debounce untouched. The watch→import
  literal code-merge (shared `runImportBatch`) is DEFERRED per Oracle (own arc; use a separate
  `_watchBatchActive` counter, NEVER co-mingle `_currentBatchProcs`).
- `0a4e422` **Chris round on the rollout build — verdict YES** (`docs/CHRIS_FULL_APP_REVIEW_
  2026-09-01.md`; every destructive warning truthful; cards 3-6 = demo-set artefacts/copy).
- `b80fd7a`+`d629b07` the four Oracle verdicts logged in `docs/oracle_log.md`.

## Verification state — honest
- All new pins RAN + green: date 18 · accepted-chars 11 · charset 26 · presence · error-payload 13 ·
  error-logging 16 · watch-separation 10 · classify-poll/drain-tally/split-plan unchanged ·
  mig 102+103 verified on a live-DB copy (all three settings → true). Extraction smoke exit 0.
- Installer `…-1838-29adce2.exe` built + signed; owner installing. Chris ran ON that code.
- NOT verified: the three features' countdown + accept-chars UX in real use (Chris's demo docs were
  too clean to trigger either — a test-coverage gap, not a bug); `watch_separate_enabled` has no
  live soak; the deskew_corrob flip not taken.

## FIRST ACTIONS for the fresh session
1. Read this handover fully (Plans A+B are the job), then `docs/oracle_log.md` 2026-09-01 entries.
2. `git log --oneline -5` — expect HEAD=origin=`d629b07`, tree clean.
3. **Check for the 3 orphaned electron.exe procs** — if still alive, ask the owner to close them
   (NEVER name-kill) BEFORE any `npm run build`.
4. Build **PLAN A** (small): reproduce-first pins → fix → source-contract test → commit → Chris
   re-verify of the two exhibits.
5. Build **PLAN B** slices 1-7 in order (mig 104 → Python emits → ocrCache.js → partition →
   staging C2 → merge guards C1/C4/C7 → dialog), pins as you go, DARK. Slice 2 stays deferred.
6. Owner review → push → rebuild installer when they ask.

## Needs the USER
- Rollout smoke of `…-1838-29adce2.exe` on the second PC (Help button now under Settings; full quit
  + reopen needed; About box shows the build rev).
- Flip decisions: `deskew_corrob_autofile` (census MET), `watch_separate_enabled` (after a soak on
  their own scans). Chris cards #4 (Help copy still says "? / account menu") + #5 (sender-not-
  identified hint) = trivial copy fixes awaiting their go.
- Close the orphaned electrons before the next build.

## Key facts / paths / traps
- Live DB `%APPDATA%\ScanFinder\docusnap.db` — mig 103 after first boot of the new build.
- Test corpus `Desktop\ScanFinder Test Corpus` (605 papers, GT fixed 09-01); census harness
  `TESTING/_measure/reslice_20260830/_run_docs.js` + the scratchpad `census_run.js` variant.
- Chris sandbox userData/Output/Demo Docs under the 09-01 session scratchpad `chris-sandbox\`
  (session-mortal); screenshots in `chris-driver\`.
- Traps: `git commit -F` only (backticks in `-m` shell-substitute) · never name-kill electron ·
  builds need EVERY electron closed (EBUSY) · `pytest tests/` ABORTS (script-style tests, run each
  with `py -3.12`) · PYTHONUTF8=1 for tests printing unicode · the settings toggle-map lives in
  `src/windows/settings/renderer.js` (pair with DEV_SWITCH_IDS ~:1045) · renderer changes need the
  window reopened.
