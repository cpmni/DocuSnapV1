# HANDOVER — 2026-08-31 NIGHT2 (owner testing a rollout build → autonomous night)

**Branch** `feat/teach-side-overnight`. **All night commits are LOCAL — NOT pushed** (night-run protocol +
owner reviews then pushes). Predecessor: `HANDOVER_2026-08-31_INTEGRATION.md`. The owner installed the
packaged build `ScanFinder Setup 2.0.0-r20260831-2118-ae6d20f.exe` and was hands-on testing before bed; 5
packaged `ScanFinder.exe` instances were running when the night began (do NOT name-kill — the owner's app).

## TL;DR — what happened this session (newest first)
1. **Corroborated-straighten AUTO-FILE arc — BUILT DARK + unit-pinned** (owner's going-to-bed ask). Oracle
   SIGN-OFF-WITH-CONDITIONS (C1-C7 applied). `docs/designs/DESKEW_CORROB_AUTOFILE_2026-08-31.md`. **DO NOT
   FLIP** — needs the owner-machine census.
2. **`deskew_review_retry_enabled` promoted to a fresh-install DEFAULT** (mig 101) + rebuilt installer
   `…-r20260831-2118-ae6d20f.exe`.
3. **Quick-check dropdown focus fix** (`b95ccf5`, eric-diagnosed) — the E44 native-select-won't-open bug.
4. **Batch-import silent-crash fix** (`40ef134`, eric+oscar+Oracle) — RAM-aware cap + worker-death
   resilience; runtime import smoke PASS; `TESTING/_measure/import_crash_smoke.js`.
5. **Mig-93 test-pin tidy** — 14/16 greened (`24fe2a1`); 2 real findings queued.
6. Everything committed LOCALLY; the earlier fixes (1-5 minus the arc) were also PUSHED earlier at the
   owner's explicit request (up to `ae6d20f`). The NIGHT2 arc commit is local-only.

## 1. The corroborated-straighten auto-file arc (headline ask) — DARK, DO NOT FLIP
**Owner's exhibit (Pelican doc 806):** after straightening, invoice_date=07-06-2026 and
invoice_number=PI/26/7656 each read by keyword+anchor(crop) — corroborated + regex-valid — yet held with
"confirm once". Owner: that should auto-file.

**Built (Option A, entirely Python-side; `isAutoFileEligible` unchanged, no floor touched):** a
straighten-CHANGED field SKIPS its hold note and auto-files ONLY when it is a VERIFIED corroborated rescue —
- **C2a** `_corrob_licensed` (≥2 distinct page families) AND a **keyword** page-text witness
  (`_corrob_licensed_keyword`; closes the mapping+crop common-mode case);
- **C2b/C2c/C3** the straightened value matches its learned SKELETON (engine now surfaces `_shape_ok`);
- **C4 (Oracle's seam fix)** the RAW read `was` was NOT a credible competing reading — empty OR
  skeleton-False; a skeleton-valid `was` that merely differs KEEPS the hold (the straightened corrob record
  is blind to the raw pass, so 2 families agreeing on the same straightened raster can't tell "fixed" from
  "broke a correct read");
- **C5** emptied field holds; **C6** never file over a pre-existing note/corrected_to;
- **C7** env bridged only when BOTH `corroboration_autofile` AND `deskew_corrob_autofile` are true.

**Files:** `engine.py` (`_shape_ok`), `process_docs.py` (`_corrob_licensed_keyword`,
`_deskew_corrob_autofile_ok`, the skip), `handler.js` (`_reconcileEnv` bridge), pin
`test_deskew_corrob_autofile.py` (12 green). Default OFF byte-identical (import smoke 14/14; exhibit OFF 0
value diffs).

**⚠ Census finding (load-bearing):** the arc could NOT be reproduced end-to-end tonight — reprocessing doc
806 (working copy AND original scan) at 200 DPI reads it CLEAN, because Pelican is now well-learned (166
confirmed) so the retry never fires. The empty-first-read the owner saw was the WARMING phase. **The arc's
value is concentrated in early/warming imports (a fresh customer); the enumerated-heals census needs the
COLD import state, not a reprocess of now-warm docs.**

**Oracle's FLIP gate (owner-machine, NOT done):** realdoc arc-ON vs baseline → reads byte-identical
(assert); auto-file set differs only by an ENUMERATED list of corroborated straighten-heals; a HUMAN
verifies every value in that list; M=0 new wrong auto-files; no disputed-class doc silently files. Reproduce
the review-bound state per the census finding. **Until then: DO NOTHING (arc stays OFF).**

## 2. Deskew default (mig 101) + installer
`deskew_review_retry_enabled` now defaults ON for fresh installs (mig 101, `ae6d20f`; `INSERT OR IGNORE` —
existing installs' choices untouched). Verified: fresh→true, hand-disabled→stays false, `deskew_on_import`
stays OFF. **New installer built + signed: `dist\ScanFinder Setup 2.0.0-r20260831-2118-ae6d20f.exe`.** A
fresh customer now gets the tilted-scan straighten recovery the owner has been seeing.

## 3–5. Focus fix / crash fix / pin tidy
See `docs/designs/CONCURRENCY_RAM_CAP_2026-08-31.md` (crash fix, Oracle C1-C6), the focus fix commit
`b95ccf5` (arms the proven double-edge on `_baOpen`; pin `test_focus_repair.js` extended), and the
NIGHT_RUN DONE ledger for the pin tidy. All PUSHED up to `ae6d20f`.

## NEEDS YOUR APPROVAL / DECISION (morning)
- **The arc flip** — run Oracle's census from the COLD state; do NOT flip until M=0 + human-verified heals.
- **Push the NIGHT2 arc commit** (local-only): `! git push origin feat/teach-side-overnight`.
- **Chris round** — DEFERRED tonight (your packaged app was running; launching a competing dev app to drive
  Chris autonomously near it, with the name-kill trap, wasn't a safe unsupervised move). Run `/christest`
  when you can supervise, or when the packaged app is closed. Focus: the import low-memory copy, the
  Quick-check dropdown fix, the deskew-default straighten recovery.
- **2 red pins** (`test_settings_wiring` orphaned stamp-panel, `test_activity_strip` UI-refactor drift) —
  your UI intent needed (NIGHT_RUN queue).
- **Client + cert-tool Electron 44** — `npm install` before the next client build (NIGHT_RUN queue).

## Verification state — honest
- All new pins RAN + read green (`test_deskew_corrob_autofile` 12, `test_import_concurrency_cap`,
  `test_focus_repair`, the 14 mig-93 pins). Import smoke PASS (14/14). Engine `_shape_ok` byte-identical.
- NOT done (owner-machine): the arc census, a full-suite run, the packaged-boot gate-5b re-confirm.

## Key facts / traps
- **Live DB** `%APPDATA%\ScanFinder\docusnap.db` — now mig 101, 166 confirmed (owner filed more while
  testing). The owner's install runs the new build.
- Harness for the arc census: `TESTING/_measure/reslice_20260830/_run_docs.js` (I added `DESKEW_CORROB` to
  its env whitelist); spaced paths need the `@listfile` form; `_RENDER_DPI` reads `OCR_RENDER_DPI` at import.
- Never name-kill Electron/ScanFinder (the owner's packaged app runs). Port-target 9223 for a Chris sandbox.
- `git commit -F <file>` only. Local commits await the owner's review + push.
