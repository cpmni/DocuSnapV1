# Quick Reprocess — integration gate (2026-09-01 night)

DARK arc `quick_reprocess_enabled` (`8ec97fd` + `7a8b797`; disclosure copy `2c25a6c`). gary designed the
gate; Oracle vetted it **SIGN OFF WITH CONDITIONS** (§3 of `docs/SECURITY_REVIEW_2026-09-01.md` context /
the 2026-09-01 Oracle transcript). This doc = what RAN tonight + the runnable spec for the owner's real DB.

## What ran tonight (autonomous, on the reset TEST DB + the corpus)

**Confirm-before-build emit fixture — 8/8 GREEN** (`stress_test/reextract_qr_emit_probe.js`, real Python,
2 live docs with real files at 200 DPI). Proves end-to-end, on REAL pixels, the three facts the merge
guards depend on and that the pure/Python-unit pins cannot reach (they stub the emit):
- a FRESH run's `file_done` carries `ocr_recipe` (with `dpi`) — mig-104 stamp/self-heal works;
- a `--reextract` run's `file_done` carries `imageless:true` (the flag the merge keys off) and NO recipe;
- a `--reextract` run's `_logo_phash` is **null** — confirming gary's assumption and validating Oracle/gary's
  **C6 guard** ("preserve the stored logo unconditionally on an imageless run") is correct by construction.

Existing pins remain green: pure merge `test_quick_reprocess_merge.js` (68), Python `test_reextract_recipe.py`
(20), `test_ocr_cache_usable.js` (23), `test_reprocess_autocommit.js` (28). The mechanism (merge + Python
emit) and the wiring (partition gate, contested doors, stamp-strip, `--reextract`) are pinned; the emit
probe adds the real-Python end-to-end leg.

## Oracle's binding conditions (folded here + into the code)

1. **Arm B's M=0 is mechanism-parity + text-disagreement-class only — NOT load-bearing for the pixel-heal
   class.** The C1×C4 seam: C1 contests only on a fresh TEXT disagreement; a stored IMAGE-family read that a
   Full reprocess would pixel-heal (deskew / faint-text / a newly taught field) produces NO disagreeing value
   under Quick (the image stage never runs), and C4 preserves the prior above-floor `overall_confidence` so
   the doc stays eligible — Quick would refile the stale image value where Full HOLDS. On a clean corpus every
   pass reads identically, so arm B greens vacuously over this class.
2. **The missing load-bearing limitation** (now recorded): a clean synthetic sandbox CANNOT manufacture the
   pixel-heal→auto-file divergence — the one class where Quick and Full differ on FILING. Its go/no-go is the
   owner's real DB (which has the skewed-scan / light-text / deskew-heal populations). gary's "pixel heals
   don't run — held, never silently wrong" holds only for ALREADY-held docs; a doc that auto-filed on pass 1
   re-files under Quick with the stale image value.
3. **Disclosed-by-design → a COPY requirement, now met** (`2c25a6c`): the Quick/Full dialog + the Settings
   toggle state that Quick reuses the first read and does NOT re-check the page-image heals (straighten /
   faint-text / newly taught) — "choose Full to re-read the pages." This sentence is the ONLY safeguard for
   the class in condition 1; do not weaken it.
4. **Each mechanism arm (C/D/E) must use a CONSTRUCTED doc proven to exercise its guard** — the non-vacuity is
   "this doc's stored row differs / its stamp is NULL," not "the batch ran." (Arm E's is the load-bearing one:
   assert the imageless read actually returned Y≠X, else the contest can't fire and the green is worthless.)
5. **The DARK flip stays gated on the owner's real Castellan DB** (standing decision). Merging the DARK code
   behind the mechanism gate is fine; the flip is a separate owner call after the real-DB run below.

## Runnable spec for the owner's real DB (the flip gate)

Prereq: a `db.backup()` COPY of the live learned DB (NOT the live file), `RR_APP_ENV=1`, `OCR_RENDER_DPI=200`,
the dedup `RR_IDS`. Never confirm/teach from the corpus into the live app.

- **Arm A — switch OFF == today (byte-identical).** `stress_test/realdoc_regression.js` (RR_DB = the copy),
  this branch vs the pre-arc base, `quick_reprocess_enabled` unset. Threshold: zero per-field diffs, M
  unchanged. Non-vacuity: the base is a different sha AND N>0 docs processed AND arm B shows Quick engages
  (≥1 `--reextract`) — else "OFF identical" is trivially true because Quick never runs.
- **Arm B — warm Quick-vs-Full (the real M=0 arm).** Two copies; `{quick:true}` vs `{quick:false}` through
  `reprocess-batch`. Compare per doc: values + bindings (`template_id`/`supplier_name`/`document_type_id`/
  `detected_type_name`) + hold/note sets + `isAutoFileEligible` + would-file. Hard: `QuickEligible ⊆
  FullEligible` and every Quick-eligible would-file == Full == GT; **M (Quick auto-files whose value differs
  from Full/GT) = 0**. Deficit (reported, not fail): docs Full files but Quick holds — itemise with reason
  (contested / taught-abstain / pixel-only heal) = the honest pixel-heal price. **On the REAL DB this arm is
  now load-bearing** (it has the skew/light-text populations condition 2 names). Non-vacuity: ≥1 doc took the
  imageless route (`--reextract` + `imageless:true` in its `file_done`).
- **Arm C — Quick×2 == Quick×1 (idempotence).** Run `{quick:true}` twice. Threshold: run-2 rows + bindings +
  eligibility identical to run-1. Non-vacuity: run-1 mutated ≥1 row / wrote ≥1 recipe AND its Quick-classified
  docs stayed Quick-usable in run-2 (the `ocr_recipe` COALESCE preserved the stamp).
- **Arm D — C3 legacy self-heal.** Constructed: ≥1 doc with valid `ocr_text` + `ocr_recipe=NULL`. `{quick:true}`
  → that doc routes to the FULL shard (`quickReasons='no-recipe-stamp'`), its manifest `ocr_text` stripped, and
  after the run its `ocr_recipe` is a non-null dict with runtime-actual `dpi`; a second `{quick:true}` now
  classifies it Quick-usable. Non-vacuity: stamp was NULL before + a real render happened (`ocr_recipe` in its
  `file_done`, not `imageless`). Census sub-arm: diff old cached vs fresh text on the fallback shard, count +
  eyeball 2-3 (the standing 08-27 light-text heal made visible).
- **Arm E — C1 contested end-to-end.** Constructed: a stored image-family field value X where the imageless
  text read returns Y≠X, forced Quick-usable. Hard: X kept; the doc is in `_reprocessContested` (absent from
  `consume-reprocess-completion` `offerIds` AND `trust.isAutoFileEligible` → `{excluded:{reason:'quick-imageless-
  contested'}}`); a `reprocess_imageless_contested` trace fired. Control: a sibling where Y==X is NOT contested
  and IS eligible. Non-vacuity (the most important in the gate): assert the imageless `file_done` for that field
  actually returned Y≠X — else no dissent can fire.

## Honest limitations (do not over-read a green)
- Scale/distribution: a synthetic sandbox seeds a handful of layouts; M=0 there proves it only for those.
  Hypothesis: a mis-resolved-supplier / logo-only-identity doc (the Stage-2 logo arm never runs imageless —
  deliberate) could contest/hold or mis-bind on the real DB in a way no sandbox reaches.
- Synthetic graduation/trust state is not the owner's human-confirmed history; the would-file SET is synthetic
  (the DELTA is trust-state-independent, so the M=0 delta is still meaningful; absolute numbers are not).
- **The pixel-heal→auto-file class (condition 1/2) is the load-bearing gap** — invisible on a clean corpus,
  measurable only on the owner's real DB. Until Arm B runs there, the flip stays OFF.
