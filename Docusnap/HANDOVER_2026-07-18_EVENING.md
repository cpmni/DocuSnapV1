# HANDOVER — 2026-07-18 EVENING (the Filing Slips day)

**Branch:** `feat/reprocess-throughput-autostraighten` · **pushed through `bea1028`** (everything this
session did is committed AND pushed, including the morning session's previously-unpushed template M2/M3
commits `7d051f3`/`02fc10c`).
**Installer:** `dist\ScanFinder Setup 2.0.0-r20260718-0818-bea1028.exe` — the LATEST; it supersedes the
two earlier same-day builds (0530/ef8883e and 0811/77e674e, both carrying since-fixed bugs).
**Uncommitted:** ONLY prior sessions' batch — `.gitignore`, `CLAUDE.md` (session-state block),
`src/modules/filing/filename_pattern.js` + test (the 07-17 Option-A duplicate-filing core, still NOT
wired), `stress_test/out/accuracy_baseline.md`, and untracked handovers/stress scripts. Nothing from
this session is uncommitted.
**Running:** the owner's dev app (`npm start`) was left running in a background task at wrap-up.
**Context:** one session took Filing Slips from brainstorm → advisor+Oracle design → built, live-tested,
fixed, shipped; plus a new advisor agent and a Settings restyle.

## TL;DR
1. **NEW advisor `barry-the-brainstormer`** (`.claude/agents/barry-the-brainstormer.md`, owner-authored
   persona + verified product-grounding block). First brainstorm (home edition · generic doc type ·
   separator sheets) saved at `docs/brainstorms/BARRY_2026-07-18_home-edition_generic-docs_separator-sheets.md`.
2. **FILING SLIPS ("Separator sheets") designed and built.** Panel oscar/gary/eric/barry → synthesis →
   **Oracle SIGN OFF WITH CONDITIONS C1–C6**; owner answered all 9 open questions "as recommended".
   Spec: `docs/designs/FILING_SLIPS_2026-07-18.md`. Slices 1 (detection+pipeline, default OFF) and
   2 (pack generation + UI) built with full control-test gates.
3. **Live testing found and fixed TWO bugs** (both escaped the pre-ship checks — see Verification).
4. **Settings hierarchy restyle** (`a14bd08`) — barry+eric consult, owner picked "eyebrow headers".
5. **Synthetic pilot PASSED in the live app** (owner-confirmed): 3 composed batches → 13 docs to Review
   exactly as predicted. **SlipTest cleanup done**: 13 docs soft-deleted + ALL fake-supplier learning
   removed (zero residue).

## Committed this session (all pushed)
- **`14f2600` docs** — Filing Slips design doc + Barry agent + brainstorm doc.
- **`514c663` slice 1** — NEW `python_backend/ocr/slip_detect.py` (150 DPI render + zxingcpp decode,
  anchored `^SFSEP-\d{1,6}$`, whole-file-or-abort, 500-page cap, `segments_excluding`);
  `segment_docs.py --slips` (slips-first; slips present ⇒ template segmentation SKIPPED = **PIN #2**;
  abort → `reasons` + `slip_aborted`, falls through); NEW pure `src/modules/processing/split_plan.js`
  (`buildSegmentArgs` = Oracle C1, `buildSplitPlan` — **PIN #1**: 1 segment + separator = REWRITE
  `minFiles=1`, a trailing sheet is never filed inside a doc; only-slips ⇒ consume; C4 abort never
  half-applies); handler **C2 DECOUPLED gate** `(auto_separate_enabled && templatesFile) || slipsOn`;
  setting `filing_slips_enabled` default **OFF** + env `FILING_SLIPS=0` hard-kill. Deps **zxing-cpp
  (Apache-2.0) + segno (BSD-3)** vendored + gates updated same commit (C5): `check-vendor-python.js`,
  `BUILD.txt` pip line, `THIRD-PARTY-LICENSES.txt` regenerated.
  Tests: `tests/test_slip_detect.py` (31), `test_slip_embeddable_import.py` (-P), `test_split_plan.js`
  (16), `test_slip_e2e.js` (C1 real-spawn chain incl. real pdf_splitter run). PIN #1/#2 proven RED
  under reversion then restored (C6).
- **`ef8883e` slice 2** — NEW `python_backend/filing_slips.py` (PIL+segno 200 DPI A4, `resolution=200.0`
  kwarg LOAD-BEARING for print size; 90mm ECC-H QR + two 35mm corner minis; DUPLEX pairs; v1 artwork =
  FROZEN CONTRACT for the future slice-6 signature); `generate-filing-slips` IPC (admin/edit; counter
  `filing_slip_next_number` advances only on success; writes `userData/filing-slips/`, keeps newest 5;
  30s kill-timer OUTSIDE the batch Stop registry) + pure `slip_pack.js` (clamp 1–50 default 10;
  restart-at-1 wrap — never a mixed-wrap pack); Settings toggle+print row + **C3 watch-folder warning**
  (toggle row AND success panel when `watch_folder_enabled`='1'); Import-view `#btn-print-slips`;
  `slip_split` process-trace event; Help `importing.html#separator-sheets`.
  Tests: `tests/test_filing_slips.py` (ROUND-TRIP pin: every generated page must decode via the real
  detector with the exact payload sequence — artwork↔detector can't drift) + `test_slip_pack.js`.
- **`77e674e` fix** — `generate-filing-slips` threw `ReferenceError: learning is not defined`:
  processing/handler.js requires `learning` PER-FUNCTION (no module-level const); the IPC assumed one.
- **`a14bd08` style** — Settings hierarchy: `.section-title` → small-caps accent eyebrow + hairline rule
  (the `.dash-cards-subhead`/`.side-head` idiom), `.threshold-label` weight 500, `.threshold-sub`
  line-height 1.55 + `max-width:65ch`, `.section-desc` 68ch. **Settings-local style block ONLY** — the
  license window and legacy `src/settings.html` carry their own copies of these class names; do NOT
  move this to theme.css (eric's seam).
- **`bea1028` fix** — `userData/filing-slips` added to `_allowedOpenRoots`: the F-06 open-file/
  show-in-explorer guard only allowed output_folder + userData/inbox, so "Open to print" was SILENTLY
  blocked (guard logs + returns). Found by tracing the owner's "we don't have a print feature" question.

## Verification state — honest ledger
- **Corpus gates (all READ, not inferred):** baseline captured PRE-code
  (`stress_test/out/filing_slips_BASELINE.md`, 76 docs, M=0/M_type=0, ref 98.7% with 1 pre-existing
  null-read #42); OFF-run after slice 1 **byte-identical** (diff clean); post-slice-2 run
  **byte-identical** again. (Out files are gitignored.)
- **Packaged E2E (proven):** packaged vendor python imports segno+zxingcpp; PACKAGED `segment_docs.py
  --slips` under the embeddable interpreter decoded a slip fixture (exclusion segments correct);
  packaged `filing_slips.py` generated a pack.
- **Synthetic pilot (owner-confirmed in the live app):** Batch A (24pp, 10 docs, 9 sheets — one
  upside-down, two skewed ±2–3°) → 10 docs, sheets removed; Batch B (payment-QR control) → 2 docs, QR
  page kept inside its doc; Batch C (defaced sheet) → 1 merged doc. 13 total, exactly as predicted.
  Batches remain in `C:\Users\cmccu\Desktop\SlipTest\`; a printable pack `Filing slips 0001-0010.pdf`
  is on the Desktop.
- **TWO in-session escapes, both now fixed + pushed (record the lesson):** (1) the ReferenceError —
  `node --check` + a module-load smoke CANNOT catch a call-time reference; the C1-class lesson applies
  to JS IPCs too. (2) the open-roots block — the design said "renderer opens via existing bridges"
  without tracing the guard BEHIND the bridge; silent-deny guards need an explicit trace when a new
  writer feeds an old opener.
- **NOT verified (the open axis):** real scan degradation. Everything above is clean digital renders.
  The REAL MFD pilot (print the pack, scan a SlipTest-shaped pile + both controls) is the outstanding
  slice-3 gate. Also: the owner has not yet exercised the INSTALLED bea1028 build's print button
  (fixes were validated in dev + by packaged CLI E2E).
- **SlipTest cleanup (verified zero residue):** 13 docs soft-deleted (recycle bin); removed 17
  supplier_hints + 5 logo_fingerprints + 16 field_anchors + 4 templates (via `templates.remove`, doc
  links nulled) for the 5 FICTIONAL suppliers the owner's 6 test confirms had taught. Note for the
  record: 6 casual confirms planted 42 learning rows — the "don't confirm fictional docs" caution is real.

## FIRST ACTIONS for the fresh session
1. Check the owner emptied the app recycle bin (13 Batch-* docs) — purging unlinks the 6 filed PDFs
   under `Desktop\Kyle Test\Documents\{BIRCHFIELD-CATERING, GLENARM-ROOFING, ALDER-POINT-JOINERY,
   CROWN-VALE-MOTORS, DUNMORE-PLASTICS}\`. If he deleted folders by hand instead, the bin rows point at
   dead paths (harmless; purge anyway).
2. **Real MFD pilot** when the owner has scanner access (the slice-3/4 gate): print the Desktop pack,
   scan a 10-doc/9-sheet pile + payment-QR control + creased-sheet control at 150–200 DPI greyscale AND
   300 DPI colour.
3. **Slice 5 — watch-folder parity** (design pass with advisors + Oracle FIRST): option (a) from the
   design — split in the temp staging dir + decouple "original consumed" from "1 file → 1 document" in
   the drain (`watch/handler.js:261-318`); explicitly NOT in-watch-folder splitting. REQUIRED before
   any default-ON flip (Oracle C3).
4. Owner to eyeball the Settings restyle on Dark/Midnight/Festive + the Files & filing 3-column card
   (the visual gate eric named).

## Deferred (designed, NOT built — load-bearing conditions)
- **Slice 4 default-ON flip:** own commit; needs corpus green + real MFD pilot + slice 5 shipped
  (before or with) + the owner's Q2 decision (flip for existing installs vs fresh only — UNDECIDED).
- **Slice 6 number-OCR rescue rung:** only when NO QR decoded; REVIEW-FLAGGED suggestion only, never a
  silent split, never an AND-gate on the QR; the "mostly white" page-signature recipe MUST be
  recalibrated against the shipped stripe-band artwork; `return_errors=True` → targeted 300 DPI retry.
- **Destination slips:** separate design pass (payload schema/routing/review story).
- **Prior-session opens unchanged:** template-convergence merge refinement (no-geometry ⇒ safe-to-merge,
  Oracle-first — see HANDOVER_2026-07-18.md morning), SECURITY_BACKLOG.md SEC-01…20, Option-A
  duplicate-filing core (uncommitted, unwired), Barry's wider roadmap (generic doc type + Auto-Title is
  the next big lever per the brainstorm).

## Key facts / paths
- Live DB: `%APPDATA%\ScanFinder\docusnap.db`. Slip switches: setting `filing_slips_enabled`
  (default 'false'; the owner turned it ON), env `FILING_SLIPS=0` hard-kill, counter
  `filing_slip_next_number` (still 1 — the only in-app click failed pre-fix, and CLI packs don't touch it).
- Tests: `cd python_backend && py -3.12 tests/test_slip_detect.py | test_filing_slips.py |
  test_slip_embeddable_import.py` (set `SLIP_EMBED_PY=<dist vendor python.exe>` to test a build);
  `node src/modules/processing/test_split_plan.js | test_slip_pack.js | test_slip_e2e.js`.
- Corpus harness: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js`
  (report `stress_test/out/realdoc_regression.md`; baselines `filing_slips_BASELINE.md` etc., gitignored).
- **New dev-machine requirement:** `py -3.12 -m pip install segno zxing-cpp` AND
  `vendor\python\python.exe -m pip install segno zxing-cpp` (BUILD.txt §3 updated; check:vendor enforces).
- Advisors: `barry-the-brainstormer` registers as a subagent_type in sessions started after its
  creation. The Filing Slips design carries the full Oracle conditions in §11 of the spec.
